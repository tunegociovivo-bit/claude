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
 * Lee la cookie de sesión de NextAuth desde Chrome (con
 * chrome.cookies.get, que sí puede leer cookies HttpOnly del Hub
 * gracias al permiso "cookies"). NextAuth usa dos nombres según el
 * entorno: __Secure-next-auth.session-token en HTTPS production,
 * next-auth.session-token en local HTTP. Probamos los dos.
 *
 * Devolvemos solo el VALUE (el JWT firmado) para luego mandarlo
 * como Authorization: Bearer al Hub — credentials: include no
 * sirve porque la cookie es SameSite=Lax y Chrome no la envía
 * cross-site desde el contexto chrome-extension://.
 */
async function readHubSessionCookie() {
  const { hubUrl } = await getState();
  const names = [
    "__Secure-next-auth.session-token",
    "next-auth.session-token"
  ];
  for (const name of names) {
    try {
      const c = await chrome.cookies.get({ url: hubUrl, name });
      if (c?.value) return c.value;
    } catch {
      // Sin permiso "cookies" o dominio mal configurado: seguimos
    }
  }
  return null;
}

async function authedFetch(path, init = {}) {
  const { hubUrl } = await getState();
  const headers = new Headers(init.headers ?? {});
  // Intentamos primero SIN Bearer — credentials:include adjunta la
  // cookie del Hub si está disponible (probado: funciona aunque
  // chrome.cookies.get no devuelva la cookie __Secure-).
  const baseUrl = `${hubUrl.replace(/\/$/, "")}${path}`;
  const opts = { ...init, headers, credentials: "include", cache: "no-store" };
  let resp = await fetch(baseUrl, opts);
  // Si el server rechaza por auth, reintentamos añadiendo Bearer con
  // el JWT crudo de la cookie — fallback para entornos donde la
  // cookie no se envíe por algún motivo (algunas configs de SameSite).
  if (resp.status === 401 || resp.status === 403) {
    const cookieValue = await readHubSessionCookie();
    if (cookieValue) {
      const retryHeaders = new Headers(headers);
      retryHeaders.set("Authorization", `Bearer ${cookieValue}`);
      resp = await fetch(baseUrl, { ...opts, headers: retryHeaders });
    }
  }
  return resp;
}

/**
 * Llama a /api/v1/me con la cookie de sesión leída de Chrome y
 * pasada como Bearer (porque SameSite=Lax bloquea cookies cross-site
 * desde extension contexts).
 *
 * Devuelve null si no hay sesión (401) o si la red falló.
 */
