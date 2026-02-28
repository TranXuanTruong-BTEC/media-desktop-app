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
let mainWindow = null;
const isDev = !app.isPackaged;
// Regex lấy % từ dòng progress của yt-dlp: [download]  12.5% of ...
const PROGRESS_REGEX = /\[download\]\s+(\d+\.?\d*)%/;
function createWindow() {
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
    }
    else {
        mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
    }
}
function sendToRenderer(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}
function resolveToolPath(executable) {
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
function parseProgress(text) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const match = PROGRESS_REGEX.exec(line);
        if (match) {
            const percent = Math.min(100, Number.parseFloat(match[1]));
            const payload = { percent };
            sendToRenderer("download:progress", payload);
        }
    }
}
function buildYtDlpArgs(options) {
    const ytDlpPath = resolveToolPath("yt-dlp.exe");
    const ffmpegPath = resolveToolPath("ffmpeg.exe");
    const args = [
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
    }
    else {
        // MP4 video với các mức chất lượng khác nhau
        let formatSelector;
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
function registerIpcHandlers() {
    // Thông tin app cho renderer (version, v.v.)
    ipcMain.handle("app:get-info", async () => {
        return {
            version: app.getVersion(),
        };
    });
    // Chọn thư mục lưu file
    ipcMain.handle("select-folder", async () => {
        if (!mainWindow)
            return null;
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ["openDirectory"],
        });
        if (result.canceled)
            return null;
        return result.filePaths[0] ?? null;
    });
    // Bắt đầu tải
    ipcMain.handle("download", async (_event, rawOptions) => {
        const trimmedUrl = rawOptions?.url?.trim();
        if (!trimmedUrl) {
            const error = "URL không hợp lệ.";
            const payload = {
                status: "error",
                message: error,
            };
            sendToRenderer("download:status", payload);
            throw new Error(error);
        }
        const format = rawOptions.format ?? "mp4";
        const quality = rawOptions.quality ?? "best";
        const outputDir = rawOptions.outputDir || app.getPath("downloads");
        const outputTemplate = path.join(outputDir, "%(title)s.%(ext)s");
        const options = {
            url: trimmedUrl,
            format,
            quality,
            outputDir,
            outputTemplate,
        };
        const queuedPayload = {
            status: "queued",
            message: "Đang chuẩn bị tải...",
        };
        sendToRenderer("download:status", queuedPayload);
        return new Promise((resolve, reject) => {
            const { executable, args } = buildYtDlpArgs(options);
            const downloadingPayload = {
                status: "downloading",
                message: "Đang tải...",
            };
            sendToRenderer("download:status", downloadingPayload);
            let lastMessage = "";
            const child = spawn(executable, args, {
                windowsHide: true,
            });
            child.stdout.on("data", (data) => {
                const text = data.toString();
                parseProgress(text);
            });
            child.stderr.on("data", (data) => {
                const text = data.toString();
                lastMessage = text.trim() || lastMessage;
                parseProgress(text);
            });
            child.on("error", (err) => {
                let message = err.message;
                if (err.code === "ENOENT") {
                    message =
                        "Không tìm thấy yt-dlp hoặc ffmpeg. Đảm bảo có thư mục /tools với yt-dlp.exe và ffmpeg.exe cạnh ứng dụng.";
                }
                const errorPayload = {
                    status: "error",
                    message,
                };
                sendToRenderer("download:status", errorPayload);
                reject(new Error(message));
            });
            child.on("close", (code) => {
                if (code === 0) {
                    const donePayload = {
                        status: "completed",
                        message: "Tải hoàn tất.",
                    };
                    sendToRenderer("download:status", donePayload);
                    const finalProgress = { percent: 100 };
                    sendToRenderer("download:progress", finalProgress);
                    resolve("Tải hoàn tất.");
                }
                else {
                    const message = lastMessage ||
                        "Tải thất bại. Vui lòng thử lại hoặc kiểm tra lại đường dẫn /tools/yt-dlp.exe và /tools/ffmpeg.exe.";
                    const errorPayload = {
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
function setupAutoUpdater() {
    if (isDev) {
        // Không bật auto-update trong môi trường dev
        const payload = {
            state: "idle",
            message: "Chế độ phát triển — auto-update tắt.",
        };
        sendToRenderer("update:status", payload);
        return;
    }
    autoUpdater.autoDownload = true;
    autoUpdater.on("checking-for-update", () => {
        const payload = {
            state: "checking",
            message: "Đang kiểm tra bản cập nhật...",
        };
        sendToRenderer("update:status", payload);
    });
    autoUpdater.on("update-available", (info) => {
        const payload = {
            state: "available",
            version: info.version,
            message: `Đã tìm thấy bản cập nhật ${info.version}. Đang tải xuống...`,
        };
        sendToRenderer("update:status", payload);
    });
    autoUpdater.on("update-not-available", () => {
        const payload = {
            state: "not-available",
            message: "Phiên bản mới nhất.",
        };
        sendToRenderer("update:status", payload);
    });
    autoUpdater.on("download-progress", (progress) => {
        const payload = {
            state: "downloading",
            percent: progress.percent,
            message: `Đang tải bản cập nhật (${progress.percent.toFixed(1)}%)...`,
        };
        sendToRenderer("update:status", payload);
    });
    autoUpdater.on("update-downloaded", (info) => {
        const payload = {
            state: "downloaded",
            version: info.version,
            message: "Bản cập nhật đã tải xong. Ứng dụng sẽ cập nhật khi khởi động lại.",
        };
        sendToRenderer("update:status", payload);
    });
    autoUpdater.on("error", (err) => {
        // Không hiển thị lỗi chi tiết cho user (404, app.yml, v.v.)
        const payload = {
            state: "error",
            message: "Không thể kiểm tra cập nhật.",
        };
        sendToRenderer("update:status", payload);
    });
    void autoUpdater.checkForUpdates().catch(() => {
        const payload = {
            state: "error",
            message: "Không thể kiểm tra cập nhật.",
        };
        sendToRenderer("update:status", payload);
    });
}
function registerUpdateHandlers() {
    ipcMain.handle("update:check", () => {
        if (isDev)
            return;
        void autoUpdater.checkForUpdates().catch(() => { });
    });
    ipcMain.handle("update:restart-and-install", () => {
        autoUpdater.quitAndInstall(false, true);
    });
}
app.whenReady().then(() => {
    createWindow();
    registerIpcHandlers();
    registerUpdateHandlers();
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
