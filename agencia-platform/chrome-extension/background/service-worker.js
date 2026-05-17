/**
 * Service worker (MV3) de la extensión Hub Negocio Vivo.
 *
 * Auth: usa la COOKIE de sesión de hub.negociovivo.app. No hay
 * formulario en el popup — si el user está logueado en el navegador
 * (cualquier pestaña), la extensión lo detecta y se vincula sola.
 * Si no, el popup muestra un único botón "Conectar con Hub" que
 * abre /login en una pestaña; cuando el user vuelve al popup ya
 * tiene cookie y funciona.
 *
 * Implementación:
 *  - host_permissions sobre hub.negociovivo.app + permiso "cookies".
 *  - fetch(...) desde background/popup/offscreen lleva
 *    credentials: "include" y Chrome envía la cookie de sesión
 *    automáticamente.
 *  - Polling cada 5 min a /api/v1/me para refrescar el estado
 *    "logueado" y detectar logout en otra pestaña.
 *
 * Resto sin cambios: grabación con tabCapture + offscreen +
 * MediaRecorder, polling de notificaciones, detección de fin de
 * reunión.
 */

const HUB_BASE_DEFAULT = "https://hub.negociovivo.app";
const OFFSCREEN_PATH = "offscreen/offscreen.html";
const NOTIF_POLL_MIN = 2;
const SESSION_POLL_MIN = 5; // refrescar el "logueado" cada 5 min

// ─────────────────────────────────────────────────────────────────────
// Estado persistido
// ─────────────────────────────────────────────────────────────────────

async function getState() {
  const r = await chrome.storage.local.get([
    "state", "hubUrl", "user", "workspace",
    "lastTaskUrl", "lastError", "notifications", "lastNotifSeenAt"
  ]);
  return {
    state: r.state ?? "idle",
    hubUrl: r.hubUrl ?? HUB_BASE_DEFAULT,
    user: r.user ?? null,
    workspace: r.workspace ?? null,
    lastTaskUrl: r.lastTaskUrl ?? null,
    lastError: r.lastError ?? null,
    notifications: r.notifications ?? [],
    lastNotifSeenAt: r.lastNotifSeenAt ?? 0
  };
}
async function setState(patch) {
  const curr = await getState();
  const next = { ...curr, ...patch };
  await chrome.storage.local.set(next);
  chrome.runtime.sendMessage({ type: "state-changed", state: next }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────
// Auth via cookie de sesión del Hub
// ─────────────────────────────────────────────────────────────────────

/**
 * Llama a /api/v1/me con la cookie de sesión. Si el user está
 * logueado en el Hub en cualquier pestaña, el navegador envía la
 * cookie y nos devuelve {user, workspaceId, role}.
 *
 * Devuelve null si no hay sesión (401) o si la red falló.
 */
async function fetchSessionUser() {
  const { hubUrl } = await getState();
  try {
    const r = await fetch(`${hubUrl.replace(/\/$/, "")}/api/v1/me`, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });
    if (r.status === 401 || r.status === 403) return null;
    if (!r.ok) return null;
    const data = await r.json();
    if (!data?.user?.id) return null;
    return {
      user: { id: data.user.id, name: data.user.name, email: data.user.email, image: data.user.image },
      workspaceId: data.workspaceId,
      role: data.role
    };
  } catch {
    return null;
  }
}

/**
 * Refresca el estado de sesión y persiste user/workspace. Si el
 * estado cambia (logueado ⇄ no logueado), avisa al popup vía
 * state-changed.
 */
async function syncSession() {
  const info = await fetchSessionUser();
  const curr = await getState();
  if (info) {
    if (!curr.user || curr.user.id !== info.user.id) {
      await setState({
        user: info.user,
        workspace: { id: info.workspaceId, role: info.role },
        state: curr.state === "login" ? "idle" : curr.state
      });
      // Arranca el polling de notificaciones tras login
      await ensureNotificationsAlarm();
      pollNotifications();
    }
  } else {
    // Sin sesión — limpiamos user para que el popup pinte el botón
    // "Conectar con Hub".
    if (curr.user) {
      await setState({
        user: null,
        workspace: null,
        notifications: [],
        state: "login"
      });
      await chrome.alarms.clear("poll-notifications");
    }
  }
  return !!info;
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

let recordingCtx = null;
const SILENCE_LEVEL = 8;
const SILENCE_MIN = 3;
const ASK_COOLDOWN_MS = 60_000 * 5;

async function startRecording() {
  const { hubUrl, user } = await getState();
  if (!user) throw new Error("Sin sesión activa en el Hub. Abre hub.negociovivo.app y entra.");

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

  recordingCtx = {
    tabId: tab.id,
    tabUrl: tab.url ?? "",
    startedAt: Date.now(),
    lastLoudAt: Date.now(),
    askEndedAt: 0
  };

  await setState({ state: "recording", lastError: null });

  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "start-recording",
    streamId,
    meetingUrl: tab.url ?? "",
    meetingTitle: tab.title ?? "",
    hubUrl
    // OJO: ya no pasamos apiKey. El offscreen sube con credentials: include
    // y la cookie de sesión viaja.
  });
}