async function fetchSessionUser() {
  try {
    const r = await authedFetch("/api/v1/me");
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

function detectMeetingPlatform(url) {
  const u = (url ?? "").toLowerCase();
  if (u.includes("meet.google.com")) return "meet";
  if (u.includes("teams.microsoft.com") || u.includes("teams.live.com")) return "teams";
  if (u.includes("zoom.us")) return "zoom";
  if (u.includes("whereby.com")) return "whereby";
  if (u.includes("meet.jit.si")) return "jitsi";
  if (u.includes("webex.com")) return "webex";
  if (u.includes("gotomeeting.com")) return "gotomeeting";
  return "unknown";
}

async function startRecording(opts = {}) {
  const { hubUrl, user } = await getState();
  if (!user) throw new Error("Sin sesión activa en el Hub. Abre hub.negociovivo.app y entra.");

  // Si el caller pasó tabId (banner in-page), úsalo. Si no, tab activa.
  let tab;
  if (opts.tabId) {
    try { tab = await chrome.tabs.get(opts.tabId); } catch {}
  }
  if (!tab) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = active;
  }
  if (!tab) throw new Error("No se ha podido detectar la pestaña activa.");

  // CRÍTICO: getMediaStreamId debe llamarse con el gesto de usuario
  // todavía "fresco" (<5s desde el click). Cualquier await previo
  // consume tiempo del gesto. ensureOffscreen suele ser <50ms pero
  // mejor ponerlo en paralelo. La cookie y la sesión live se leen
  // DESPUÉS — no las necesitamos para arrancar la captura.
  const offscreenP = ensureOffscreen();

  let streamId;
  try {
    streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!id) reject(new Error("getMediaStreamId devolvió vacío"));
        else resolve(id);
      });
    });
  } catch (e) {
    // Mensaje más útil: tabCapture falla típicamente por (a) la tab no
    // está activa o (b) el gesto de usuario expiró. Lo reportamos claro.
    throw new Error(
      `No se pudo capturar la pestaña (${e.message}). ` +
      `Asegúrate de pulsar "Grabar" estando en la pestaña de la reunión.`
    );
  }
  await offscreenP;

  recordingCtx = {
    tabId: tab.id,
    tabUrl: tab.url ?? "",
    startedAt: Date.now(),
    lastLoudAt: Date.now(),
    askEndedAt: 0,
    // Destino de la tarea resultante (banner in-page → user los eligió).
    // Si null/undefined, el backend usará primer proyecto + status TODO.
    projectId: opts.projectId ?? null,
    status: opts.status ?? null
  };

  // Marcamos "recording" YA — esto dispara onChanged en el popup que
  // pinta el timer + botón Detener instantáneamente. Antes ocurría
  // después de leer cookie + live-start, lo que daba 1-3s de "limbo".
  await setState({ state: "recording", lastError: null });

  // Leemos la cookie de sesión del Hub UNA vez y se la pasamos al
  // offscreen para que la mande como Authorization Bearer en la
  // subida. SameSite=Lax bloquea cookies cross-site desde extension
  // contexts, por eso no podemos confiar en credentials: include.
  const sessionJwt = await readHubSessionCookie();

  // Φ5 — si el user pidió modo "live", pre-creamos LiveMeetingSession.
  // Con timeout para que un backend lento no bloquee el inicio de la
  // grabación (si falla, simplemente no hay modo live — la grabación
  // sigue funcionando).
  let liveSessionId = null;
  if (opts.live) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await authedFetch("/api/v1/extension/live-meeting/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: detectMeetingPlatform(tab.url ?? ""),
          meetingUrl: tab.url ?? "",
          meetingTitle: tab.title ?? ""
        }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (r.ok) {
        const data = await r.json();
        liveSessionId = data.sessionId;
        recordingCtx.liveSessionId = liveSessionId;
      }
    } catch (e) {
      console.warn("[sw] live-meeting/start failed:", e?.message ?? e);
    }
  }

  // No await — el sendMessage al offscreen no necesita respuesta.
  // El offscreen tiene su propio listener y arranca al recibirlo.
  // Esperar aquí solo añade latencia y a veces se cuelga si no hay
  // listener (timing del createDocument).
  chrome.runtime.sendMessage({
    target: "offscreen",
    type: "start-recording",
    streamId,
    meetingUrl: tab.url ?? "",
    meetingTitle: tab.title ?? "",
    hubUrl,
    sessionJwt,
    projectId: recordingCtx.projectId,
    status: recordingCtx.status,
    liveSessionId
  }).catch(() => {});
}

