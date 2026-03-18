import { contextBridge, ipcRenderer } from "electron";

type DownloadFormat = "mp3" | "mp4";
type DownloadQuality = "best" | "720p" | "1080p";

interface DownloadOptions {
  url: string;
  format: DownloadFormat;
  quality: DownloadQuality;
  outputDir?: string;
  cookiesFilePath?: string;
  cookiesFromBrowser?: "chrome" | "edge";
}

type DownloadStatus = "idle" | "queued" | "downloading" | "completed" | "error";

interface DownloadStatusPayload {
  status: DownloadStatus;
  message?: string;
}

interface DownloadProgressPayload {
  percent: number;
}

type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

interface UpdateStatusPayload {
  state: UpdateState;
  message?: string;
  percent?: number;
  version?: string;
}

interface AppInfo {
  version: string;
  isDev: boolean;
  ytDlpVersion: string | null;
}

const api = {
  download: (options: DownloadOptions): Promise<string> =>
    ipcRenderer.invoke("download", options),

  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke("app:get-info"),

  onProgress: (callback: (payload: DownloadProgressPayload) => void): (() => void) => {
    const listener = (_: unknown, payload: DownloadProgressPayload) => {
      callback(payload);
    };
    ipcRenderer.on("download:progress", listener);
    return () => {
      ipcRenderer.removeListener("download:progress", listener);
    };
  },

  onStatus: (callback: (payload: DownloadStatusPayload) => void): (() => void) => {
    const listener = (_: unknown, payload: DownloadStatusPayload) => {
      callback(payload);
    };
    ipcRenderer.on("download:status", listener);
    return () => {
      ipcRenderer.removeListener("download:status", listener);
    };
  },

  onUpdateStatus: (callback: (payload: UpdateStatusPayload) => void): (() => void) => {
    const listener = (_: unknown, payload: UpdateStatusPayload) => {
      callback(payload);
    };
    ipcRenderer.on("update:status", listener);
    return () => {
      ipcRenderer.removeListener("update:status", listener);
    };
  },

  selectFolder: (): Promise<string | null> => ipcRenderer.invoke("select-folder"),

  selectFile: (options?: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | null> => ipcRenderer.invoke("select-file", options),

  closeBrowsers: (): Promise<void> => ipcRenderer.invoke("system:close-browsers"),

  openAuth: (target: "douyin" | "tiktok"): Promise<void> => ipcRenderer.invoke("auth:open", target),

  updateYtDlpDev: (): Promise<{ path: string; version: string | null }> =>
    ipcRenderer.invoke("dev:yt-dlp:update"),

  checkForUpdates: (): Promise<void> => ipcRenderer.invoke("update:check"),
  restartAndInstall: (): Promise<void> => ipcRenderer.invoke("update:restart-and-install"),
};

contextBridge.exposeInMainWorld("media", api);