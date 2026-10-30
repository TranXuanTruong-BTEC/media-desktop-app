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
  COOKIES_SET_BROWSER: "cookies:setBrowser",
  COOKIES_LOGIN:     "cookies:login",
  // Trích xuất văn bản (nhận diện giọng nói)
  TRANSCRIBE_PICK:     "transcribe:pick",
  TRANSCRIBE_STATUS:   "transcribe:status",
  TRANSCRIBE_START:    "transcribe:start",
  TRANSCRIBE_CANCEL:   "transcribe:cancel",
  TRANSCRIBE_SAVE:     "transcribe:save",
  TRANSCRIBE_COPY:     "transcribe:copy",
  TRANSCRIBE_PROGRESS: "transcribe:progress",
  TRANSCRIBE_DONE:     "transcribe:done",
  TRANSCRIBE_ERROR:    "transcribe:error",
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

/** Trình duyệt để yt-dlp đọc cookies trực tiếp (--cookies-from-browser). "none" = không dùng. */
export type CookieBrowser = "none" | "firefox" | "edge" | "chrome" | "brave";

// ─── Trích xuất văn bản ──────────────────────────────────────────────────────

export type WhisperModelId = "base" | "small" | "turbo";
export type TranscribeStage = "tools" | "model" | "audio" | "recognize";

export interface TranscribeSegment { startMs: number; endMs: number; text: string; }

export interface TranscribeRequest { id: string; fileToken: string; model: WhisperModelId; }
export interface TranscribeProgress { id: string; stage: TranscribeStage; percent: number; message: string; }
export interface TranscribeDone     { id: string; segments: TranscribeSegment[]; }
export interface TranscribeError    { id: string; message: string; }

export interface TranscribeModelInfo {
  id: WhisperModelId;
  label: string;
  desc: string;
  sizeMb: number;
  installed: boolean;
}
export interface TranscribeStatus { toolsInstalled: boolean; busy: boolean; models: TranscribeModelInfo[]; }

export interface PickedFile { token: string; name: string; sizeBytes: number; }
export interface TranscribePickResult  { ok: boolean; canceled?: boolean; error?: string; file?: PickedFile; }
export interface TranscribeActionResult { ok: boolean; canceled?: boolean; error?: string; path?: string; }

/** Trang có cửa sổ đăng nhập để app tự lấy cookies. */
export type CookieSite = "douyin" | "tiktok";

export interface CookiesStatus {
  browser: CookieBrowser;
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
  loggedIn?: boolean;   // chỉ có ở kết quả của cửa sổ đăng nhập
  count?: number;      // số cookie vừa lấy được
  status?: CookiesStatus;
}

export interface DownloadRetrying {
  id: string;
  attempt: number;   
  maxAttempts: number;
  reason: string;    
  delayMs: number;   
}
