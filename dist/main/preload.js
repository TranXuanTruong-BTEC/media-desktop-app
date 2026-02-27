import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("electronAPI", {
    testDownload: (url) => ipcRenderer.invoke("test-download", url),
    download: (url) => ipcRenderer.invoke("download", url),
});
contextBridge.exposeInMainWorld("api", {
    download: (url) => ipcRenderer.invoke("download", url)
});
