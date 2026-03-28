// src/shared/ipc-types.ts
export const IPC = {
  DOWNLOAD_START:    "download:start",
  DOWNLOAD_CANCEL:   "download:cancel",
  DOWNLOAD_PAUSE:    "download:pause",
  DOWNLOAD_RESUME:   "download:resume",
  SELECT_DIR:        "dialog:select-dir",
  GET_DEFAULT_DIR:   "app:getDefaultDir",
  GET_FORMATS:       "download:getFormats",
  DOWNLOAD_PROGRESS: "download:progress",
  DOWNLOAD_COMPLETE: "download:complete",
  DOWNLOAD_ERROR:    "download:error",
  FORMATS_READY:     "download:formatsReady",
} as const;

export type VideoQuality = "bestvideo+bestaudio" | "1080p" | "720p" | "480p" | "360p" | "audio_mp3" | "audio_m4a";

export interface DownloadRequest {
  id: string;
  url: string;
  quality: VideoQuality;
  outputDir: string;
}

export interface FormatRequest {
  id: string;
  url: string;
}

export interface DownloadProgress {
  id: string;
  percent: number;
  speed: string;
  eta: string;
  filename: string;
  size: string;
}

export interface DownloadComplete {
  id: string;
  filepath: string;
  filename: string;
}

export interface DownloadError {
  id: string;
  message: string;
}
