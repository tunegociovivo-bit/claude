/**
 * Service worker (MV3) que coordina la extensión Hub Negocio Vivo.
 *
 * Responsabilidades:
 *  1. Login con email + password (POST /api/v1/extension/login) que
 *     devuelve un token (API key tipo ag_*). Lo guarda en
 *     chrome.storage.local. El popup nunca toca el password después
 *     de loguear; todas las llamadas posteriores van con el token.
 *  2. Grabación: tabCapture.getMediaStreamId → offscreen MediaRecorder →
 *     POST /api/v1/extension/upload-recording.
 *  3. Polling de notificaciones: cada NOTIF_POLL_MIN minutos llama a
 *     /api/v1/notifications?unread=true y compara con la última lista
 *     guardada. Las nuevas aparecen como notificación nativa de Chrome
 *     (chrome.notifications.create) — el user las ve aunque el popup
 *     esté cerrado.
 *  4. Badge en el icono: número de notificaciones no leídas en el
 *     icono (sobre el rojo si está en una reunión, prevalece el
 *     contador si hay > 0 no leídas).
 */

const HUB_BASE_DEFAULT = "https://hub.negociovivo.app";
const OFFSCREEN_PATH = "offscreen/offscreen.html";
const NOTIF_POLL_MIN = 2; // chrome.alarms tick

// ─────────────────────────────────────────────────────────────────────
// Estado persistido
// ─────────────────────────────────────────────────────────────────────

