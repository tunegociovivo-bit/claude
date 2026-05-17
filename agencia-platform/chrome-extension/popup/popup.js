/**
 * Popup de la extensión Hub Negocio Vivo.
 *
 * Estados:
 *   - login        — sin sesión en el Hub. Pinta "Conectar con Hub"
 *                    (abre /login en una pestaña) + "Ya he entrado, reintentar".
 *   - idle         — logueado, esperando que pulse "Grabar".
 *   - recording    — captura en curso.
 *   - uploading    — subida + procesado en el Hub.
 *   - done / error
 *
 * Auth: la extensión usa la COOKIE de sesión del Hub directamente
 * (host_permissions + credentials: include). No hay formulario.
 * Detecta sesión al abrir el popup llamando a /api/v1/me.
 *
 * Notificaciones: se pintan SIEMPRE que hay sesión, debajo del estado
 * actual. El service worker es quien hace el polling y guarda el
 * resultado en chrome.storage.local.
 */

const $ = (id) => document.getElementById(id);

let elapsedTimer = null;
let elapsedStart = 0;

function showState(name) {
  for (const s of document.querySelectorAll(".state")) s.classList.add("hidden");
  const el = $(`state-${name}`);
  if (el) el.classList.remove("hidden");
}

function startElapsedTimer() {
  elapsedStart = Date.now();
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - elapsedStart) / 1000);
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    $("elapsed").textContent = `${m}:${s}`;
  }, 500);
}
function stopElapsedTimer() {
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
}

function detectPlatform(host) {
  if (/meet\.google\.com/i.test(host)) return "Google Meet";
  if (/teams\.(microsoft|live)\.com/i.test(host)) return "Microsoft Teams";
  if (/zoom\.us/i.test(host)) return "Zoom";
  if (/whereby/i.test(host)) return "Whereby";
  if (/meet\.jit\.si/i.test(host)) return "Jitsi";
  if (/webex/i.test(host)) return "Webex";
  if (/gotomeeting/i.test(host)) return "GoToMeeting";
  return null;
}

