// src/main/ipc/guard.ts
// Chỉ chấp nhận IPC từ khung chính của cửa sổ app (không phải iframe / cửa sổ lạ / trang từ xa).
import { app, BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { logger } from "../core/logger.js";

export const DEV_ORIGIN = "http://localhost:5173";

export function isTrustedSender(
  evt: IpcMainEvent | IpcMainInvokeEvent,
  win: BrowserWindow,
  channel = "",
): boolean {
  let ok = false;
  try {
    const frame = evt.senderFrame;
    if (!win.isDestroyed() && evt.sender === win.webContents && frame && frame.parent === null) {
      const u = new URL(frame.url);
      // Bản đóng gói: trang local (file://). Dev: Vite dev server.
      ok = app.isPackaged ? u.protocol === "file:" : u.origin === DEV_ORIGIN;
    }
  } catch { ok = false; }

  if (!ok) logger.warn("ipc:guard", "Chặn IPC từ nguồn không tin cậy", { channel });
  return ok;
}
