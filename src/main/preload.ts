import { contextBridge, ipcRenderer } from "electron";

type DownloadFormat = "mp3" | "mp4";
type DownloadQuality = "best" | "720p" | "1080p";

interface DownloadOptions {
  url: string;
  format: DownloadFormat;
  quality: DownloadQuality;
  outputDir?: string;
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

const api = {
  download: (options: DownloadOptions): Promise<string> =>
    ipcRenderer.invoke("download", options),

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
};

contextBridge.exposeInMainWorld("media", api);