async function getState() {
  const r = await chrome.storage.local.get([
    "state", "apiKey", "hubUrl", "user", "workspace",
    "lastTaskUrl", "lastError", "notifications", "lastNotifSeenAt",
    "needsTotp"
  ]);
  return {
    state: r.state ?? "idle",
    apiKey: r.apiKey ?? null,
    hubUrl: r.hubUrl ?? HUB_BASE_DEFAULT,
    user: r.user ?? null,
    workspace: r.workspace ?? null,
    lastTaskUrl: r.lastTaskUrl ?? null,
    lastError: r.lastError ?? null,
    notifications: r.notifications ?? [],
    lastNotifSeenAt: r.lastNotifSeenAt ?? 0,
    needsTotp: !!r.needsTotp
  };
}
async function setState(patch) {
  const curr = await getState();
  const next = { ...curr, ...patch };
  await chrome.storage.local.set(next);
  chrome.runtime.sendMessage({ type: "state-changed", state: next }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────

async function deviceLabel() {
  // chrome.runtime.getPlatformInfo() devuelve {os, arch}. Suficiente
  // para distinguir "Chrome en Mac" / "Chrome en Windows".
  try {
    const p = await chrome.runtime.getPlatformInfo();
    const os = ({ mac: "Mac", win: "Windows", linux: "Linux", cros: "ChromeOS", android: "Android" })[p.os] ?? p.os;
    return `Chrome en ${os}`;
  } catch {
    return "Extensión Chrome";
  }
}

async function login({ email, password, totpCode }) {
  const { hubUrl } = await getState();
  const resp = await fetch(`${hubUrl.replace(/\/$/, "")}/api/v1/extension/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, totpCode, deviceLabel: await deviceLabel() })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const code = data?.error?.code ?? "error";
    const message = data?.error?.message ?? `HTTP ${resp.status}`;
    if (code === "totp_required") {
      await setState({ needsTotp: true });
    }
    return { ok: false, code, error: message };
  }
  await setState({
    apiKey: data.token,
    user: data.user,
    workspace: data.workspace,
    needsTotp: false,
    state: "idle",
    notifications: [],
    lastNotifSeenAt: Date.now()
  });
  // Arranca el polling inmediatamente
  await ensureNotificationsAlarm();
  pollNotifications();
  return { ok: true };
}

async function logout() {
  await chrome.storage.local.clear();
  await setState({}); // dispara render
  await chrome.alarms.clear("poll-notifications");
}

// ─────────────────────────────────────────────────────────────────────
// Offscreen helpers
// ─────────────────────────────────────────────────────────────────────

async function hasOffscreenDocument() {
  if (chrome.offscreen?.hasDocument) return chrome.offscreen.hasDocument();
  if (chrome.runtime.getContexts) {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    return ctx.length > 0;
  }
  return false;
}
async function ensureOffscreen() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["USER_MEDIA"],
    justification: "MediaRecorder de la pestaña de la reunión."
  });
}
async function closeOffscreen() {
  if (!(await hasOffscreenDocument())) return;
  await chrome.offscreen.closeDocument().catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────
// Recording
// ─────────────────────────────────────────────────────────────────────

async function startRecording() {
  const { apiKey, hubUrl } = await getState();
  if (!apiKey) throw new Error("Sin sesión. Entra primero con tu email/contraseña.");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No se ha podido detectar la pestaña activa.");

  await ensureOffscreen();
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!id) reject(new Error("getMediaStreamId devolvió vacío"));
      else resolve(id);
    });
  });

  await setState({ state: "recording", lastError: null });

  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "start-recording",
    streamId,
    meetingUrl: tab.url ?? "",
    meetingTitle: tab.title ?? "",
    hubUrl,
    apiKey
  });
}

async function stopRecording() {
  await chrome.runtime.sendMessage({ target: "offscreen", type: "stop-recording" });
  await setState({ state: "uploading" });
}

// ─────────────────────────────────────────────────────────────────────
// Notificaciones del Hub (polling)
// ─────────────────────────────────────────────────────────────────────

async function ensureNotificationsAlarm() {
  await chrome.alarms.clear("poll-notifications");
  await chrome.alarms.create("poll-notifications", {
    periodInMinutes: NOTIF_POLL_MIN,
    delayInMinutes: 0.05 // ~3s al instalar
  });
}

async function pollNotifications() {
  const { apiKey, hubUrl, notifications, lastNotifSeenAt } = await getState();
  if (!apiKey) return;
  try {
    const r = await fetch(`${hubUrl.replace(/\/$/, "")}/api/v1/notifications`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store"
    });
    if (r.status === 401) {
      // Token caducado o revocado — forzar logout silencioso.
      await logout();
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
        title: "Hub: sesión expirada",
        message: "Vuelve a iniciar sesión en la extensión.",
        priority: 1
      });
      return;
    }
    if (!r.ok) return;
    const data = await r.json();
    const items = Array.isArray(data.items) ? data.items : [];

    // Detectar NUEVAS: las que no estaban en la lista anterior O
    // que tienen createdAt > lastNotifSeenAt. Las mostramos como
    // notificación nativa para que el user las vea sin abrir el
    // popup — la idea es alertar de menciones y alarmas a tiempo.
    const prevIds = new Set(notifications.map((n) => n.id));
    const fresh = items.filter(
      (n) => !prevIds.has(n.id) && new Date(n.createdAt).getTime() > lastNotifSeenAt
    );
    for (const n of fresh.slice(0, 3)) {
      // Solo notificación si NO está leída (las leídas no molestan)
      if (n.read) continue;
      const title = titleFor(n.type);
      chrome.notifications.create(`hub-notif-${n.id}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
        title,
        message: n.body || "Tienes una notificación nueva en Hub",
        priority: priorityFor(n.type),
        requireInteraction: /due|alarm|reminder/i.test(n.type) // alarmas: no se cierran solas
      });
    }

    // Persistir
    await setState({
      notifications: items,
      lastNotifSeenAt: Date.now()
    });

    // Badge en el icono (no leídas)
    const unread = items.filter((n) => !n.read).length;
    chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
    chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : "" });

    chrome.runtime.sendMessage({ type: "notifications-updated" }).catch(() => {});
  } catch (e) {
    // Red abajo o Hub caído — ignoramos silenciosamente; el siguiente
    // tick lo reintenta.
    console.warn("[poll-notifications]", e?.message ?? e);
  }
}

function titleFor(type) {
  if (/mention|@/i.test(type)) return "📣 Te han mencionado";
  if (/due|alarm|reminder|deadline/i.test(type)) return "⏰ Tarea próxima";
  if (/comment/i.test(type)) return "💬 Nuevo comentario";
  if (/assigned|assign/i.test(type)) return "📋 Te han asignado una tarea";
  return "🔔 Hub";
}
function priorityFor(type) {
  if (/due|alarm|reminder|deadline/i.test(type)) return 2; // más visible
  if (/mention/i.test(type)) return 2;
  return 1;
}