async function stopRecording() {
  await chrome.runtime.sendMessage({ target: "offscreen", type: "stop-recording" });
  await setState({ state: "uploading" });
}

async function askIfMeetingEnded(reason) {
  if (!recordingCtx) return;
  const now = Date.now();
  if (now - recordingCtx.askEndedAt < ASK_COOLDOWN_MS) return;
  recordingCtx.askEndedAt = now;

  const reasonText = {
    tab_closed: "Has cerrado la pestaña de la reunión.",
    url_change: "Ya no estás en la URL de la reunión.",
    silence: `Llevamos ${SILENCE_MIN} minutos sin oír audio.`
  }[reason] ?? "La reunión parece haber terminado.";

  chrome.notifications.create("meeting-ended-prompt", {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title: "¿Reunión terminada?",
    message: `${reasonText} Pulsa "Subir ahora" para generar la tarea con el resumen IA o "Sigo grabando" si continúa.`,
    priority: 2,
    requireInteraction: true,
    buttons: [
      { title: "✓ Subir ahora" },
      { title: "⟳ Sigo grabando" }
    ]
  });
}

// ─────────────────────────────────────────────────────────────────────
// Notificaciones del Hub (polling)
// ─────────────────────────────────────────────────────────────────────

async function ensureNotificationsAlarm() {
  await chrome.alarms.clear("poll-notifications");
  await chrome.alarms.clear("poll-session");
  await chrome.alarms.create("poll-notifications", {
    periodInMinutes: NOTIF_POLL_MIN,
    delayInMinutes: 0.05
  });
  await chrome.alarms.create("poll-session", {
    periodInMinutes: SESSION_POLL_MIN,
    delayInMinutes: SESSION_POLL_MIN
  });
}

