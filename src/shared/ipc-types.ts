export const IPC = {
  // Auto-updater
  UPDATER_CHECK:        "updater:check",
  UPDATER_STATUS:       "updater:status",
  UPDATER_DOWNLOAD_NOW: "updater:downloadNow",
  UPDATER_INSTALL_NOW:  "updater:installNow",
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
  DOWNLOAD_RETRYING: "download:retrying",
  FORMATS_READY:     "download:formatsReady",
  // Cookies do người dùng cung cấp
  COOKIES_STATUS:    "cookies:status",
  COOKIES_SAVE:      "cookies:save",
  COOKIES_IMPORT:    "cookies:import",
  COOKIES_CLEAR:     "cookies:clear",
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
  stage?: string;
}

export interface DownloadComplete {
  id: string;
  filepath: string;
  filename: string;
  warning?: string;
}

export interface DownloadError {
  id: string;
  message: string;
}

export interface CookiesStatus {
  exists: boolean;
  count: number;
  domains: string[];      // tối đa vài tên miền đầu tiên, chỉ để hiển thị
  totalDomains: number;
  updatedAt: number | null;
}

export interface CookiesResult {
  ok: boolean;
  error?: string;
  canceled?: boolean;
  status?: CookiesStatus;
}

export interface DownloadRetrying {
  id: string;
  attempt: number;   
  maxAttempts: number;
  reason: string;    
  delayMs: number;   
}
