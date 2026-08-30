const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, powerMonitor, systemPreferences } = require("electron");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const axios = require("axios");
const screenshot = require("screenshot-desktop");
const sharp = require("sharp");
const Store = require("electron-store");
const keytar = require("keytar");

const store = new Store({ defaults: { hubUrl: "https://hub.negociovivo.app", intervalMin: 10, jitterPct: 20, retentionDays: 30, paused: false, screenshots: true, blur: false, excludedApps: ["1Password", "Bitwarden", "KeePass", "Keychain Access", "Bancos", "Private Browsing"] } });
const SERVICE = "NegocioVivoTimeAgent";
const deviceId = store.get("deviceId") || crypto.createHash("sha256").update(`${os.hostname()}-${os.userInfo().username}-${os.platform()}`).digest("hex").slice(0, 24);
store.set("deviceId", deviceId);
let tray, window, timer, lastTick = Date.now();
const execFileAsync = promisify(execFile);

async function activeWindow() {
  if (process.platform === "win32") {
    const script = `$sig='[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();'; Add-Type -MemberDefinition $sig -Name Win32 -Namespace NV; $h=[NV.Win32]::GetForegroundWindow(); $p=Get-Process | Where-Object {$_.MainWindowHandle -eq $h} | Select-Object -First 1; if($p){[pscustomobject]@{name=$p.ProcessName;title=$p.MainWindowTitle}|ConvertTo-Json -Compress}`;
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 5000 });
    const value = JSON.parse(stdout.trim() || "{}");
    return { owner: { name: value.name || "" }, title: value.title || "" };
  }
  if (process.platform === "darwin") {
    const script = 'tell application "System Events" to tell first application process whose frontmost is true to return {name, name of front window}';
    const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 5000 });
    const [name, ...title] = stdout.trim().split(", ");
    return { owner: { name: name || "" }, title: title.join(", ") };
  }
  return null;
}

async function token() { return keytar.getPassword(SERVICE, "agent-token"); }
function api(pathname) { return `${String(store.get("hubUrl")).replace(/\/$/, "")}${pathname}`; }
function excluded(name = "") { return store.get("excludedApps", []).some(x => name.toLowerCase().includes(String(x).toLowerCase())); }
function schedule() {
  clearTimeout(timer);
  const base = Math.max(2, Number(store.get("intervalMin"))) * 60000;
  const jitter = base * Math.min(.5, Math.max(0, Number(store.get("jitterPct"))) / 100);
  timer = setTimeout(captureCycle, base - jitter + Math.random() * jitter * 2);
}
async function headers() { const t = await token(); return t ? { Authorization: `Bearer ${t}` } : {}; }
async function postActivity(win) {
  const now = new Date(); now.setSeconds(0, 0);
  const elapsed = Math.min(300, Math.max(1, Math.round((Date.now() - lastTick) / 1000))); lastTick = Date.now();
  const idle = powerMonitor.getSystemIdleTime() > 300;
  await axios.post(api("/api/v1/time-tracking/activity"), { deviceId, entries: [{ bucketStart: now.toISOString(), durationSec: elapsed, appName: win?.owner?.name || null, windowTitle: win?.title?.slice(0, 300) || null, idle, privateMode: Boolean(store.get("paused")) }] }, { headers: await headers(), timeout: 15000 });
}
async function captureCycle() {
  try {
    const win = await activeWindow().catch(() => null);
    await postActivity(win);
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
    await fetch(api("/api/v1/time-tracking/screenshots"), { method: "POST", headers: await headers(), body: form });
  } catch (e) { store.set("lastError", String(e?.message || e)); } finally { schedule(); updateMenu(); }
}
function updateMenu() {
  if (!tray) return;
  const paused = store.get("paused");
  tray.setToolTip(`Negocio Vivo Control Horario · ${paused ? "Pausado" : "Activo"}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: paused ? "Reanudar seguimiento" : "Pausar / tiempo privado", click: () => { store.set("paused", !paused); updateMenu(); } },
    { label: "Configuración y privacidad", click: showWindow },
    { type: "separator" }, { label: "Salir", click: () => app.quit() }
  ]));
}
function showWindow() { if (!window) createWindow(); window.show(); window.focus(); }
function createWindow() {
  window = new BrowserWindow({ width: 620, height: 680, show: false, title: "Negocio Vivo Control Horario", webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false } });
  window.loadFile(path.join(__dirname, "settings.html")); window.on("close", e => { if (!app.isQuitting) { e.preventDefault(); window.hide(); } });
}
ipcMain.handle("config:get", async () => ({ ...store.store, hasToken: Boolean(await token()), platform: process.platform }));
ipcMain.handle("config:set", async (_e, input) => { const { apiToken, ...safe } = input; Object.entries(safe).forEach(([k,v]) => store.set(k,v)); if (apiToken) await keytar.setPassword(SERVICE, "agent-token", apiToken); schedule(); updateMenu(); return { ok: true }; });
app.whenReady().then(() => { app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true }); createWindow(); tray = new Tray(nativeImage.createEmpty()); updateMenu(); schedule(); if (!store.get("onboarded")) showWindow(); });
app.on("before-quit", () => { app.isQuitting = true; }); app.on("window-all-closed", e => e.preventDefault());
