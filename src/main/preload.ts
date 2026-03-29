// src/main/preload.ts — standalone, zero cross-folder imports
import { contextBridge, ipcRenderer } from "electron";

const IPC = {
  DOWNLOAD_START:    "download:start",
  DOWNLOAD_CANCEL:   "download:cancel",
  SELECT_DIR:        "dialog:select-dir",
  GET_DEFAULT_DIR:   "app:getDefaultDir",
  DOWNLOAD_PROGRESS: "download:progress",
  DOWNLOAD_COMPLETE: "download:complete",
  DOWNLOAD_ERROR:    "download:error",
  OPEN_PATH:         "app:openPath",
  // Auto-updater
  UPDATER_CHECK:        "updater:check",
  UPDATER_STATUS:       "updater:status",
  UPDATER_DOWNLOAD_NOW: "updater:downloadNow",
  UPDATER_INSTALL_NOW:  "updater:installNow",
} as const;

contextBridge.exposeInMainWorld("api", {
  // Downloads
  startDownload:   (req: unknown) => ipcRenderer.send(IPC.DOWNLOAD_START, req),
  cancelDownload:  (id: string)   => ipcRenderer.send(IPC.DOWNLOAD_CANCEL, id),
  selectOutputDir: ()             => ipcRenderer.invoke(IPC.SELECT_DIR),
  getDefaultDir:   ()             => ipcRenderer.invoke(IPC.GET_DEFAULT_DIR),
  openPath:        (p: string)    => ipcRenderer.invoke(IPC.OPEN_PATH, p),
  getAppVersion:   ()             => ipcRenderer.invoke("app:getVersion"),

  // Events
  onProgress: (cb: (p: unknown) => void) => {
    const fn = (_: unknown, p: unknown) => cb(p);
    ipcRenderer.on(IPC.DOWNLOAD_PROGRESS, fn);
    return () => ipcRenderer.removeListener(IPC.DOWNLOAD_PROGRESS, fn);
  },
  onComplete: (cb: (c: unknown) => void) => {
    const fn = (_: unknown, c: unknown) => cb(c);
    ipcRenderer.on(IPC.DOWNLOAD_COMPLETE, fn);
    return () => ipcRenderer.removeListener(IPC.DOWNLOAD_COMPLETE, fn);
  },
  onError: (cb: (e: unknown) => void) => {
    const fn = (_: unknown, e: unknown) => cb(e);
    ipcRenderer.on(IPC.DOWNLOAD_ERROR, fn);
    return () => ipcRenderer.removeListener(IPC.DOWNLOAD_ERROR, fn);
  },

  // Window controls
  winMinimize: () => ipcRenderer.send("win:minimize"),
  winMaximize: () => ipcRenderer.send("win:maximize"),
  winClose:    () => ipcRenderer.send("win:close"),

  // Auto-updater
  checkForUpdate:    () => ipcRenderer.invoke(IPC.UPDATER_CHECK),
  downloadUpdate:    () => ipcRenderer.invoke(IPC.UPDATER_DOWNLOAD_NOW),
  installUpdate:     () => ipcRenderer.invoke(IPC.UPDATER_INSTALL_NOW),
  onUpdaterStatus:   (cb: (s: unknown) => void) => {
    const fn = (_: unknown, s: unknown) => cb(s);
    ipcRenderer.on(IPC.UPDATER_STATUS, fn);
    return () => ipcRenderer.removeListener(IPC.UPDATER_STATUS, fn);
  },
});
