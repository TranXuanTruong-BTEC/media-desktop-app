import { useEffect, useState } from "react";

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

declare global {
  interface Window {
    media?: {
      download: (options: DownloadOptions) => Promise<string>;
      onProgress: (callback: (payload: DownloadProgressPayload) => void) => () => void;
      onStatus: (callback: (payload: DownloadStatusPayload) => void) => () => void;
      onUpdateStatus?: (callback: (payload: UpdateStatusPayload) => void) => () => void;
      selectFolder: () => Promise<string | null>;
      selectFile?: (options?: {
        title?: string;
        filters?: { name: string; extensions: string[] }[];
      }) => Promise<string | null>;
      closeBrowsers?: () => Promise<void>;
      openAuth?: (target: "douyin" | "tiktok") => Promise<void>;
      updateYtDlpDev?: () => Promise<{ path: string; version: string | null }>;
      getAppInfo: () => Promise<{ version: string; isDev: boolean; ytDlpVersion: string | null }>;
      checkForUpdates?: () => Promise<void>;
      restartAndInstall?: () => Promise<void>;
    };
  }
}

const QUALITIES: { value: DownloadQuality; label: string }[] = [
  { value: "best", label: "Tốt nhất" },
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
];

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
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [isDevMode, setIsDevMode] = useState<boolean>(false);
  const [ytDlpVersion, setYtDlpVersion] = useState<string | null>(null);
  const [devBusy, setDevBusy] = useState<boolean>(false);

  const parsedUrl = (() => {
    try {
      const u = new URL(url.trim());
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      return { url: u, host };
    } catch {
      return null;
    }
  })();
  const currentHost = parsedUrl?.host ?? "";
  const isDouyin = currentHost.endsWith("douyin.com");
  const isTikTok = currentHost.endsWith("tiktok.com");

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
        setUpdateState(payload.state);
        setUpdateMessage(payload.message ?? "");
      }) ?? null;

    // Lấy version app từ main process
    void window.media
      .getAppInfo()
      .then((info) => {
        setAppVersion(info.version);
        setIsDevMode(!!info.isDev);
        setYtDlpVersion(info.ytDlpVersion ?? null);
      })
      .catch(() => {
        setAppVersion(null);
        setIsDevMode(false);
        setYtDlpVersion(null);
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
        "Ứng dụng này chỉ chạy dạng desktop (file .exe). Vui lòng mở bằng ứng dụng, không dùng trên trình duyệt.",
      );
      return;
    }

    const parsed = (() => {
      try {
        const u = new URL(trimmed);
        const host = u.hostname.replace(/^www\./, "").toLowerCase();
        return { url: u, host };
      } catch {
        return null;
      }
    })();

    const host = parsed?.host ?? "";
    const isDouyin = host.endsWith("douyin.com");

    if (isDouyin) {
      setDownloadStatus("error");
      setDownloadMessage(
        "Hiện tại app đang tạm đóng băng tải Douyin. Chức năng này sẽ được cập nhật sau.",
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
        // Cookies cho Douyin/TikTok sẽ được lấy từ cửa sổ đăng nhập trong app
        // (exportAuthCookiesForUrl ở main), nên không dùng cookies-from-browser nữa.
      });
      // Trạng thái chi tiết sẽ được cập nhật qua onStatus từ main
    } catch (error) {
      setDownloadStatus("error");
      const raw = error instanceof Error ? error.message : "Không tải được file. Vui lòng thử lại.";
      const cleaned = raw
        .replace(/^Error invoking remote method 'download':\s*/i, "")
        .replace(/^Error:\s*/i, "");
      setDownloadMessage(cleaned);
    }
  };

  const isDownloading = downloadStatus === "queued" || downloadStatus === "downloading";

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
              <span className="flex items-center gap-2">
                {updateState === "downloaded" ? (
                  <button
                    type="button"
                    onClick={() => window.media?.restartAndInstall?.()}
                    className="px-2 py-1 rounded bg-emerald-500 text-white font-medium hover:bg-emerald-600"
                  >
                    Khởi động lại để cập nhật
                  </button>
                ) : updateMessage ? (
                  <span className="text-right">{updateMessage}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => window.media?.checkForUpdates?.()}
                    className="text-sky-500 hover:underline"
                  >
                    Kiểm tra cập nhật
                  </button>
                )}
              </span>
            </div>
          </header>

          {isDevMode && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] text-amber-900">
                  Dev tools • yt-dlp: <span className="font-semibold">{ytDlpVersion ?? "chưa có"}</span>
                </div>
                <button
                  type="button"
                  disabled={devBusy}
                  onClick={async () => {
                    try {
                      setDevBusy(true);
                      const result = await window.media?.updateYtDlpDev?.();
                      setYtDlpVersion(result?.version ?? null);
                      setDownloadStatus("idle");
                      setDownloadMessage("Đã cập nhật yt-dlp (dev). Hãy thử tải lại Douyin.");
                    } catch (e) {
                      setDownloadStatus("error");
                      setDownloadMessage(e instanceof Error ? e.message : "Không cập nhật được yt-dlp.");
                    } finally {
                      setDevBusy(false);
                    }
                  }}
                  className="px-3 py-2 rounded-xl bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {devBusy ? "Đang tải..." : "Tải yt-dlp mới nhất"}
                </button>
              </div>
              <div className="mt-1 text-[11px] text-amber-800">
                Chỉ dùng khi dev. Không hiển thị/không hoạt động ở bản phát hành chính thức.
              </div>
            </div>
          )}

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

            {isTikTok && (
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3">
                <div className="text-[11px] text-slate-600">
                  TikTok đôi khi bị 403 nếu chưa có cookies. Nếu lỗi 403, hãy đăng nhập TikTok ngay trong app rồi tải lại.
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await window.media?.openAuth?.("tiktok");
                      setDownloadStatus("idle");
                      setDownloadMessage("Đã mở cửa sổ đăng nhập TikTok. Đăng nhập xong hãy đóng cửa sổ đó và bấm Download lại.");
                    } catch {
                      setDownloadStatus("error");
                      setDownloadMessage("Không mở được cửa sổ đăng nhập TikTok. Vui lòng thử lại.");
                    }
                  }}
                  className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                >
                  Đăng nhập TikTok
                </button>
              </div>
            )}

            {isDouyin && (
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3">
                <div className="text-[11px] text-slate-600">
                  Douyin có thể cần đăng nhập để tải. Nếu lỗi DPAPI, hãy đăng nhập ngay trong app.
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await window.media?.openAuth?.("douyin");
                      setDownloadStatus("idle");
                      setDownloadMessage("Đã mở cửa sổ đăng nhập. Đăng nhập xong hãy đóng cửa sổ đó và bấm Download lại.");
                    } catch {
                      setDownloadStatus("error");
                      setDownloadMessage("Không mở được cửa sổ đăng nhập. Vui lòng thử lại.");
                    }
                  }}
                  className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                >
                  Đăng nhập Douyin
                </button>
              </div>
            )}

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

            {/* Cookies cho Douyin/TikTok được cấu hình tự động trong background.
                Người dùng chỉ cần dán link và bấm Download. */}
          </div>

          {(progress ?? null) !== null && (
            <div className="space-y-2 pt-1">
              <div className="flex justify_between text-[11px] text-slate-500">
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
            <div className="space-y-2">
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
              {downloadStatus === "error" &&
                /Không đọc được cookies từ trình duyệt/i.test(downloadMessage) && (
                  <div className="px-1">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await window.media?.closeBrowsers?.();
                          setDownloadStatus("idle");
                          setDownloadMessage("Đã đóng Chrome/Edge. Bạn hãy bấm Download lại.");
                        } catch {
                          setDownloadMessage("Không thể đóng Chrome/Edge tự động. Hãy tự đóng rồi bấm Download lại.");
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl bg-rose-500 text-white text-xs font-semibold hover:bg-rose-600"
                    >
                      Đóng Chrome/Edge
                    </button>
                  </div>
                )}
            </div>
          )}

          {(isDownloading || currentTitle) && (
            <div className="mt-2 rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 flex items-center gap-3">
              <div
                className={`h-9 w-9 rounded-xl flex items-center justify-center ${
                  downloadStatus === "completed"
                    ? "bg-emerald-100"
                    : downloadStatus === "error"
                      ? "bg-rose-100"
                      : "bg-slate-200"
                }`}
              >
                {downloadStatus === "completed" ? (
                  <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : downloadStatus === "error" ? (
                  <svg className="h-5 w-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <span className="h-4 w-4 rounded-full border-2 border-slate-500 border-t-transparent animate-spin" />
                )}
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
