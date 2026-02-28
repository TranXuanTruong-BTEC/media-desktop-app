import { app, BrowserWindow, ipcMain, dialog } from "electron";
import updater from "electron-updater";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ESM: tự định nghĩa __dirname từ import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { autoUpdater } = updater;

type DownloadFormat = "mp3" | "mp4";
type DownloadQuality = "best" | "720p" | "1080p";

interface DownloadOptions {
  url: string;
  format: DownloadFormat;
  quality: DownloadQuality;
  outputDir?: string;
  outputTemplate?: string;
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

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

// Regex lấy % từ dòng progress của yt-dlp: [download]  12.5% of ...
const PROGRESS_REGEX = /\[download\]\s+(\d+\.?\d*)%/;

function createWindow(): void {
  const preloadPath = path.resolve(__dirname, "preload.cjs");

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function resolveToolPath(executable: "yt-dlp.exe" | "ffmpeg.exe"): string {
  // Ưu tiên thư mục tools đóng gói cùng app (prod) hoặc nằm trong project (dev)
  const bundledToolsDir = isDev
    ? path.join(__dirname, "..", "..", "tools")
    : path.join(process.resourcesPath, "tools");

  const bundledPath = path.join(bundledToolsDir, executable);
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  // Hỗ trợ fallback cho trường hợp bạn đặt ở C:\tools
  const driveToolsDir = path.join("C:\\", "tools");

  if (executable === "yt-dlp.exe") {
    const ytDlpPath = path.join(driveToolsDir, "yt-dlp.exe");
    if (fs.existsSync(ytDlpPath)) {
      return ytDlpPath;
    }
  }

  if (executable === "ffmpeg.exe") {
    // Một số bản ffmpeg giải nén thành C:\tools\ffmpeg\bin\ffmpeg.exe
    const candidates = [
      path.join(driveToolsDir, "ffmpeg.exe"),
      path.join(driveToolsDir, "ffmpeg", "ffmpeg.exe"),
      path.join(driveToolsDir, "ffmpeg", "bin", "ffmpeg.exe"),
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (found) {
      return found;
    }
  }

  // Nếu không tìm được, trả về đường dẫn mặc định (sẽ báo lỗi ENOENT rõ ràng)
  return bundledPath;
}

function parseProgress(text: string): void {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = PROGRESS_REGEX.exec(line);
    if (match) {
      const percent = Math.min(100, Number.parseFloat(match[1]));
      const payload: DownloadProgressPayload = { percent };
      sendToRenderer("download:progress", payload);
    }
  }
}

function buildYtDlpArgs(options: DownloadOptions): {
  executable: string;
  args: string[];
} {
  const ytDlpPath = resolveToolPath("yt-dlp.exe");
  const ffmpegPath = resolveToolPath("ffmpeg.exe");

  const args: string[] = [
    options.url,
    "-o",
    options.outputTemplate ?? path.join(options.outputDir ?? app.getPath("downloads"), "%(title)s.%(ext)s"),
    "--newline",
    "--no-warnings",
    "--ffmpeg-location",
    ffmpegPath,
  ];

  if (options.format === "mp3") {
    // Tách audio và convert sang MP3
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
  } else {
    // MP4 video với các mức chất lượng khác nhau
    let formatSelector: string;
    switch (options.quality) {
      case "720p":
        formatSelector =
          "bv*[height<=720][ext=mp4]+ba[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]";
        break;
      case "1080p":
        formatSelector =
          "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]";
        break;
      case "best":
      default:
        formatSelector = "bv*[ext=mp4]+ba[ext=m4a]/best[ext=mp4]/best";
        break;
    }
    args.push("-f", formatSelector);
  }

  return { executable: ytDlpPath, args };
}

function registerIpcHandlers(): void {
  // Chọn thư mục lưu file
  ipcMain.handle("select-folder", async () => {
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  // Bắt đầu tải
  ipcMain.handle("download", async (_event, rawOptions: DownloadOptions) => {
    const trimmedUrl = rawOptions?.url?.trim();

    if (!trimmedUrl) {
      const error = "URL không hợp lệ.";
      const payload: DownloadStatusPayload = {
        status: "error",
        message: error,
      };
      sendToRenderer("download:status", payload);
      throw new Error(error);
    }

    const format: DownloadFormat = rawOptions.format ?? "mp4";
    const quality: DownloadQuality = rawOptions.quality ?? "best";
    const outputDir = rawOptions.outputDir || app.getPath("downloads");
    const outputTemplate = path.join(outputDir, "%(title)s.%(ext)s");

    const options: DownloadOptions = {
      url: trimmedUrl,
      format,
      quality,
      outputDir,
      outputTemplate,
    };

    const queuedPayload: DownloadStatusPayload = {
      status: "queued",
      message: "Đang chuẩn bị tải...",
    };
    sendToRenderer("download:status", queuedPayload);

    return new Promise<string>((resolve, reject) => {
      const { executable, args } = buildYtDlpArgs(options);

      const downloadingPayload: DownloadStatusPayload = {
        status: "downloading",
        message: "Đang tải...",
      };
      sendToRenderer("download:status", downloadingPayload);

      let lastMessage = "";

      const child = spawn(executable, args, {
        windowsHide: true,
      });

      child.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        parseProgress(text);
      });

      child.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        lastMessage = text.trim() || lastMessage;
        parseProgress(text);
      });

      child.on("error", (err: NodeJS.ErrnoException) => {
        let message = err.message;
        if (err.code === "ENOENT") {
          message =
            "Không tìm thấy yt-dlp hoặc ffmpeg. Đảm bảo có thư mục /tools với yt-dlp.exe và ffmpeg.exe cạnh ứng dụng.";
        }

        const errorPayload: DownloadStatusPayload = {
          status: "error",
          message,
        };
        sendToRenderer("download:status", errorPayload);
        reject(new Error(message));
      });

      child.on("close", (code: number | null) => {
        if (code === 0) {
          const donePayload: DownloadStatusPayload = {
            status: "completed",
            message: "Tải hoàn tất.",
          };
          sendToRenderer("download:status", donePayload);
          const finalProgress: DownloadProgressPayload = { percent: 100 };
          sendToRenderer("download:progress", finalProgress);
          resolve("Tải hoàn tất.");
        } else {
          const message =
            lastMessage ||
            "Tải thất bại. Vui lòng thử lại hoặc kiểm tra lại đường dẫn /tools/yt-dlp.exe và /tools/ffmpeg.exe.";
          const errorPayload: DownloadStatusPayload = {
            status: "error",
            message,
          };
          sendToRenderer("download:status", errorPayload);
          reject(new Error(message));
        }
      });
    });
  });
}

