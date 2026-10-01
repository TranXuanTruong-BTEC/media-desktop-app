// src/main/main.ts
import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
import path from "path";
import fs from "fs";
import { registerDownloadHandlers }     from "./ipc/download.js";
import { registerUpdaterHandlers }      from "./ipc/updater.js";
import { registerYtdlpUpdaterHandlers } from "./ipc/ytdlp-update.js";
import { logger } from "./core/logger.js";

const isDev = !app.isPackaged;

// ─── Global exception safety net ──────────────────────────────────────────
// Trước đây một lỗi bất đồng bộ không bắt được (vd. exception trong callback
// của child_process, promise rejection trong downloader...) sẽ làm Electron
// main process thoát đột ngột -> toàn bộ app "văng" mà không rõ nguyên nhân.
// Giờ mọi lỗi đều được log lại và hiển thị hộp thoại thay vì crash âm thầm.
process.on("uncaughtException", (err) => {
  logger.error("main", "uncaughtException", err);
  if (app.isReady()) {
    dialog.showErrorBox(
      "Đã xảy ra lỗi không mong muốn",
      `Ứng dụng gặp lỗi nhưng đã được ghi lại.\n\n${err.message}`
    );
  }
});

process.on("unhandledRejection", (reason) => {
  logger.error("main", "unhandledRejection", reason);
});

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 780,
    minHeight: 500,
    frame: false,
    backgroundColor: "#0f1117",
    icon: path.join(__dirname, "../../build/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const loadPromise = isDev
    ? win.loadURL("http://localhost:5173")
    : win.loadFile(path.join(__dirname, "../../dist/renderer/index.html"));

  loadPromise.catch((err) => logger.error("main", "Không load được cửa sổ chính", err));

  return win;
}

function registerAppHandlers(win: BrowserWindow) {
  ipcMain.handle("app:getDefaultDir", () => app.getPath("downloads"));
  ipcMain.handle("app:getVersion",    () => app.getVersion());
  // Nhận đường dẫn FILE → mở Explorer và chọn sẵn file; nhận THƯ MỤC → mở thư mục;
  // file đã bị xoá/di chuyển → mở thư mục chứa nó (nếu còn).
  ipcMain.handle("app:openPath", async (_evt: unknown, filePath: string) => {
    try {
      if (typeof filePath !== "string" || !filePath) return;
      let stat: fs.Stats | null = null;
      try { stat = fs.statSync(filePath); } catch { /* không tồn tại */ }
      if (stat?.isFile()) { shell.showItemInFolder(filePath); return; }
      if (stat?.isDirectory()) { await shell.openPath(filePath); return; }
      const parent = path.dirname(filePath);
      if (fs.existsSync(parent)) await shell.openPath(parent);
    } catch (err) {
      // File có thể đã bị người dùng xóa/di chuyển sau khi tải xong.
      logger.warn("app:openPath", "Không mở được thư mục chứa file", { filePath, err });
    }
  });

  ipcMain.handle("app:openExternal", async (_evt: unknown, url: string) => {
    try {
      const u = new URL(String(url));
      if (u.protocol !== "https:") return false;   // chỉ mở link https
      await shell.openExternal(u.toString());
      return true;
    } catch (err) {
      logger.warn("app:openExternal", "Không mở được liên kết", { url, err });
      return false;
    }
  });

  // Custom window controls
  ipcMain.on("win:minimize", () => win.minimize());
  ipcMain.on("win:maximize", () => win.isMaximized() ? win.unmaximize() : win.maximize());
  ipcMain.on("win:close",    () => win.close());
}

app.whenReady().then(() => {
  const win = createWindow();
  registerDownloadHandlers(win);
  registerUpdaterHandlers(win);
  registerYtdlpUpdaterHandlers(win);
  registerAppHandlers(win);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
