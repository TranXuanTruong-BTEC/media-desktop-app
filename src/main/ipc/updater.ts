// src/main/ipc/updater.ts
import { ipcMain, BrowserWindow, app } from "electron";
import { autoUpdater, UpdateInfo } from "electron-updater";
import { logger } from "../core/logger.js";

export type UpdateStatus =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available";    version: string; releaseNotes: string }
  | { phase: "not-available" }
  | { phase: "downloading";  percent: number }
  | { phase: "ready";        version: string }
  | { phase: "error";        message: string };

function send(win: BrowserWindow, status: UpdateStatus) {
  if (!win.isDestroyed()) win.webContents.send("updater:status", status);
}

function friendlyMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "Unknown error");
  if (/sha512 checksum mismatch/i.test(raw)) {
    return "File cập nhật không khớp checksum. Hãy tải bản cài đặt mới từ GitHub Releases.";
  }
  if (/Cannot parse update info|YAMLException|latest\.yml/i.test(raw)) {
    return "Không đọc được thông tin phiên bản (latest.yml). Bản phát hành có thể bị lỗi metadata.";
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|net::/i.test(raw)) {
    return "Không kết nối được GitHub để kiểm tra cập nhật. Thử lại sau.";
  }
  if (/not packed|skip checkForUpdates/i.test(raw)) {
    return "Chỉ kiểm tra cập nhật trên bản đã cài đặt (không dùng được ở chế độ dev).";
  }
  return raw;
}

export function registerUpdaterHandlers(win: BrowserWindow) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableDifferentialDownload = true;
  // Tránh CDN giữ latest.yml cũ (BOM / version lệch) sau khi phát hành lại.
  autoUpdater.requestHeaders = { "Cache-Control": "no-cache" };

  autoUpdater.logger = {
    info:  (m?: unknown) => logger.info("updater",  String(m)),
    warn:  (m?: unknown) => logger.warn("updater",  String(m)),
    error: (m?: unknown) => logger.error("updater", String(m)),
    debug: () => {},
  };

  autoUpdater.on("checking-for-update", () => {
    send(win, { phase: "checking" });
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    const notes =
      typeof info.releaseNotes === "string"
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map((n: any) => (typeof n === "string" ? n : n?.note ?? "")).join("\n")
        : "";
    send(win, {
      phase: "available",
      version: info.version,
      releaseNotes: notes.replace(/<[^>]+>/g, "").trim(),
    });
  });

  autoUpdater.on("update-not-available", () => {
    send(win, { phase: "not-available" });
  });

  autoUpdater.on("download-progress", (p) => {
    send(win, { phase: "downloading", percent: Math.round(p.percent) });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    send(win, { phase: "ready", version: info.version });
  });

  autoUpdater.on("error", (err: Error) => {
    logger.error("updater", "autoUpdater error", err);
    send(win, { phase: "error", message: friendlyMessage(err) });
  });

  ipcMain.handle("updater:check", async () => {
    if (!app.isPackaged) {
      send(win, { phase: "not-available" });
      return;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (e: any) {
      logger.error("updater", "checkForUpdates thất bại", e);
      send(win, { phase: "error", message: friendlyMessage(e) });
    }
  });

  ipcMain.handle("updater:downloadNow", async () => {
    if (!app.isPackaged) {
      send(win, { phase: "error", message: "Không tải cập nhật được ở chế độ dev." });
      return;
    }
    try {
      send(win, { phase: "downloading", percent: 0 });
      await autoUpdater.downloadUpdate();
    } catch (e: any) {
      logger.error("updater", "downloadUpdate thất bại", e);
      send(win, { phase: "error", message: friendlyMessage(e) });
    }
  });

  ipcMain.handle("updater:installNow", () => {
    autoUpdater.quitAndInstall(false, true);
  });
}
