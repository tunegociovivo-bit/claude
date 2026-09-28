const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, powerSaveBlocker } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { HUB_ORIGIN, isHub, deviceKey, allowedDevice } = require('./access-policy.cjs');

app.setName('Negocio Vivo Móviles');
const runnerUrl = `${HUB_ORIGIN}/moviles?runner=desktop`;
let window;
let tray;
let quitting = false;
let reloadTimer;
let lastReload = 0;

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.on('before-quit', () => { quitting = true; clearTimeout(reloadTimer); });
  app.whenReady().then(() => {
    const configPath = path.join(app.getPath('userData'), 'usb-grants.json');
    let grants = [];
    try {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (Array.isArray(saved)) grants = saved.filter(item => typeof item === 'string');
    } catch (error) {
      if (error.code !== 'ENOENT') dialog.showErrorBox('Permisos USB', 'No se pudo leer la configuración. Vuelve a elegir los móviles; no se concederá acceso automáticamente.');
    }
    const saveGrants = () => {
      const temporary = `${configPath}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(grants), { mode: 0o600 });
      fs.renameSync(temporary, configPath);
    };
    window = new BrowserWindow({
      width: 1400, height: 950, title: 'Negocio Vivo · Móviles', show: false,
      webPreferences: { partition: 'persist:nv-mobile-agent', sandbox: true, contextIsolation: true,
        nodeIntegration: false, backgroundThrottling: false, webSecurity: true }
    });
    window.removeMenu();
    const session = window.webContents.session;
    session.setPermissionCheckHandler((_contents, permission, origin) => permission === 'usb' && isHub(origin));
    session.setPermissionRequestHandler((_contents, permission, callback, details) => {
      callback(permission === 'usb' && isHub(details.requestingUrl));
    });
    session.setDevicePermissionHandler(details => allowedDevice(details, grants));
    session.on('select-usb-device', async (event, details, callback) => {
      event.preventDefault();
      try {
      if (!isHub(details.frame?.url)) { callback(''); return; }
      const devices = details.deviceList.filter(device => deviceKey(device));
      if (!devices.length) { callback(''); return; }
      const { response } = await dialog.showMessageBox(window, {
        type: 'question', title: 'Conectar un móvil al agente',
        message: 'Elige el móvil que autorizarás para el Hub.',
        detail: 'La autorización se conserva en este PC. El teléfono puede pedir que aceptes la huella USB.',
        buttons: ['Cancelar', ...devices.map(device => `${device.productName || 'Android'} · ${device.serialNumber}`)],
        defaultId: 0, cancelId: 0, noLink: true
      });
      const selected = devices[response - 1];
      if (!selected || !isHub(details.frame?.url)) { callback(''); return; }
      const next = [...new Set([...grants, deviceKey(selected)])];
      const previous = grants;
      grants = next;
      try { saveGrants(); callback(selected.deviceId); }
      catch { grants = previous; callback(''); dialog.showErrorBox('Permiso no guardado', 'No se ha concedido acceso porque no se pudo guardar la autorización.'); }
      } catch { callback(''); }
    });
    session.on('usb-device-revoked', (_event, details) => {
      grants = grants.filter(key => key !== deviceKey(details.device));
      try { saveGrants(); } catch { dialog.showErrorBox('Permisos USB', 'No se pudo guardar la revocación. Cierra el agente y revisa su configuración antes de reiniciarlo.'); }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const restrictNavigation = (event, url) => { if (!isHub(url)) event.preventDefault(); };
    window.webContents.on('will-navigate', restrictNavigation);
    window.webContents.on('will-redirect', restrictNavigation);
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    const retryLoad = () => {
      if (quitting || reloadTimer) return;
      const delay = Math.max(30_000, 60_000 - (Date.now() - lastReload));
      reloadTimer = setTimeout(() => { reloadTimer = undefined; lastReload = Date.now(); window.loadURL(runnerUrl).catch(retryLoad); }, delay);
    };
    window.webContents.on('render-process-gone', retryLoad);
    window.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) retryLoad(); });
    window.webContents.on('did-finish-load', () => { clearTimeout(reloadTimer); reloadTimer = undefined; });
    window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
    window.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) window.show(); });
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 24, height: 24 });
    tray = new Tray(icon);
    tray.setToolTip('Negocio Vivo · Móviles en segundo plano');
    tray.on('double-click', () => { window.show(); window.focus(); });
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir panel de móviles', click: () => { window.show(); window.focus(); } },
      { label: 'Volver al panel de móviles', click: () => { window.loadURL(runnerUrl).catch(retryLoad); window.show(); } },
      { type: 'separator' },
      { label: 'Salir y detener la ejecución', click: () => app.quit() }
    ]));
    powerSaveBlocker.start('prevent-app-suspension');
    window.loadURL(runnerUrl).catch(retryLoad);
  }).catch(error => { dialog.showErrorBox('No se pudo iniciar el agente', String(error.message)); app.quit(); });
}