async function stopRecording() {
  // Si no hay offscreen ni recordingCtx (porque startRecording falló
  // a medias), no hay nada que parar — limpiamos estado y salimos.
  // Esto evita que el botón "Detener" se quede sin efecto.
  if (!recordingCtx && !(await hasOffscreenDocument())) {
    await setState({ state: "idle", lastError: null });
    return;
  }
  chrome.runtime.sendMessage({ target: "offscreen", type: "stop-recording" }).catch(() => {});
  await setState({ state: "uploading" });
  // Watchdog: si en 6 min no ha llegado upload-result (fetch colgado, SW
  // reciclado, offscreen muerto…), sacamos el estado de "uploading" para que
  // el popup no se quede bloqueado para siempre. chrome.alarms sobrevive al
  // reciclado del service worker (setTimeout no).
  try {
    chrome.alarms.create("upload-watchdog", { delayInMinutes: 6 });
  } catch {}
  // Φ5 — finalizar LiveMeetingSession si hubo modo live activo.
  // El upload final del audio entero (existing flow) sigue intacto.
  if (recordingCtx?.liveSessionId) {
    try {
      await authedFetch("/api/v1/extension/live-meeting/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: recordingCtx.liveSessionId,
          projectId: recordingCtx.projectId ?? undefined,
          status: recordingCtx.status ?? undefined
        })
      });
    } catch (e) {
      console.warn("[sw] live-meeting/end failed:", e?.message ?? e);
    }
  }
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
    const r = await authedFetch("/api/v1/notifications");
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
    await authedFetch("/api/v1/notifications", { method: "PATCH" });
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
    if (msg?.from === "popup" && msg?.type === "diag-probe") {
      // Probe completo: cookie + llamada a /me. Devolvemos solo
      // metadatos (longitud, primeros chars) — NUNCA el token entero.
      const out = {};
      try {
        const { hubUrl } = await getState();
        out.hubUrl = hubUrl;
        const names = ["__Secure-next-auth.session-token", "next-auth.session-token"];
        for (const name of names) {
          try {
            const c = await chrome.cookies.get({ url: hubUrl, name });
            if (c?.value) {
              out.cookieName = name;
              out.cookieLen = c.value.length;
              out.cookieHead = c.value.slice(0, 8) + "…";
              break;
            }
          } catch (e) {
            out.cookieReadError = String(e?.message ?? e);
          }
        }
        if (!out.cookieName) out.cookieName = "(no encontrada)";
        // Llamada directa a /me con timeout 4s
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 7000);
          const r = await authedFetch("/api/v1/me", { signal: ctrl.signal });
          clearTimeout(t);
          out.meStatus = r.status;
          const txt = await r.text();
          out.meBody = txt.slice(0, 200);
        } catch (e) {
          out.meError = String(e?.message ?? e);
        }
      } catch (e) {
        out.fatal = String(e?.message ?? e);
      }
      sendResponse({ ok: true, probe: out });
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
      try {
        await startRecording({
          projectId: msg.projectId ?? null,
          status: msg.status ?? null
        });
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
    if (msg?.from === "offscreen" && msg?.type === "live-suggestions") {
      // Φ5 — el offscreen recibió sugerencias del backend tras un
      // chunk live. Las reenviamos a la pestaña de la reunión para
      // que el content-script las muestre en overlay flotante.
      if (recordingCtx?.tabId && Array.isArray(msg.suggestions)) {
        try {
          await chrome.tabs.sendMessage(recordingCtx.tabId, {
            from: "sw",
            type: "live-suggestions",
            sessionId: msg.sessionId,
            suggestions: msg.suggestions
          });
        } catch {
          // El content-script puede no estar listo o la pestaña ya cerrada.
        }
      }
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
      try { chrome.alarms.clear("upload-watchdog"); } catch {}
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
      let { notifications, user } = await getState();
      const unread = notifications.filter((n) => !n.read).length;
      if (unread === 0) {
        chrome.action.setBadgeText({ text: "●", tabId: sender.tab?.id });
        chrome.action.setBadgeBackgroundColor({ color: "#dc2626", tabId: sender.tab?.id });
      }
      // Si el SW aún no tiene `user` en storage (cold start, primera
      // vez tras instalar la extensión), hacemos un syncSession AHORA
      // mismo. Sin esto, el banner no se autoabre hasta que el user
      // abra el popup por primera vez — UX rota.
      if (!user) {
        try { await syncSession(); } catch {}
        ({ user } = await getState());
      }
      // Respondemos al content-script con la decisión: si está logueado
      // y no hay grabación activa, debería mostrar el banner. Pull en
      // lugar de push para evitar races (el content puede tardar en
      // registrar su onMessage listener).
      sendResponse({
        ok: true,
        shouldShowBanner: !!(user && !recordingCtx)
      });
      return;
    }
    if ((msg?.from === "content" || msg?.from === "popup") && msg?.type === "fetch-projects") {
      try {
        const r = await authedFetch("/api/v1/projects");
        if (!r.ok) {
          sendResponse({ ok: false, error: `HTTP ${r.status}` });
          return;
        }
        const data = await r.json();
        const projects = (data.items ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          kanbanColumns: p.kanbanColumns ?? null
        }));
        sendResponse({ ok: true, projects });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message ?? e) });
      }
      return;
    }
    // Banner → guarda el destino elegido y abre el popup. La captura
    // (tabCapture) NO puede arrancar desde el banner: Chrome exige invocar
    // la extensión por su icono (activeTab). El popup lee este "pendingRecord"
    // y preselecciona proyecto/columna para que el user solo pulse Grabar.
    if (msg?.from === "content" && msg?.type === "prepare-record-from-banner") {
      try {
        await chrome.storage.local.set({
          pendingRecord: {
            projectId: msg.projectId ?? null,
            status: msg.status ?? null,
            live: !!msg.live,
            tabId: sender.tab?.id ?? null,
            at: Date.now()
          }
        });
        let opened = false;
        try {
          await chrome.action.openPopup();
          opened = true;
        } catch {
          // openPopup no disponible / sin gesto válido — el user lo abre a mano.
        }
        sendResponse({ ok: true, opened });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message ?? e) });
      }
      return;
    }
    // Compat: por si alguna versión vieja del banner aún manda esto.
    if (msg?.from === "content" && msg?.type === "start-recording-from-banner") {
      try {
        await chrome.storage.local.set({
          pendingRecord: {
            projectId: msg.projectId ?? null,
            status: msg.status ?? null,
            live: !!msg.live,
            tabId: sender.tab?.id ?? null,
            at: Date.now()
          }
        });
        try { await chrome.action.openPopup(); } catch {}
        sendResponse({ ok: false, error: "Pulsa el icono de la extensión y dale a Grabar." });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message ?? e) });
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
  } else if (alarm.name === "upload-watchdog") {
    // Si seguimos en "uploading" 6 min después de parar, la subida se colgó.
    // Sacamos el estado de bloqueo para que el popup vuelva a ser usable.
    const s = await getState();
    if (s.state === "uploading") {
      recordingCtx = null;
      await setState({
        state: "error",
        lastError:
          "La subida tardó demasiado y se canceló. La reunión puede ser muy larga (>25MB) o el Hub está saturado. Vuelve a intentarlo con una grabación más corta."
      });
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
        title: "Subida de reunión cancelada",
        message: "Tardó demasiado. Inténtalo de nuevo (graba tramos más cortos si la reunión es larga).",
        priority: 2
      });
    }
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

