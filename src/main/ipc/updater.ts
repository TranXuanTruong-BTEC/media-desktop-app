// src/main/ipc/updater.ts
import { ipcMain, BrowserWindow, app } from "electron";
import { autoUpdater, UpdateInfo } from "electron-updater";

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

  // ── Events ──────────────────────────────────────────────────────────────
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
    // Bỏ qua lỗi chưa có release trên GitHub
    if (err.message.includes("latest.yml") || err.message.includes("ENOENT")) return;
    send(win, { phase: "error", message: err.message });
  });

  // ── IPC handlers ─────────────────────────────────────────────────────────
  ipcMain.handle("updater:check", async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (e: any) {
      send(win, { phase: "error", message: e?.message ?? "Unknown error" });
    }
  });

  ipcMain.handle("updater:downloadNow", async () => {
    try {
      await autoUpdater.downloadUpdate();
    } catch (e: any) {
      send(win, { phase: "error", message: e?.message ?? "Download failed" });
    }
  });

  ipcMain.handle("updater:installNow", () => {
    autoUpdater.quitAndInstall(false, true);
  });

  // ── Auto-check after 3 s on startup (only in packaged app) ───────────────
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {/* silently ignore on startup */});
    }, 3000);
  }
}
