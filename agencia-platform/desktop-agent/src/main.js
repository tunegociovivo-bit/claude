const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, powerMonitor, systemPreferences } = require("electron");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const axios = require("axios");
const screenshot = require("screenshot-desktop");
const sharp = require("sharp");
const Store = require("electron-store");
const keytar = require("keytar");

const HUB_URL = "https://hub.negociovivo.app";
const store = new Store({ defaults: { intervalMin: 10, jitterPct: 20, retentionDays: 30, paused: false, screenshots: true, blur: false, excludedApps: ["1Password", "Bitwarden", "KeePass", "Keychain Access", "Bancos", "Private Browsing"] } });
const SERVICE = "NegocioVivoTimeAgent";
const deviceId = store.get("deviceId") || crypto.createHash("sha256").update(`${os.hostname()}-${os.userInfo().username}-${os.platform()}`).digest("hex").slice(0, 24);
store.set("deviceId", deviceId);
let tray, window, timer, activityTimer, lastTick = Date.now();
let lastPolicySync = 0;
let lastShiftSync = 0;
const isBackgroundLaunch = process.argv.some(arg => ["--background", "--hidden", "--minimized"].includes(String(arg).toLowerCase()));
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#4f46e5"/><circle cx="10" cy="10" r="6" fill="none" stroke="white" stroke-width="1.6"/><path d="M10 6v4l3 2" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const trayIcon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(traySvg).toString("base64")}`);

async function activeWindow() {
  // Keep this passive: external command probes are noisy for endpoint security tools.
  return null;
}

