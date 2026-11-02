// Runs in the isolated renderer before the app loads. The UI gets exactly the
// handful of calls below — no Node, no filesystem, no arbitrary shell.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("forge", {
  platform: process.platform,
  status: () => ipcRenderer.invoke("forge:status"),
  startServer: () => ipcRenderer.invoke("forge:start-server"),
  pullModel: (model) => ipcRenderer.invoke("forge:pull-model", String(model ?? "")),
  cancel: () => ipcRenderer.invoke("forge:cancel"),
  installOllama: () => ipcRenderer.invoke("forge:open-ollama"),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("forge:setup-event", listener);
    return () => ipcRenderer.removeListener("forge:setup-event", listener);
  },
});
