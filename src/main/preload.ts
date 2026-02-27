import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  testDownload: (url: string) =>
    ipcRenderer.invoke("test-download", url),
  download: (url: string) =>
    ipcRenderer.invoke("download", url),
});
contextBridge.exposeInMainWorld("api", {
  download: (url: string) => ipcRenderer.invoke("download", url)
});