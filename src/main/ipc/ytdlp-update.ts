/**
 * src/main/ipc/ytdlp-update.ts
 *
 * IPC bridge cho tính năng tự cập nhật yt-dlp.
 * Chỉ làm đúng một việc: nhận lệnh từ renderer / main, gọi core, forward status về UI.
 */

import { ipcMain, BrowserWindow, app } from "electron";
import { checkAndUpdateYtDlp, YtdlpUpdatePhase } from "../core/ytdlp-updater.js";

export const YTDLP_IPC = {
  STATUS: "ytdlp-updater:status",
  CHECK:  "ytdlp-updater:check",
  FORCE:  "ytdlp-updater:force",
} as const;

function send(win: BrowserWindow, status: YtdlpUpdatePhase) {
  if (!win.isDestroyed()) win.webContents.send(YTDLP_IPC.STATUS, status);
}

function runUpdate(win: BrowserWindow, force = false) {
  const emitter = checkAndUpdateYtDlp(force);
  emitter.on("status", (s) => {
    send(win, s);
    if (!app.isPackaged) console.log("[ytdlp-updater]", s);
  });
}

export function registerYtdlpUpdaterHandlers(win: BrowserWindow) {
  // Renderer gọi thủ công (nút "Kiểm tra")
  ipcMain.handle(YTDLP_IPC.CHECK, () => runUpdate(win, false));

  // Renderer ép tải lại (nút "Tải lại yt-dlp")
  ipcMain.handle(YTDLP_IPC.FORCE, () => runUpdate(win, true));

  // Tự động check khi app khởi động — chỉ bản đóng gói, delay 5s
  if (app.isPackaged) {
    setTimeout(() => runUpdate(win, false), 5000);
  }
}