function setupAutoUpdater(): void {
  if (isDev) {
    // Không bật auto-update trong môi trường dev
    const payload: UpdateStatusPayload = {
      state: "idle",
      message: "Chế độ phát triển — auto-update tắt.",
    };
    sendToRenderer("update:status", payload);
    return;
  }

  autoUpdater.autoDownload = true;

  autoUpdater.on("checking-for-update", () => {
    const payload: UpdateStatusPayload = {
      state: "checking",
      message: "Đang kiểm tra bản cập nhật...",
    };
    sendToRenderer("update:status", payload);
  });

  autoUpdater.on("update-available", (info) => {
    const payload: UpdateStatusPayload = {
      state: "available",
      version: info.version,
      message: `Đã tìm thấy bản cập nhật ${info.version}. Đang tải xuống...`,
    };
    sendToRenderer("update:status", payload);
  });

  autoUpdater.on("update-not-available", () => {
    const payload: UpdateStatusPayload = {
      state: "not-available",
      message: "Bạn đang dùng phiên bản mới nhất.",
    };
    sendToRenderer("update:status", payload);
  });

  autoUpdater.on("download-progress", (progress) => {
    const payload: UpdateStatusPayload = {
      state: "downloading",
      percent: progress.percent,
      message: `Đang tải bản cập nhật (${progress.percent.toFixed(1)}%)...`,
    };
    sendToRenderer("update:status", payload);
  });

  autoUpdater.on("update-downloaded", (info) => {
    const payload: UpdateStatusPayload = {
      state: "downloaded",
      version: info.version,
      message: "Bản cập nhật đã tải xong. Ứng dụng sẽ cập nhật khi khởi động lại.",
    };
    sendToRenderer("update:status", payload);
  });

  autoUpdater.on("error", (err) => {
    const payload: UpdateStatusPayload = {
      state: "error",
      message: `Lỗi auto-update: ${err.message}`,
    };
    sendToRenderer("update:status", payload);
  });

  void autoUpdater.checkForUpdates().catch((err: unknown) => {
    const message =
      err instanceof Error ? err.message : "Không kiểm tra được bản cập nhật.";
    const payload: UpdateStatusPayload = {
      state: "error",
      message,
    };
    sendToRenderer("update:status", payload);
  });
}

app.whenReady().then(() => {
  createWindow();
  registerIpcHandlers();
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Chỉ hỗ trợ Windows, nhưng vẫn giữ check cho an toàn
  if (process.platform !== "darwin") {
    app.quit();
  }
});