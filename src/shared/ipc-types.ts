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
  // Cài đặt AI dịch (Claude / OpenAI / Gemini...)
  LLM_GET_SETTINGS:    "llm:getSettings",
  LLM_SAVE_SETTINGS:   "llm:saveSettings",
  LLM_TEST:            "llm:test",
  // Tách nền ảnh
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
export type TranslateEngine = "google" | "ai";
export type TranscribeStage = "tools" | "model" | "audio" | "recognize" | "scenes" | "translate";

export interface TranscribeSegment {
  startMs: number;
  endMs: number;
  text: string;
  /** Lời gốc (tiếng Trung) khi `text` đã được dịch. */
  sourceText?: string;
  /** Cảnh hình / đoạn hội thoại (0-based). */
  sceneIndex?: number;
}

export interface TranscribeRequest {
  id: string;
  fileToken: string;
  model: WhisperModelId;
  /** Dịch phụ đề sang tiếng Việt theo từng cảnh (cần mạng; chỉ gửi lời thoại). */
  translateToVi?: boolean;
  /** "google" = Google Dịch (miễn phí, từng khối); "ai" = mô hình AI đọc cả kịch bản (hiểu ngữ cảnh, cần API key). */
  translateEngine?: TranslateEngine;
}
export interface TranscribeProgress { id: string; stage: TranscribeStage; percent: number; message: string; }
export interface TranscribeDone {
  id: string;
  segments: TranscribeSegment[];
  translated?: boolean;
  warning?: string;
  /** Thông tin thêm sau khi dịch bằng AI (số nhân vật, số lỗi nhận diện đã sửa...). */
  info?: string;
}
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

// ─── Cài đặt AI dịch ─────────────────────────────────────────────────────────

/** "anthropic" = Claude; "openai" = mọi API tương thích OpenAI (OpenAI, Gemini, Ollama...). */
export type LlmProvider = "anthropic" | "openai";

export interface LlmSettings {
  provider: LlmProvider;
  model: string;
  baseUrl: string;      // rỗng = địa chỉ mặc định của nhà cung cấp
  review: boolean;      // soát lại toàn bộ bản dịch bằng một lượt AI thứ hai (chậm hơn, chất lượng hơn)
}
/** Giao diện không bao giờ nhận lại API key — chỉ biết đã có key hay chưa. */
export interface LlmSettingsView extends LlmSettings { hasKey: boolean; encryptionAvailable: boolean; }
export interface LlmSettingsSave extends Partial<LlmSettings> { apiKey?: string; clearKey?: boolean; }
export interface LlmResult { ok: boolean; error?: string; message?: string; settings?: LlmSettingsView; }

// ─── Tách nền ảnh (AI chạy trên máy: ONNX) ───────────────────────────────────

export type BgModelId = "fast" | "general" | "portrait";
export interface BgModelInfo { id: BgModelId; label: string; desc: string; sizeMb: number; installed: boolean; }
export interface BgInfo { ffmpegFound: boolean; runtimeOk: boolean; models: BgModelInfo[]; }
export interface BgImage { token: string; name: string; sizeBytes: number; thumb: string; }   // thumb: data URL PNG nhỏ
export interface BgPickResult { ok: boolean; canceled?: boolean; error?: string; images?: BgImage[]; skipped?: number; }
/** Nền của kết quả: trong suốt, một màu đặc (#rrggbb) hoặc chỉ lấy mặt nạ đen/trắng. */
export type BgBackground = { type: "transparent" } | { type: "color"; color: string } | { type: "mask" };
export interface BgStartRequest { id: string; tokens: string[]; model: BgModelId; background: BgBackground; refine: boolean; }
export interface BgModelProgress { id: BgModelId; percent: number; message: string; }
export interface BgProgress { id: string; index: number; total: number; name: string; percent: number; message: string; }
export interface BgItemDone { id: string; index: number; token: string; name: string; width: number; height: number; ms: number; preview: string; hasAlpha: boolean; }
export interface BgItemError { id: string; index: number; token: string; name: string; message: string; }
export interface BgDone { id: string; ok: number; failed: number; cancelled: boolean; }
export interface BgActionResult { ok: boolean; canceled?: boolean; error?: string; path?: string; saved?: number; }