async function pollNotifications() {
  const { user, hubUrl, notifications, lastNotifSeenAt } = await getState();
  if (!user) return;
  try {
    const r = await fetch(`${hubUrl.replace(/\/$/, "")}/api/v1/notifications`, {
      credentials: "include",
      cache: "no-store"
    });
    if (r.status === 401) {
      // Cookie caducada o user hizo logout en otra tab — reflejamos.
      await syncSession();
      return;
    }
    if (!r.ok) return;
    const data = await r.json();
    const items = Array.isArray(data.items) ? data.items : [];

    const prevIds = new Set(notifications.map((n) => n.id));
    const fresh = items.filter(
      (n) => !prevIds.has(n.id) && new Date(n.createdAt).getTime() > lastNotifSeenAt
    );
    for (const n of fresh.slice(0, 3)) {
      if (n.read) continue;
      const title = titleFor(n.type);
      chrome.notifications.create(`hub-notif-${n.id}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
        title,
        message: n.body || "Tienes una notificación nueva en Hub",
        priority: priorityFor(n.type),
        requireInteraction: /due|alarm|reminder/i.test(n.type)
      });
    }

    await setState({ notifications: items, lastNotifSeenAt: Date.now() });

    const unread = items.filter((n) => !n.read).length;
    chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
    chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : "" });

    chrome.runtime.sendMessage({ type: "notifications-updated" }).catch(() => {});
  } catch (e) {
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
  if (/due|alarm|reminder|deadline/i.test(type)) return 2;
  if (/mention/i.test(type)) return 2;
  return 1;
}

async function markAllRead() {
  const { hubUrl, user } = await getState();
  if (!user) return;
  try {
    await fetch(`${hubUrl.replace(/\/$/, "")}/api/v1/notifications`, {
      method: "PATCH",
      credentials: "include"
    });
    await pollNotifications();
  } catch (e) {
    console.warn(e);
  }
}

async function openHubLogin() {
  const { hubUrl } = await getState();
  await chrome.tabs.create({ url: `${hubUrl.replace(/\/$/, "")}/login` });
}

// ─────────────────────────────────────────────────────────────────────
// Mensajería
// ─────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.from === "popup" && msg?.type === "check-session") {
      const ok = await syncSession();
      sendResponse({ ok });
      return;
    }
    if (msg?.from === "popup" && msg?.type === "open-login") {
      await openHubLogin();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.from === "popup" && msg?.type === "save-hub-url") {
      await chrome.storage.local.set({ hubUrl: msg.hubUrl ?? HUB_BASE_DEFAULT });
      await syncSession();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.from === "popup" && msg?.type === "start") {
      try { await startRecording(); sendResponse({ ok: true }); }
      catch (e) {
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
    if (msg?.from === "offscreen" && msg?.type === "audio-level") {
      if (recordingCtx) {
        if (typeof msg.level === "number" && msg.level >= SILENCE_LEVEL) {
          recordingCtx.lastLoudAt = Date.now();
        } else {
          const silentMs = Date.now() - recordingCtx.lastLoudAt;
          if (silentMs >= SILENCE_MIN * 60_000) askIfMeetingEnded("silence");
        }
      }
      return;
    }
    if (msg?.from === "offscreen" && msg?.type === "upload-result") {
      recordingCtx = null;
      chrome.notifications.clear("meeting-ended-prompt");
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

chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId);
  const { lastTaskUrl, hubUrl, notifications } = await getState();
  if (lastTaskUrl && !notificationId.startsWith("hub-notif-")) {
    chrome.tabs.create({ url: lastTaskUrl });
    return;
  }
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

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIdx) => {
  if (notificationId !== "meeting-ended-prompt") return;
  chrome.notifications.clear(notificationId);
  if (buttonIdx === 0) {
    try { await stopRecording(); } catch (e) { console.warn("[meeting-ended] stop failed:", e); }
  } else {
    if (recordingCtx) recordingCtx.lastLoudAt = Date.now();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "poll-notifications") {
    await pollNotifications();
  } else if (alarm.name === "poll-session") {
    await syncSession();
  }
});

// Al instalar / actualizar: chequea sesión y abre la pestaña del
// Hub si no hay cookie. Si hay → ya estamos listos.
chrome.runtime.onInstalled.addListener(async () => {
  const ok = await syncSession();
  if (ok) {
    await ensureNotificationsAlarm();
  } else {
    chrome.action.openPopup?.().catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const ok = await syncSession();
  if (ok) await ensureNotificationsAlarm();
});

// Detector de fin de reunión: tab cerrada / URL cambia / silencio.
function urlIsActiveMeeting(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const h = u.hostname;
    const p = u.pathname;
    if (/meet\.google\.com$/i.test(h)) return /^\/[a-z0-9-]{8,}/i.test(p);
    if (/teams\.(microsoft|live)\.com$/i.test(h)) return /meetup-join|meeting|conf/i.test(p + u.hash);
    if (/zoom\.us$/i.test(h) || h.endsWith(".zoom.us")) return /\/j\/\d+|\/wc\/\d+|\/meeting/i.test(p);
    if (h.endsWith("whereby.com")) return p.length > 1;
    if (/meet\.jit\.si$/i.test(h)) return p.length > 1;
    if (h.endsWith(".webex.com")) return /meet|join/i.test(p);
    if (h.endsWith(".gotomeeting.com")) return p.length > 1;
    return true;
  } catch {
    return false;
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (recordingCtx && recordingCtx.tabId === tabId) {
    askIfMeetingEnded("tab_closed");
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!recordingCtx || recordingCtx.tabId !== tabId) return;
  if (!changeInfo.url) return;
  if (urlIsActiveMeeting(changeInfo.url)) {
    recordingCtx.tabUrl = changeInfo.url;
    return;
  }
  askIfMeetingEnded("url_change");
});
