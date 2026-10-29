import { app, BrowserWindow, ipcMain, shell, dialog, session } from "electron";
import path from "path";
import fs from "fs";
import { registerDownloadHandlers }     from "./ipc/download.js";
import { registerUpdaterHandlers }      from "./ipc/updater.js";
import { registerYtdlpUpdaterHandlers } from "./ipc/ytdlp-update.js";
import { registerCookiesHandlers }      from "./ipc/cookies.js";
import { registerTranscribeHandlers }   from "./ipc/transcribe.js";
import { logger } from "./core/logger.js";
import { isTrustedSender, DEV_ORIGIN } from "./ipc/guard.js";

const isDev = !app.isPackaged;
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

function openHttpsExternally(raw: string): boolean {
  try {
    if (typeof raw !== "string" || raw.length > 2048) return false;
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    void shell.openExternal(u.toString());
    return true;
  } catch {
    return false;
  }
}

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
      sandbox: true,   
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openHttpsExternally(url);
    return { action: "deny" };
  });
  const blockNavigation = (e: Electron.Event, url: string) => {
    e.preventDefault();
    openHttpsExternally(url);
  };
  win.webContents.on("will-navigate", blockNavigation);
  win.webContents.on("will-redirect", blockNavigation);

  const loadPromise = isDev
    ? win.loadURL(DEV_ORIGIN)
    : win.loadFile(path.join(__dirname, "../../dist/renderer/index.html"));

  loadPromise.catch((err) => logger.error("main", "Không load được cửa sổ chính", err));

  return win;
}

function registerAppHandlers(win: BrowserWindow) {
  ipcMain.handle("app:getDefaultDir", (evt) =>
    isTrustedSender(evt, win, "app:getDefaultDir") ? app.getPath("downloads") : null);
  ipcMain.handle("app:getVersion", (evt) =>
    isTrustedSender(evt, win, "app:getVersion") ? app.getVersion() : null);
  ipcMain.handle("app:openPath", async (evt, filePath: unknown) => {
    if (!isTrustedSender(evt, win, "app:openPath")) return;
    try {
      if (typeof filePath !== "string" || !filePath || filePath.length > 1024) return;
      if (filePath.includes("\0") || !path.isAbsolute(filePath)) return;
      let stat: fs.Stats | null = null;
      try { stat = fs.statSync(filePath); } catch { /* không tồn tại */ }
      if (stat?.isFile()) { shell.showItemInFolder(filePath); return; }
      if (stat?.isDirectory()) { await shell.openPath(filePath); return; }
      const parent = path.dirname(filePath);
      if (fs.existsSync(parent)) await shell.openPath(parent);
    } catch (err) {
      logger.warn("app:openPath", "Không mở được thư mục chứa file", { err });
    }
  });

  ipcMain.handle("app:openExternal", (evt, url: unknown) => {
    if (!isTrustedSender(evt, win, "app:openExternal")) return false;
    return typeof url === "string" ? openHttpsExternally(url) : false;   // chỉ mở link https
  });

  // Custom window controls
  ipcMain.on("win:minimize", (evt) => { if (isTrustedSender(evt, win, "win:minimize")) win.minimize(); });
  ipcMain.on("win:maximize", (evt) => {
    if (!isTrustedSender(evt, win, "win:maximize")) return;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
  });
  ipcMain.on("win:close",    (evt) => { if (isTrustedSender(evt, win, "win:close")) win.close(); });
}

const gotSingleLock = app.requestSingleInstanceLock();

if (!gotSingleLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const existing = BrowserWindow.getAllWindows()[0];
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
    }
  });

  // Không bao giờ gắn <webview>
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (ev) => ev.preventDefault());
  });

  app.whenReady().then(() => {
    // App không cần quyền camera/mic/vị trí/thông báo... → từ chối mọi yêu cầu quyền
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    const win = createWindow();
    registerDownloadHandlers(win);
    registerUpdaterHandlers(win);
    registerYtdlpUpdaterHandlers(win);
    registerCookiesHandlers(win);
    registerTranscribeHandlers(win);
    registerAppHandlers(win);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