async function token() { return keytar.getPassword(SERVICE, "agent-token"); }
function api(pathname) { return `${HUB_URL}${pathname}`; }
function excluded(name = "") { return store.get("excludedApps", []).some(x => name.toLowerCase().includes(String(x).toLowerCase())); }
function schedule() {
  clearTimeout(timer);
  const base = Math.max(2, Number(store.get("intervalMin"))) * 60000;
  const jitter = base * Math.min(.5, Math.max(0, Number(store.get("jitterPct"))) / 100);
  timer = setTimeout(captureCycle, base - jitter + Math.random() * jitter * 2);
}
async function headers() { const t = await token(); return t ? { Authorization: `Bearer ${t}` } : {}; }
async function connectWithAgentToken(agentToken) {
  await axios.get(api("/api/v1/time-tracking/agent-config"), { headers: { Authorization: `Bearer ${agentToken}` }, timeout: 15000 });
  await keytar.setPassword(SERVICE, "agent-token", agentToken);
  store.set("onboarded", true);
  lastPolicySync = 0;
  await syncPolicy();
  schedule(); updateMenu();
}
async function syncShiftState(force = false) {
  if (!force && Date.now() - lastShiftSync < 30000) return;
  const response = await axios.get(api("/api/v1/time-tracking/me"), { headers: await headers(), timeout: 15000 });
  if (!store.get("paused")) store.set("shiftActive", response.data?.active === true);
  lastShiftSync = Date.now();
}
async function syncPolicy() {
  if (Date.now() - lastPolicySync < 300000) return;
  const response = await axios.get(api("/api/v1/time-tracking/agent-config"), { headers: await headers(), timeout: 15000 });
  const p = response.data || {};
  store.set("trackingEnabled", p.trackingEnabled !== false);
  store.set("screenshots", p.screenshotsEnabled !== false);
  store.set("intervalMin", p.screenshotInterval || 10);
  store.set("jitterPct", p.screenshotJitter ?? 20);
  store.set("retentionDays", p.retentionDays || 30);
  store.set("blur", p.blurScreenshots === true);
  store.set("allowPrivateMode", p.allowPrivateMode !== false);
  store.set("excludedApps", Array.isArray(p.excludedApps) ? p.excludedApps : []);
  lastPolicySync = Date.now();
  store.set("lastConnectedAt", new Date().toISOString());
  store.delete("lastError");
}
async function postActivity(win) {
  const now = new Date(); now.setSeconds(0, 0);
  const elapsed = Math.min(300, Math.max(1, Math.round((Date.now() - lastTick) / 1000))); lastTick = Date.now();
  const idle = powerMonitor.getSystemIdleTime() > 300;
  await axios.post(api("/api/v1/time-tracking/activity"), { deviceId, entries: [{ bucketStart: now.toISOString(), durationSec: elapsed, appName: win?.owner?.name || null, windowTitle: win?.title?.slice(0, 300) || null, idle, privateMode: Boolean(store.get("paused")) }] }, { headers: await headers(), timeout: 15000 });
}
async function activityCycle() {
  try {
    await syncPolicy();
    await syncShiftState();
    if (!store.get("shiftActive") || store.get("paused")) return;
    if (store.get("trackingEnabled") !== false) await postActivity(await activeWindow().catch(() => null));
  } catch (e) { store.set("lastError", String(e?.message || e)); }
}
function startActivityHeartbeat() {
  clearInterval(activityTimer);
  activityTimer = setInterval(activityCycle, 60_000);
  activityCycle();
}
async function captureCycle() {
  try {
    await syncPolicy();
    if (store.get("trackingEnabled") === false) return;
    await syncShiftState();
    if (!store.get("shiftActive")) return;
    const win = await activeWindow().catch(() => null);
    if (store.get("paused") || !store.get("screenshots") || excluded(win?.owner?.name) || excluded(win?.title)) return;
    if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") !== "granted") return;
    let image = await screenshot({ format: "png" });
    let pipeline = sharp(image).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 68 });
    if (store.get("blur")) pipeline = pipeline.blur(10);
    image = await pipeline.toBuffer();
    const form = new FormData();
    form.append("file", new Blob([image], { type: "image/webp" }), "capture.webp");
    form.append("deviceId", deviceId); form.append("capturedAt", new Date().toISOString());
    form.append("retentionDays", String(store.get("retentionDays"))); form.append("appName", win?.owner?.name || "");
    form.append("blurred", String(Boolean(store.get("blur"))));
    const response = await fetch(api("/api/v1/time-tracking/screenshots"), { method: "POST", headers: await headers(), body: form });
    if (!response.ok) {
      let detail = `Error subiendo captura (${response.status})`;
      try { const payload = await response.json(); detail = payload?.error?.message || payload?.message || detail; } catch {}
      throw new Error(detail);
    }
    store.delete("lastError");
    store.set("lastScreenshotAt", new Date().toISOString());
  } catch (e) { store.set("lastError", String(e?.message || e)); } finally { schedule(); updateMenu(); }
}
async function togglePause() {
  if (!store.get("shiftActive")) return { ok: false, error: "La jornada no está iniciada" };
  try {
    if (store.get("paused")) {
      await axios.post(api("/api/v1/time-tracking"), { action: "start", deviceId }, { headers: await headers(), timeout: 15000 });
      store.set("paused", false);
    } else {
      await axios.post(api("/api/v1/time-tracking"), { action: "stop" }, { headers: await headers(), timeout: 15000 });
      store.set("paused", true);
    }
    lastTick = Date.now(); updateMenu();
    return { ok: true };
  } catch (error) {
    const message = error?.response?.data?.error?.message || "No se pudo cambiar la pausa";
    store.set("lastError", message);
    return { ok: false, error: message };
  }
}
function updateMenu() {
  if (!tray) return;
  const paused = store.get("paused");
  tray.setToolTip(`Negocio Vivo Control Horario · ${paused ? "Pausado" : "Activo"}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: paused ? "Reanudar seguimiento" : "Pausar / tiempo privado", enabled: store.get("shiftActive") && store.get("allowPrivateMode") !== false, click: () => { togglePause(); } },
    { label: "Configuración y privacidad", click: showWindow },
    { type: "separator" }, { label: "Salir", click: () => app.quit() }
  ]));
}
function showWindow() {
  if (!window) createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.moveTop();
}
function createWindow() {
  window = new BrowserWindow({ width: 520, height: 680, show: false, resizable: false, title: "Negocio Vivo Control Horario", webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false } });
  window.loadFile(path.join(__dirname, "settings.html")); window.on("close", e => { if (!app.isQuitting) { e.preventDefault(); window.hide(); } });
}
ipcMain.handle("status:get", async () => {
  const connected = Boolean(await token());
  if (connected) await syncShiftState(true).catch(() => {});
  return { connected, active: Boolean(store.get("shiftActive")), paused: Boolean(store.get("paused")), lastConnectedAt: store.get("lastConnectedAt") || null };
});
ipcMain.handle("shift:set", async (_e, action) => {
  try {
    if (action === "pause") {
      return togglePause();
    }
    if (action !== "start" && action !== "stop") return { ok: false, error: "Acción no válida" };
    if (action === "stop" && store.get("paused")) {
      store.set("shiftActive", false); store.set("paused", false); updateMenu();
      return { ok: true };
    }
    await axios.post(api("/api/v1/time-tracking"), action === "start" ? { action, deviceId } : { action }, { headers: await headers(), timeout: 15000 });
    store.set("shiftActive", action === "start");
    store.set("paused", false);
    lastShiftSync = Date.now(); lastTick = Date.now(); updateMenu();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.response?.data?.error?.message || "No se pudo actualizar la jornada" };
  }
});
ipcMain.handle("enrollment:set", async (_e, input) => {
  const code = String(input || "").trim();
  if (!code) return { ok: false, error: "Introduce el codigo de vinculacion" };
  if (code.toUpperCase().startsWith("NVV-")) return { ok: false, error: "Ese es un codigo de verificacion antiguo. Pide al administrador una credencial nueva desde el Hub." };
  try {
    let agentToken = code;
    if (code.toUpperCase().startsWith("NV-")) {
      const redeemed = await axios.post(api("/api/public/time-tracking/enrollment-redeem"), { code, deviceId }, { timeout: 15000 });
      agentToken = redeemed.data?.token;
      if (!agentToken) throw new Error("missing_agent_token");
    }
    await connectWithAgentToken(agentToken);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.response?.status === 401 ? "Codigo no valido o caducado" : "No se pudo conectar con el Hub" };
  }
});
app.on("second-instance", () => showWindow());
app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true, args: ["--background"] });
  createWindow();
  tray = new Tray(trayIcon);
  updateMenu();
  startActivityHeartbeat();
  schedule();
  if (!isBackgroundLaunch) showWindow();
});
app.on("before-quit", () => { app.isQuitting = true; }); app.on("window-all-closed", e => e.preventDefault());
