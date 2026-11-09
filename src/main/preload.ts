// src/main/preload.ts — standalone, zero cross-folder imports
import { contextBridge, ipcRenderer, webUtils } from "electron";

const IPC = {
  DOWNLOAD_START:    "download:start",
  DOWNLOAD_CANCEL:   "download:cancel",
  SELECT_DIR:        "dialog:select-dir",
  GET_DEFAULT_DIR:   "app:getDefaultDir",
  DOWNLOAD_PROGRESS: "download:progress",
  DOWNLOAD_COMPLETE: "download:complete",
  DOWNLOAD_ERROR:    "download:error",
  DOWNLOAD_RETRYING: "download:retrying",
  OPEN_PATH:         "app:openPath",
  // Trích xuất văn bản
  TRANSCRIBE_PICK:     "transcribe:pick",
  TRANSCRIBE_STATUS:   "transcribe:status",
  TRANSCRIBE_START:    "transcribe:start",
  TRANSCRIBE_CANCEL:   "transcribe:cancel",
  TRANSCRIBE_SAVE:     "transcribe:save",
  TRANSCRIBE_COPY:     "transcribe:copy",
  LLM_GET_SETTINGS:    "llm:getSettings",
  LLM_SAVE_SETTINGS:   "llm:saveSettings",
  LLM_TEST:            "llm:test",
  BG_INFO:             "bg:info",
  BG_PICK:             "bg:pick",
  BG_ADD_DROPPED:      "bg:addDropped",
  BG_DOWNLOAD_MODEL:   "bg:downloadModel",
  BG_CANCEL_DOWNLOAD:  "bg:cancelDownload",
  BG_MODEL_PROGRESS:   "bg:modelProgress",
  BG_START:            "bg:start",
  BG_CANCEL:           "bg:cancel",
  BG_PROGRESS:         "bg:progress",
  BG_ITEM_DONE:        "bg:itemDone",
  BG_ITEM_ERROR:       "bg:itemError",
  BG_DONE:             "bg:done",
  BG_SAVE:             "bg:save",
  BG_SAVE_ALL:         "bg:saveAll",
  BG_COPY:             "bg:copy",
  BG_CLEAR:            "bg:clear",
  TRANSCRIBE_PROGRESS: "transcribe:progress",
  TRANSCRIBE_DONE:     "transcribe:done",
  TRANSCRIBE_ERROR:    "transcribe:error",
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
  openExternal:    (url: string)  => ipcRenderer.invoke("app:openExternal", url),

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
  onRetrying: (cb: (r: unknown) => void) => {
    const fn = (_: unknown, r: unknown) => cb(r);
    ipcRenderer.on(IPC.DOWNLOAD_RETRYING, fn);
    return () => ipcRenderer.removeListener(IPC.DOWNLOAD_RETRYING, fn);
  },

  // Cookies (nội dung cookie không bao giờ trả về renderer)
  getCookiesStatus: ()             => ipcRenderer.invoke("cookies:status"),
  saveCookies:      (text: string) => ipcRenderer.invoke("cookies:save", text),
  importCookies:    ()             => ipcRenderer.invoke("cookies:import"),
  clearCookies:     ()             => ipcRenderer.invoke("cookies:clear"),
  setCookieBrowser: (b: string)    => ipcRenderer.invoke("cookies:setBrowser", b),
  loginCookies:     (site: string) => ipcRenderer.invoke("cookies:login", site),

  // Trích xuất văn bản (nhận diện giọng nói)
  pickTranscribeFile: ()                 => ipcRenderer.invoke(IPC.TRANSCRIBE_PICK),
  getTranscribeStatus: ()                => ipcRenderer.invoke(IPC.TRANSCRIBE_STATUS),
  startTranscribe:   (req: unknown)      => ipcRenderer.invoke(IPC.TRANSCRIBE_START, req),
  cancelTranscribe:  (id: string)        => ipcRenderer.send(IPC.TRANSCRIBE_CANCEL, id),
  saveTranscribeSrt: (id: string)        => ipcRenderer.invoke(IPC.TRANSCRIBE_SAVE, id),
  copyTranscribeText: (id: string)       => ipcRenderer.invoke(IPC.TRANSCRIBE_COPY, id),
  // Cài đặt AI dịch (API key không bao giờ đi về phía giao diện)
  getLlmSettings:  ()                => ipcRenderer.invoke(IPC.LLM_GET_SETTINGS),
  saveLlmSettings: (req: unknown)    => ipcRenderer.invoke(IPC.LLM_SAVE_SETTINGS, req),
  testLlm:         ()                => ipcRenderer.invoke(IPC.LLM_TEST),
  // Tách nền ảnh
  getPathForFile:      (f: File)               => { try { return webUtils.getPathForFile(f); } catch { return ""; } },
  getBgInfo:           ()                      => ipcRenderer.invoke(IPC.BG_INFO),
  pickBgImages:        ()                      => ipcRenderer.invoke(IPC.BG_PICK),
  addDroppedBgImages:  (paths: string[])       => ipcRenderer.invoke(IPC.BG_ADD_DROPPED, paths),
  downloadBgModel:     (id: string)            => ipcRenderer.invoke(IPC.BG_DOWNLOAD_MODEL, id),
  cancelBgModelDownload: (id: string)          => ipcRenderer.send(IPC.BG_CANCEL_DOWNLOAD, id),
  startBg:             (req: unknown)          => ipcRenderer.invoke(IPC.BG_START, req),
  cancelBg:            (id: string)            => ipcRenderer.send(IPC.BG_CANCEL, id),
  saveBgImage:         (id: string, token: string) => ipcRenderer.invoke(IPC.BG_SAVE, id, token),
  saveAllBg:           (id: string)            => ipcRenderer.invoke(IPC.BG_SAVE_ALL, id),
  copyBgImage:         (id: string, token: string) => ipcRenderer.invoke(IPC.BG_COPY, id, token),
  clearBg:             ()                      => ipcRenderer.invoke(IPC.BG_CLEAR),
  onBgModelProgress: (cb: (p: unknown) => void) => { const fn = (_: unknown, p: unknown) => cb(p); ipcRenderer.on(IPC.BG_MODEL_PROGRESS, fn); return () => ipcRenderer.removeListener(IPC.BG_MODEL_PROGRESS, fn); },
  onBgProgress:      (cb: (p: unknown) => void) => { const fn = (_: unknown, p: unknown) => cb(p); ipcRenderer.on(IPC.BG_PROGRESS, fn);       return () => ipcRenderer.removeListener(IPC.BG_PROGRESS, fn); },
  onBgItemDone:      (cb: (p: unknown) => void) => { const fn = (_: unknown, p: unknown) => cb(p); ipcRenderer.on(IPC.BG_ITEM_DONE, fn);      return () => ipcRenderer.removeListener(IPC.BG_ITEM_DONE, fn); },
  onBgItemError:     (cb: (p: unknown) => void) => { const fn = (_: unknown, p: unknown) => cb(p); ipcRenderer.on(IPC.BG_ITEM_ERROR, fn);     return () => ipcRenderer.removeListener(IPC.BG_ITEM_ERROR, fn); },
  onBgDone:          (cb: (p: unknown) => void) => { const fn = (_: unknown, p: unknown) => cb(p); ipcRenderer.on(IPC.BG_DONE, fn);           return () => ipcRenderer.removeListener(IPC.BG_DONE, fn); },
  onTranscribeProgress: (cb: (p: unknown) => void) => {
    const fn = (_: unknown, p: unknown) => cb(p);
    ipcRenderer.on(IPC.TRANSCRIBE_PROGRESS, fn);
    return () => ipcRenderer.removeListener(IPC.TRANSCRIBE_PROGRESS, fn);
  },
  onTranscribeDone: (cb: (d: unknown) => void) => {
    const fn = (_: unknown, d: unknown) => cb(d);
    ipcRenderer.on(IPC.TRANSCRIBE_DONE, fn);
    return () => ipcRenderer.removeListener(IPC.TRANSCRIBE_DONE, fn);
  },
  onTranscribeError: (cb: (e: unknown) => void) => {
    const fn = (_: unknown, e: unknown) => cb(e);
    ipcRenderer.on(IPC.TRANSCRIBE_ERROR, fn);
    return () => ipcRenderer.removeListener(IPC.TRANSCRIBE_ERROR, fn);
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

  // yt-dlp binary auto-updater
  checkYtdlp:       () => ipcRenderer.invoke("ytdlp-updater:check"),
  forceUpdateYtdlp: () => ipcRenderer.invoke("ytdlp-updater:force"),
  onYtdlpStatus:    (cb: (s: unknown) => void) => {
    const fn = (_: unknown, s: unknown) => cb(s);
    ipcRenderer.on("ytdlp-updater:status", fn);
    return () => ipcRenderer.removeListener("ytdlp-updater:status", fn);
  },
});