// ─────────────────────────────────────────────────────────────────────
// Badge "estás en una reunión" — independiente del content script
// ─────────────────────────────────────────────────────────────────────
//
// El content-script meeting-detector.js se inyecta solo en pestañas
// NUEVAS (o que recargas) después de instalar la extensión. Si la
// reunión ya estaba abierta antes de instalar, el badge nunca se
// pintaba. Aquí lo gestionamos también desde el SW vía tabs.onUpdated
// + scan inicial al instalar, así no depende del content script.

function hostIsMeetingPlatform(host) {
  if (!host) return false;
  return (
    /meet\.google\.com$/i.test(host) ||
    /teams\.(microsoft|live)\.com$/i.test(host) ||
    /zoom\.us$/i.test(host) || host.endsWith(".zoom.us") ||
    host.endsWith("whereby.com") ||
    /meet\.jit\.si$/i.test(host) ||
    host.endsWith(".webex.com") ||
    host.endsWith(".gotomeeting.com")
  );
}

async function updateMeetingBadgeForTab(tabId, url) {
  let isMeeting = false;
  try {
    if (url) isMeeting = hostIsMeetingPlatform(new URL(url).host);
  } catch {}
  // Si esta tab es la que está grabando, prevalece el badge de
  // notificaciones (gestionado en pollNotifications). El content
  // script ya respeta esto. Replicamos aquí.
  const { notifications } = await getState();
  const unread = notifications.filter((n) => !n.read).length;
  if (unread > 0) return; // que el contador global mande
  if (isMeeting) {
    chrome.action.setBadgeText({ text: "●", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#dc2626", tabId });
  } else {
    chrome.action.setBadgeText({ text: "", tabId });
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Solo nos importa cuando cambia URL o termina de cargar
  if (changeInfo.url || changeInfo.status === "complete") {
    updateMeetingBadgeForTab(tabId, changeInfo.url ?? tab.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    updateMeetingBadgeForTab(tabId, tab.url);
  } catch {}
});

// Al instalar / arrancar el SW: escanea TODAS las tabs existentes y
// badgea las que sean reuniones. Sin esto, si la Meet ya estaba
// abierta antes de instalar, el badge no se ponía nunca.
// ADEMÁS: inyectamos el content-script meeting-detector.js en esas
// tabs — los content_scripts del manifest SOLO se inyectan en tabs
// nuevas/recargadas, no en las que ya estaban abiertas. Sin esto,
// abrir una Meet ANTES de instalar la extensión = banner nunca aparece
// hasta que el user refresca manualmente.
async function scanExistingTabsForMeetings() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id != null && tab.url) {
        updateMeetingBadgeForTab(tab.id, tab.url);
        try {
          if (hostIsMeetingPlatform(new URL(tab.url).host)) {
            // executeScript es idempotente con files duplicados — si ya
            // está inyectado por el manifest, los listeners no se
            // duplican porque están dentro de una IIFE que cachea
            // estado en variables del módulo (bannerOpen, etc.). En
            // caso de doble inyección, peor caso = dos pings, no
            // duplicar banners.
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ["content/meeting-detector.js"]
            }).catch(() => {});
          }
        } catch {}
      }
    }
  } catch {}
}
chrome.runtime.onInstalled.addListener(() => {
  scanExistingTabsForMeetings();
});
chrome.runtime.onStartup.addListener(() => {
  scanExistingTabsForMeetings();
});
// Y un scan adicional cuando el SW arranca por demanda.
scanExistingTabsForMeetings();