async function markAllRead() {
  const { apiKey, hubUrl } = await getState();
  if (!apiKey) return;
  try {
    await fetch(`${hubUrl.replace(/\/$/, "")}/api/v1/notifications`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    await pollNotifications();
  } catch (e) {
    console.warn(e);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Mensajería
// ─────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.from === "popup" && msg?.type === "login") {
      sendResponse(await login(msg));
      return;
    }
    if (msg?.from === "popup" && msg?.type === "logout") {
      await logout();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.from === "popup" && msg?.type === "start") {
      try {
        await startRecording();
        sendResponse({ ok: true });
      } catch (e) {
        await setState({ state: "error", lastError: String(e?.message ?? e) });
        sendResponse({ ok: false, error: String(e?.message ?? e) });
      }
      return;
    }
    if (msg?.from === "popup" && msg?.type === "stop") {
      try { await stopRecording(); sendResponse({ ok: true }); }
      catch (e) { sendResponse({ ok: false, error: String(e?.message ?? e) }); }
      return;
    }
    if (msg?.from === "popup" && msg?.type === "mark-notifications-read") {
      await markAllRead();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.from === "offscreen" && msg?.type === "upload-result") {
      if (msg.ok) {
        await setState({ state: "done", lastTaskUrl: msg.taskUrl, lastError: null });
        chrome.notifications.create({
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
          title: "Reunión guardada en Hub",
          message: msg.taskTitle ? `Tarea creada: ${msg.taskTitle}` : "Tarea creada con el resumen.",
          priority: 1
        });
      } else {
        await setState({ state: "error", lastError: msg.error ?? "Error" });
        chrome.notifications.create({
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
          title: "Error al subir reunión",
          message: msg.error ?? "Revisa la extensión.",
          priority: 2
        });
      }
      await closeOffscreen();
      return;
    }
    if (msg?.from === "content" && msg?.type === "meeting-detected") {
      // Solo cambiamos el badge si NO hay notificaciones no leídas —
      // el contador prevalece para no confundir al user.
      const { notifications } = await getState();
      const unread = notifications.filter((n) => !n.read).length;
      if (unread === 0) {
        chrome.action.setBadgeText({ text: "●", tabId: sender.tab?.id });
        chrome.action.setBadgeBackgroundColor({ color: "#dc2626", tabId: sender.tab?.id });
      }
      return;
    }
  })();
  return true;
});

// Click en notificación nativa → abre el link de la notif si lo tiene.
chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId);
  const { lastTaskUrl, hubUrl, notifications } = await getState();
  // Si la notif es de una grabación recién subida → abrir tarea.
  if (lastTaskUrl && !notificationId.startsWith("hub-notif-")) {
    chrome.tabs.create({ url: lastTaskUrl });
    return;
  }
  // Si es de Hub (hub-notif-<id>): abrir el link de la notif.
  const id = notificationId.replace(/^hub-notif-/, "");
  const notif = notifications.find((n) => n.id === id);
  if (notif?.link) {
    const url = notif.link.startsWith("http")
      ? notif.link
      : (hubUrl ?? "https://hub.negociovivo.app").replace(/\/$/, "") + notif.link;
    chrome.tabs.create({ url });
  } else {
    chrome.tabs.create({ url: hubUrl ?? "https://hub.negociovivo.app" });
  }
});

// Alarma de polling
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "poll-notifications") {
    await pollNotifications();
  }
});

// Al instalar / actualizar
chrome.runtime.onInstalled.addListener(async () => {
  const { apiKey } = await getState();
  if (apiKey) {
    await ensureNotificationsAlarm();
  } else {
    // Abrir popup para que el user se loguee.
    chrome.action.openPopup?.().catch(() => {});
  }
});

// Re-armar la alarma al arrancar el navegador
chrome.runtime.onStartup.addListener(async () => {
  const { apiKey } = await getState();
  if (apiKey) await ensureNotificationsAlarm();
});
