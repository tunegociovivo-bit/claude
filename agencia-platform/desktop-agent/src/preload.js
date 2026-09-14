const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("agent", {
  getStatus: () => ipcRenderer.invoke("status:get"),
  enroll: code => ipcRenderer.invoke("enrollment:set", code),
  requestEnrollment: details => ipcRenderer.invoke("enrollment:request", details),
  setShift: action => ipcRenderer.invoke("shift:set", action),
});
