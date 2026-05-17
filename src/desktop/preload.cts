const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

contextBridge.exposeInMainWorld("pianpian", {
  step(input: string) {
    return ipcRenderer.invoke("pianpian:step", input);
  },
  stats() {
    return ipcRenderer.invoke("pianpian:stats");
  },
  memories(limit: number) {
    return ipcRenderer.invoke("pianpian:memories", limit);
  },
  autonomy() {
    return ipcRenderer.invoke("pianpian:autonomy");
  },
  startAutonomy() {
    return ipcRenderer.invoke("pianpian:autonomy-start");
  },
  stopAutonomy() {
    return ipcRenderer.invoke("pianpian:autonomy-stop");
  },
  heartbeat() {
    return ipcRenderer.invoke("pianpian:autonomy-heartbeat");
  },
});
