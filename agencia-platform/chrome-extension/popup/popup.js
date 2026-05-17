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

async function render() {
  const s = await chrome.storage.local.get([
    "state", "hubUrl", "user", "workspace",
    "lastTaskUrl", "lastError", "notifications"
  ]);
  const state = s.state ?? "idle";
  const hubUrl = s.hubUrl ?? "https://hub.negociovivo.app";

  $("cfg-hub-url").value = hubUrl;

  // === Diagnóstico SIEMPRE — antes del early return de login. ===
  // Así si el user nos pasa el contenido del popup vemos qué pasa
  // incluso cuando aún no ha conectado.
  const diagLines = [];
  diagLines.push(`Versión ext.: ${chrome.runtime.getManifest().version}`);
  diagLines.push(`Hub URL: ${hubUrl}`);
  diagLines.push(`User: ${s.user?.email ?? "(no conectado)"}`);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ?? "(sin url, ¿pestaña privada/extension?)";
    const host = tab?.url ? new URL(tab.url).host : "";
    const platform = detectPlatform(host);
    diagLines.push(`Tab URL: ${url}`);
    diagLines.push(`Tab host: ${host || "—"}`);
    diagLines.push(`Plataforma: ${platform ?? "no detectada"}`);
    if (s.user) {
      $("meeting-hint").textContent = platform
        ? `📞 Detectada reunión de ${platform}`
        : "ℹ️ Esta pestaña no parece una reunión, pero puedes grabar igualmente.";
    }
  } catch (e) {
    diagLines.push(`Error tabs.query: ${e?.message ?? e}`);
    $("meeting-hint").textContent = "";
  }
  diagLines.push(`Estado SW: ${s.state}`);
  diagLines.push(`Notif no leídas: ${(s.notifications ?? []).filter((n) => !n.read).length}`);
  diagLines.push(`Hora local: ${new Date().toISOString()}`);
  const diagEl = $("diag-output");
  if (diagEl) diagEl.textContent = diagLines.join("\n");

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
(async () => {
  await chrome.runtime.sendMessage({ from: "popup", type: "check-session" });
  render();
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
