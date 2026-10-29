import type { DownloadRequest, DownloadProgress, DownloadComplete, DownloadError } from "../../shared/ipc-types";

export type ModelId = "small" | "turbo" | "large";
export interface TranscribeModelInfo { id: ModelId; label: string; desc: string; sizeMB: number; installed: boolean; }
export interface TranscribeInfo { whisperFound: boolean; ffmpegFound: boolean; models: TranscribeModelInfo[]; }
export interface TranscribeRequest { id: string; inputPath: string; outputDir: string; modelId: ModelId; }
export interface TranscribeProgress { id: string; stage: "extract" | "transcribe" | "finalize"; percent: number; text?: string; }
export interface ModelProgress { id: ModelId; percent: number; receivedMB: number; totalMB: number; }
export interface TranscribeResult { id: string; srtPath: string; folder: string; segments: number; dropped: number; preview: string[]; }
export type TranscribeOutcome =
  | { ok: true; result: TranscribeResult }
  | { ok: false; cancelled?: boolean; message: string };

export interface CookiesStatus { exists: boolean; count: number; hasSvWebId: boolean; updatedAt: number | null; }
export interface CookiesImportResult { ok: boolean; message: string; status: CookiesStatus; canceled?: boolean; }

declare global {
  interface Window {
    api: {
      startDownload:   (req: DownloadRequest) => void;
      cancelDownload:  (id: string) => void;
      selectOutputDir: () => Promise<string | null>;
      getDefaultDir:   () => Promise<string>;
      openPath:        (p: string) => Promise<void>;
      onProgress: (cb: (p: DownloadProgress) => void) => () => void;
      onComplete: (cb: (c: DownloadComplete) => void) => () => void;
      onError:    (cb: (e: DownloadError)    => void) => () => void;
      getPathForFile:       (f: File) => string;
      transcribeInfo:       () => Promise<TranscribeInfo | null>;
      transcribeSelectFile: () => Promise<string | null>;
      transcribeStart:      (req: TranscribeRequest) => Promise<TranscribeOutcome | null>;
      transcribeCancel:     (id: string) => Promise<void>;
      downloadWhisperModel: (id: string) => Promise<{ ok: boolean; message: string } | null>;
      cancelModelDownload:  (id: string) => Promise<void>;
      onTranscribeProgress: (cb: (p: TranscribeProgress) => void) => () => void;
      onModelProgress:      (cb: (p: ModelProgress) => void) => () => void;
      getCookiesStatus:  () => Promise<CookiesStatus | null>;
      importCookiesFile: () => Promise<CookiesImportResult | null>;
      importCookiesText: (text: string) => Promise<CookiesImportResult | null>;
      clearCookies:      () => Promise<CookiesStatus | null>;
      winMinimize: () => void;
      winMaximize: () => void;
      winClose:    () => void;
    };
  }
}
