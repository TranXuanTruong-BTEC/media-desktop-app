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

export function registerUpdaterHandlers(win: BrowserWindow) {
  // Configure auto-updater
  autoUpdater.autoDownload = false;          // We let user decide
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.logger = {
    info:  (m?: unknown) => logger.info("updater",  String(m)),
    warn:  (m?: unknown) => logger.warn("updater",  String(m)),
    error: (m?: unknown) => logger.error("updater", String(m)),
    debug: () => {},
  };

  let stage: "check" | "download" = "check";

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
    stage = "download";
    send(win, { phase: "downloading", percent: Math.round(p.percent) });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    send(win, { phase: "ready", version: info.version });
  });

  autoUpdater.on("error", (err: Error) => {
    logger.error("updater", `error (stage=${stage})`, err);
    if (stage === "download") send(win, { phase: "error", message: err.message });
  });

  ipcMain.handle("updater:check", async () => {
    stage = "check";
    try {
      await autoUpdater.checkForUpdates();
    } catch (e: any) {
      logger.error("updater", "checkForUpdates thất bại", e);
    }
  });

  ipcMain.handle("updater:downloadNow", async () => {
    stage = "download";
    try {
      await autoUpdater.downloadUpdate();
    } catch (e: any) {
      logger.error("updater", "downloadUpdate thất bại", e);
      send(win, { phase: "error", message: e?.message ?? "Download failed" });
    }
  });

  ipcMain.handle("updater:installNow", () => {
    autoUpdater.quitAndInstall(false, true);
  });

  // Việc kiểm tra khi khởi động do renderer (App.tsx) kích hoạt sau 2s qua "updater:check".
  // Trước đây main cũng tự check thêm 1 lần sau 3s -> 2 lần check chồng nhau.
}