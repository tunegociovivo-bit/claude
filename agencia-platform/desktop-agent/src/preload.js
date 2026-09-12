const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("agent", {
  getStatus: () => ipcRenderer.invoke("status:get"),
  enroll: code => ipcRenderer.invoke("enrollment:set", code),
  setShift: action => ipcRenderer.invoke("shift:set", action),
});