function timeAgo(iso) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "ahora";
  if (sec < 3600) return `hace ${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `hace ${Math.floor(sec / 3600)} h`;
  return `hace ${Math.floor(sec / 86400)} d`;
}

/**
 * Pinta el panel de diagnóstico. Independiente del resto del render:
 * cualquier fallo aquí dentro acaba en un mensaje legible en el
 * propio panel — nunca deja "cargando…" infinito.
 */
async function renderDiagnostic() {
  const diagEl = $("diag-output");
  if (!diagEl) return;
  const lines = [];
  try {
    lines.push(`Versión ext.: ${chrome.runtime.getManifest().version}`);
  } catch (e) {
    lines.push(`Versión ext.: (error: ${e?.message ?? e})`);
  }
  try {
    const s = await chrome.storage.local.get(["hubUrl", "user", "state", "notifications", "lastError"]);
    lines.push(`Hub URL: ${s.hubUrl ?? "(default)"}`);
    lines.push(`User: ${s.user?.email ?? "(no conectado)"}`);
    lines.push(`Estado SW: ${s.state ?? "idle"}`);
    lines.push(`Notif no leídas: ${(s.notifications ?? []).filter((n) => !n.read).length}`);
    if (s.lastError) lines.push(`Último error: ${s.lastError}`);
  } catch (e) {
    lines.push(`Storage error: ${e?.message ?? e}`);
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ?? "(sin URL)";
    const host = tab?.url ? new URL(tab.url).host : "";
    const platform = detectPlatform(host);
    lines.push(`Tab URL: ${url}`);
    lines.push(`Tab host: ${host || "—"}`);
    lines.push(`Plataforma: ${platform ?? "no detectada"}`);
  } catch (e) {
    lines.push(`tabs.query error: ${e?.message ?? e}`);
  }
  lines.push(`Hora local: ${new Date().toISOString()}`);
  // Pintamos ya lo que tengamos, y luego añadimos el probe asíncrono
  // (cookie + llamada a /me) cuando llegue, sin bloquear el render.
  diagEl.textContent = lines.join("\n");
  try {
    const probeResult = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      try {
        chrome.runtime.sendMessage({ from: "popup", type: "diag-probe" }, (resp) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
          } else resolve(resp?.probe ?? null);
        });
      } catch (e) {
        clearTimeout(timer);
        resolve({ error: String(e?.message ?? e) });
      }
    });
    if (probeResult) {
      lines.push("─── Probe Hub ───");
      lines.push(`Cookie: ${probeResult.cookieName ?? "?"}${probeResult.cookieLen ? ` (len=${probeResult.cookieLen}, ${probeResult.cookieHead})` : ""}`);
      if (probeResult.cookieReadError) lines.push(`Cookie error: ${probeResult.cookieReadError}`);
      lines.push(`/me status: ${probeResult.meStatus ?? "—"}`);
      if (probeResult.meBody) lines.push(`/me body: ${probeResult.meBody}`);
      if (probeResult.meError) lines.push(`/me error: ${probeResult.meError}`);
      if (probeResult.error) lines.push(`Probe error: ${probeResult.error}`);
      if (probeResult.fatal) lines.push(`Fatal: ${probeResult.fatal}`);
    } else {
      lines.push("Probe Hub: timeout (5s)");
    }
    diagEl.textContent = lines.join("\n");
  } catch (e) {
    lines.push(`Probe Hub error: ${e?.message ?? e}`);
    diagEl.textContent = lines.join("\n");
  }
}

async function render() {
  // SIEMPRE pintamos el diagnóstico, aunque cualquier paso falle.
  // Lo construimos en su propio try/catch encapsulado, antes de tocar
  // el resto del popup, para no romper el render entero por un
  // chrome.tabs.query fallido o un storage corrupto.
  await renderDiagnostic();

  let s;
  try {
    s = await chrome.storage.local.get([
      "state", "hubUrl", "user", "workspace",
      "lastTaskUrl", "lastError", "notifications"
    ]);
  } catch (e) {
    console.warn("[popup] storage.get failed:", e);
    s = {};
  }
  const state = s.state ?? "idle";
  const hubUrl = s.hubUrl ?? "https://hub.negociovivo.app";

  const cfgHub = $("cfg-hub-url");
  if (cfgHub) cfgHub.value = hubUrl;

  // Pintar el "meeting hint" — solo si el user está logueado, si
  // no, la sección está oculta de todos modos.
  if (s.user) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const host = tab?.url ? new URL(tab.url).host : "";
      const platform = detectPlatform(host);
      const hintEl = $("meeting-hint");
      if (hintEl) {
        hintEl.textContent = platform
          ? `📞 Detectada reunión de ${platform}`
          : "ℹ️ Esta pestaña no parece una reunión, pero puedes grabar igualmente.";
      }
    } catch {
      const hintEl = $("meeting-hint");
      if (hintEl) hintEl.textContent = "";
    }
  }

  // Sin user → pantalla de login (pero el diag YA está pintado arriba)
  if (!s.user) {
    showState("login");
    $("notifications-block").classList.add("hidden");
    $("user-chip").textContent = "no conectado";
    return;
  }

  // Logueado
  if (s.user?.email) $("user-chip").textContent = s.user.email;

  // Si el state dice "login" pero ya hay user (porque se acaba de
  // conectar), pasamos a idle.
  showState(state === "login" ? "idle" : state);
  if (state === "recording") { if (!elapsedTimer) startElapsedTimer(); }
  else stopElapsedTimer();

  if (state === "done" && s.lastTaskUrl) $("task-link").href = s.lastTaskUrl;
  if (state === "error") $("error-msg").textContent = s.lastError ?? "Error desconocido";

  renderNotifications(s.notifications ?? [], hubUrl);
}

function renderNotifications(items, hubUrl) {
  const list = $("notif-list");
  list.innerHTML = "";
  const unread = items.filter((n) => !n.read);
  $("notif-count").textContent = unread.length > 0 ? String(unread.length) : "";
  $("notifications-block").classList.remove("hidden");
  if (items.length === 0) {
    $("notif-empty").classList.remove("hidden");
    $("btn-mark-read").classList.add("hidden");
    return;
  }
  $("notif-empty").classList.add("hidden");
  $("btn-mark-read").classList.toggle("hidden", unread.length === 0);
  for (const n of items.slice(0, 8)) {
    const li = document.createElement("li");
    li.className = "notif" + (n.read ? " read" : "");
    const dot = document.createElement("span");
    dot.className = "notif-dot";
    dot.textContent = iconFor(n.type);
    const body = document.createElement("div");
    body.className = "notif-body";
    const text = document.createElement("div");
    text.className = "notif-text";
    text.textContent = n.body;
    const meta = document.createElement("div");
    meta.className = "notif-meta";
    meta.textContent = timeAgo(n.createdAt);
    body.appendChild(text);
    body.appendChild(meta);
    li.appendChild(dot);
    li.appendChild(body);
    li.addEventListener("click", () => {
      if (n.link) chrome.tabs.create({
        url: n.link.startsWith("http") ? n.link : hubUrl.replace(/\/$/, "") + n.link
      });
    });
    list.appendChild(li);
  }
}

function iconFor(type) {
  if (/mention|@/i.test(type)) return "@";
  if (/due|alarm|reminder|deadline/i.test(type)) return "⏰";
  if (/comment/i.test(type)) return "💬";
  if (/assigned|assign/i.test(type)) return "📋";
  return "•";
}

// ─── Listeners ──────────────────────────────────────────────────────

// Al abrir el popup, comprobamos sesión por si el user acaba de
// iniciar sesión en una pestaña aparte y aún no se ha reflejado.
// Init: pinta el popup INMEDIATAMENTE con lo que haya en storage.
// Luego, sin bloquear, pide al SW que revalide la sesión (puede
// tardar 5-10s si el SW está dormido o si la red está lenta). Si la
// llamada falla o se cuelga, NO afecta al render — antes la
// extensión se quedaba en "cargando…" porque awaitábamos esa llamada.
render();
(async () => {
  try {
    // Promise.race con timeout — si el SW no responde en 8s,
    // seguimos adelante con lo que ya pintamos.
    const result = await Promise.race([
      chrome.runtime.sendMessage({ from: "popup", type: "check-session" }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))
    ]);
    // Si llegó respuesta, refrescamos por si cambió el estado de sesión.
    if (result) render();
  } catch (e) {
    // Timeout o SW caído — no hacemos nada, el popup ya está pintado
    // con el estado de storage. El user verá el diag y sabrá qué pasa.
    console.warn("[popup] check-session falló:", e?.message ?? e);
  }
})();

$("btn-open-login").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ from: "popup", type: "open-login" });
});

$("btn-recheck").addEventListener("click", async () => {
  $("btn-recheck").disabled = true;
  $("login-error").classList.add("hidden");
  const r = await chrome.runtime.sendMessage({ from: "popup", type: "check-session" });
  $("btn-recheck").disabled = false;
  if (!r?.ok) {
    $("login-error").textContent =
      "Aún no detecto sesión. Asegúrate de haber iniciado sesión en hub.negociovivo.app y vuelve a probar.";
    $("login-error").classList.remove("hidden");
  }
  render();
});

$("btn-start").addEventListener("click", async () => {
  $("btn-start").disabled = true;
  const r = await chrome.runtime.sendMessage({ from: "popup", type: "start" });
  if (!r?.ok) {
    $("error-msg").textContent = r?.error ?? "No se pudo arrancar";
    showState("error");
  }
});

$("btn-stop").addEventListener("click", async () => {
  $("btn-stop").disabled = true;
  await chrome.runtime.sendMessage({ from: "popup", type: "stop" });
});

$("btn-new").addEventListener("click", async () => {
  await chrome.storage.local.set({ state: "idle", lastTaskUrl: null, lastError: null });
  render();
});

$("btn-retry").addEventListener("click", async () => {
  await chrome.storage.local.set({ state: "idle", lastError: null });
  render();
});

$("btn-save-config").addEventListener("click", async () => {
  const hubUrl = $("cfg-hub-url").value.trim() || "https://hub.negociovivo.app";
  await chrome.runtime.sendMessage({ from: "popup", type: "save-hub-url", hubUrl });
  render();
});

$("btn-mark-read").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ from: "popup", type: "mark-notifications-read" });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "state-changed" || msg?.type === "notifications-updated") render();
});
