/**
 * Popup de la extensión Hub Reuniones.
 *
 * Estados:
 *   - login        — sin token guardado, muestra form email+password
 *                    (con paso adicional 2FA si el server lo pide).
 *   - idle         — logueado, esperando que pulse "Grabar".
 *   - recording    — captura en curso.
 *   - uploading    — subida + procesado en el Hub.
 *   - done / error
 *
 * Notificaciones: se pintan SIEMPRE que hay sesión, debajo del estado
 * actual. El service worker es quien hace el polling (chrome.alarms)
 * y guarda el resultado en chrome.storage.local. Aquí solo leemos.
 *
 * El popup se cierra muchas veces — toda la persistencia va a
 * chrome.storage.local y todo lo que necesite "tick" (cronómetro,
 * polling) lo hace el service worker.
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
    "state", "apiKey", "hubUrl", "user", "workspace",
    "lastTaskUrl", "lastError", "notifications", "needsTotp"
  ]);
  const state = s.state ?? "idle";
  const apiKey = s.apiKey ?? "";
  const hubUrl = s.hubUrl ?? "https://hub.negociovivo.app";

  $("cfg-hub-url").value = hubUrl;

  // ── Sin token: pantalla de login ──
  if (!apiKey) {
    showState("login");
    $("btn-logout").classList.add("hidden");
    $("notifications-block").classList.add("hidden");
    $("config").classList.remove("hidden");
    if (s.needsTotp) $("login-totp-label").classList.remove("hidden");
    else $("login-totp-label").classList.add("hidden");
    return;
  }

  // ── Logueado ──
  $("btn-logout").classList.remove("hidden");
  $("config").classList.add("hidden");
  if (s.user?.email) $("user-chip").textContent = s.user.email;

  // Pista contextual sobre la tab actual
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const host = tab?.url ? new URL(tab.url).host : "";
    const platform = detectPlatform(host);
    $("meeting-hint").textContent = platform
      ? `📞 Detectada reunión de ${platform}`
      : "ℹ️ Esta pestaña no parece una reunión, pero puedes grabar igualmente.";
  } catch { $("meeting-hint").textContent = ""; }

  showState(state);
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
      if (n.link) chrome.tabs.create({ url: n.link.startsWith("http") ? n.link : hubUrl.replace(/\/$/, "") + n.link });
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

$("btn-login").addEventListener("click", async () => {
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  const totpCode = $("login-totp").value.trim();
  if (!email || !password) {
    $("login-error").textContent = "Email y contraseña obligatorios.";
    $("login-error").classList.remove("hidden");
    return;
  }
  $("btn-login").disabled = true;
  $("login-error").classList.add("hidden");
  const r = await chrome.runtime.sendMessage({
    from: "popup", type: "login", email, password, totpCode
  });
  $("btn-login").disabled = false;
  if (!r?.ok) {
    if (r?.code === "totp_required") {
      $("login-totp-label").classList.remove("hidden");
      $("login-error").textContent = "Introduce el código de 2FA.";
    } else {
      $("login-error").textContent = r?.error ?? "Error al entrar";
    }
    $("login-error").classList.remove("hidden");
    return;
  }
  render();
});

$("btn-logout").addEventListener("click", async () => {
  if (!confirm("¿Cerrar sesión en esta extensión?")) return;
  await chrome.runtime.sendMessage({ from: "popup", type: "logout" });
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
  await chrome.storage.local.set({ hubUrl });
  render();
});

$("btn-mark-read").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ from: "popup", type: "mark-notifications-read" });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "state-changed" || msg?.type === "notifications-updated") render();
});

render();
