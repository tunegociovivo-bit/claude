const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("agent", { getConfig: () => ipcRenderer.invoke("config:get"), saveConfig: value => ipcRenderer.invoke("config:set", value) });
