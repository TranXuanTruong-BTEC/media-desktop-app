import { useEffect, useState } from "react";

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

declare global {
  interface Window {
    media?: {
      download: (options: DownloadOptions) => Promise<string>;
      onProgress: (callback: (payload: DownloadProgressPayload) => void) => () => void;
      onStatus: (callback: (payload: DownloadStatusPayload) => void) => () => void;
      onUpdateStatus?: (callback: (payload: UpdateStatusPayload) => void) => () => void;
      selectFolder: () => Promise<string | null>;
      getAppInfo: () => Promise<{ version: string }>;
    };
  }
}

const QUALITIES: { value: DownloadQuality; label: string }[] = [
  { value: "best", label: "Tốt nhất" },
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
];

function LandingPage() {
  // Link tải trực tiếp — bấm là tải file .exe ngay, không chuyển trang
  const downloadUrl =
    "https://github.com/TranXuanTruong-BTEC/media-desktop-app/releases/latest/download/MediaDesktopApp-Setup.exe";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="max-w-4xl w-full mx-auto grid gap-10 md:grid-cols-[1.4fr,1fr] items-center">
        <div className="space-y-6">
          <p className="text-xs tracking-[0.25em] uppercase text-emerald-400">
            Desktop Media Downloader
          </p>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Tải video & audio từ YouTube
            <br />
            nhanh chóng, an toàn, không quảng cáo.
          </h1>
          <p className="text-sm md:text-base text-slate-400">
            Media Desktop App là ứng dụng desktop (Electron + React) giúp bạn tải MP4 / MP3 từ
            YouTube và nhiều nguồn khác. Hỗ trợ chọn chất lượng, xem tiến trình, dùng trực tiếp
            yt-dlp + ffmpeg ngay trên Windows.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={downloadUrl}
              download="MediaDesktopApp-Setup.exe"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 text-sm font-semibold shadow-lg shadow-emerald-500/30 transition"
            >
              Tải cho Windows (.exe)
            </a>
            <div className="text-xs text-slate-500">
              Chỉ hỗ trợ Windows. Cài đặt xong mở app để sử dụng đầy đủ tính năng downloader.
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Không quảng cáo
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Dùng yt-dlp + ffmpeg local
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Auto-update qua GitHub Releases
            </span>
          </div>
        </div>

        <div className="hidden md:block">
          <div className="relative rounded-2xl border border-slate-800 bg-slate-950/60 p-4 shadow-xl shadow-black/60">
            <div className="flex items-center gap-1 mb-3">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </div>
            <div className="h-40 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center text-xs text-slate-400 text-center px-4">
              Giao diện downloader với ô nhập link, chọn định dạng, chất lượng và tiến trình tải
              theo thời gian thực — chỉ khả dụng trong app desktop.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<DownloadFormat>("mp4");
  const [quality, setQuality] = useState<DownloadQuality>("best");
  const [outputDir, setOutputDir] = useState<string | null>(null);

  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>("idle");
  const [downloadMessage, setDownloadMessage] = useState<string>("");
  const [progress, setProgress] = useState<number | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string | null>(null);

  const [updateMessage, setUpdateMessage] = useState<string>("");
  const [appVersion, setAppVersion] = useState<string | null>(null);

  const isElectron = typeof window !== "undefined" && !!window.media;

  useEffect(() => {
    if (!window.media) {
      return;
    }

    const offProgress = window.media.onProgress((payload) => {
      setProgress(payload.percent);
    });

    const offStatus = window.media.onStatus((payload) => {
      setDownloadStatus(payload.status);
      setDownloadMessage(payload.message ?? "");
      if (payload.status === "completed" || payload.status === "error") {
        setTimeout(() => {
          setProgress(null);
        }, 500);
      }
    });

    const offUpdate =
      window.media.onUpdateStatus?.((payload) => {
        setUpdateMessage(payload.message ?? "");
      }) ?? null;

    // Lấy version app từ main process
    void window.media
      .getAppInfo()
      .then((info) => {
        setAppVersion(info.version);
      })
      .catch(() => {
        setAppVersion(null);
      });

    return () => {
      offProgress();
      offStatus();
      offUpdate?.();
    };
  }, []);

  const handleSelectFolder = async () => {
    try {
      if (!window.media) return;
      const dir = await window.media.selectFolder();
      if (dir) setOutputDir(dir);
    } catch {
      setDownloadStatus("error");
      setDownloadMessage("Không chọn được thư mục");
    }
  };

  const handleDownload = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setDownloadStatus("error");
      setDownloadMessage("Vui lòng dán link video");
      return;
    }

    if (!window.media?.download) {
      setDownloadStatus("error");
      setDownloadMessage(
        "Không kết nối được với Electron. Hãy chạy: Terminal 1: npm run dev, Terminal 2: npm run electron (không mở localhost:5173 bằng trình duyệt).",
      );
      return;
    }

    setCurrentTitle(trimmed);
    setDownloadStatus("queued");
    setDownloadMessage("Đang chuẩn bị tải...");
    setProgress(0);

    try {
      await window.media.download({
        url: trimmed,
        format,
        quality,
        outputDir: outputDir ?? undefined,
      });
      // Trạng thái chi tiết sẽ được cập nhật qua onStatus từ main
    } catch (error) {
      setDownloadStatus("error");
      setDownloadMessage(
        error instanceof Error ? error.message : "Không tải được file. Vui lòng thử lại.",
      );
    }
  };

  const isDownloading = downloadStatus === "queued" || downloadStatus === "downloading";

  if (!isElectron) {
    return <LandingPage />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-100 via-indigo-100 to-slate-200 flex items-center justify-center px-4 py-8 font-sans">
      <div className="max-w-xl w-full">
        <div className="bg-white/90 border border-white/70 rounded-3xl shadow-2xl shadow-slate-400/40 px-7 py-6 space-y-5 backdrop-blur">
          <header className="space-y-1">
            <h1 className="text-xl font-semibold text-slate-900">Media Downloader</h1>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>
                Version {appVersion ?? "dev"}{" "}
                {process.env.NODE_ENV !== "production" ? "(dev)" : ""}
              </span>
              {updateMessage && <span className="text-right">{updateMessage}</span>}
            </div>
          </header>

          <div className="space-y-3">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-600">URL</label>
              <div className="flex gap-3">
                <input
                  className="flex-1 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400 shadow-inner"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={isDownloading || !url.trim()}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-md shadow-sky-500/40 transition"
                >
                  {isDownloading ? "Đang tải..." : "Download"}
                </button>
              </div>
            </div>

            <div className="h-px bg-slate-200" />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Format</label>
                <select
                  className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as DownloadFormat)}
                >
                  <option value="mp4">MP4</option>
                  <option value="mp3">MP3</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Quality</label>
                <select
                  className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400"
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as DownloadQuality)}
                >
                  {QUALITIES.map((q) => (
                    <option key={q.value} value={q.value}>
                      {q.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Thư mục lưu</label>
              <div className="flex gap-3 items-center">
                <input
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 truncate"
                  readOnly
                  value={outputDir ?? "Mặc định: Thư mục Tải xuống của Windows"}
                />
                <button
                  type="button"
                  onClick={handleSelectFolder}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-700 hover:bg-slate-50"
                >
                  Browse
                </button>
              </div>
            </div>
          </div>

          {(progress ?? null) !== null && (
            <div className="space-y-2 pt-1">
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>Downloading...</span>
                <span>{Math.round(progress ?? 0)}%</span>
              </div>
              <div className="h-3 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all duration-200 ease-out"
                  style={{ width: `${Math.max(0, Math.min(100, progress ?? 0))}%` }}
                />
              </div>
            </div>
          )}

          {downloadMessage && (
            <p
              className={`text-[11px] px-1 ${
                downloadStatus === "error"
                  ? "text-rose-500"
                  : downloadStatus === "completed"
                    ? "text-emerald-600"
                    : "text-slate-500"
              }`}
            >
              {downloadMessage}
            </p>
          )}

          {(isDownloading || currentTitle) && (
            <div className="mt-2 rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-slate-200 flex items-center justify-center">
                <span className="h-4 w-4 rounded-full border-2 border-slate-500 border-t-transparent animate-spin" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex justify-between items-center">
                  <p className="text-xs font-medium text-slate-700">
                    {downloadStatus === "completed"
                      ? "Hoàn tất tải xuống"
                      : "Đang tải video"}
                  </p>
                  {(progress ?? null) !== null && (
                    <span className="text-[11px] text-slate-500">
                      {Math.round(progress ?? 0)}%
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 truncate">
                  {currentTitle ?? "Video hiện tại"}
                </p>
                <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full bg-sky-500 transition-all duration-200 ease-out"
                    style={{ width: `${Math.max(0, Math.min(100, progress ?? 0))}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* updateMessage đã hiển thị ở header cùng với version */}
        </div>
      </div>
    </div>
  );
}

export default App;
