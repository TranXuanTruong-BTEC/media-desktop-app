import { ipcMain, BrowserWindow, dialog } from "electron";
import { IPC, DownloadRequest } from "../../shared/ipc-types.js";
import { startDownload } from "../core/downloader.js";
import { logger } from "../core/logger.js";

const activeCancels = new Map<string, () => void>();

/** Kiểm tra sơ bộ request từ renderer trước khi đụng tới filesystem/spawn. */
function isValidRequest(req: unknown): req is DownloadRequest {
  if (!req || typeof req !== "object") return false;
  const r = req as Partial<DownloadRequest>;
  return (
    typeof r.id === "string" && r.id.length > 0 &&
    typeof r.url === "string" && /^https?:\/\//i.test(r.url) &&
    typeof r.outputDir === "string" && r.outputDir.length > 0 &&
    typeof r.quality === "string"
  );
}

const send = {
  progress:  (win: BrowserWindow, p: unknown) =>
    !win.isDestroyed() && win.webContents.send(IPC.DOWNLOAD_PROGRESS, p),
  complete:  (win: BrowserWindow, c: unknown) =>
    !win.isDestroyed() && win.webContents.send(IPC.DOWNLOAD_COMPLETE, c),
  error:     (win: BrowserWindow, e: unknown) =>
    !win.isDestroyed() && win.webContents.send(IPC.DOWNLOAD_ERROR, e),
  retrying:  (win: BrowserWindow, r: unknown) =>
    !win.isDestroyed() && win.webContents.send(IPC.DOWNLOAD_RETRYING, r),
};

export function registerDownloadHandlers(win: BrowserWindow) {
  ipcMain.handle(IPC.SELECT_DIR, async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.on(IPC.DOWNLOAD_START, (_evt: unknown, req: unknown) => {
    if (!isValidRequest(req)) {
      logger.warn("ipc:download", "Request không hợp lệ bị chặn", req);
      const id = (req as Partial<DownloadRequest> | null)?.id;
      if (typeof id === "string") {
        send.error(win, { id, message: "Yêu cầu tải không hợp lệ (thiếu URL hoặc thư mục lưu)." });
      }
      return;
    }

    try {
      const { emitter, cancel } = startDownload(req);
      activeCancels.set(req.id, cancel);

      emitter.on("progress",  p => send.progress(win, p));
      emitter.on("retrying",  r => send.retrying(win, r));
      emitter.on("complete",  c => { activeCancels.delete(req.id); send.complete(win, c); });
      emitter.on("error",     e => { activeCancels.delete(req.id); send.error(win, e); });
    } catch (err) {
      // Bọc toàn bộ trong try/catch: mọi lỗi bất ngờ khi khởi động tải sẽ được
      // báo về UI dưới dạng thông báo lỗi thay vì làm crash main process.
      logger.error("ipc:download", "Lỗi không mong muốn khi bắt đầu tải", err);
      send.error(win, { id: req.id, message: "Đã xảy ra lỗi không mong muốn khi bắt đầu tải." });
    }
  });

  ipcMain.on(IPC.DOWNLOAD_CANCEL, (_evt: unknown, id: string) => {
    activeCancels.get(id)?.();
    activeCancels.delete(id);
  });
}
