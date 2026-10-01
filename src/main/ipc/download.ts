import { ipcMain, BrowserWindow, dialog, app } from "electron";
import { IPC, DownloadRequest } from "../../shared/ipc-types.js";
import { startDownload } from "../core/downloader.js";
import { logger } from "../core/logger.js";

type CancelFn = (sync?: boolean) => void;

const activeCancels  = new Map<string, CancelFn>();
/** % tiến trình của từng tải đang chạy — dùng để vẽ thanh tiến trình trên taskbar */
const activeProgress = new Map<string, number>();

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

/** Thanh tiến trình trên biểu tượng taskbar: trung bình các tải đang chạy, ẩn khi rảnh. */
function updateTaskbar(win: BrowserWindow) {
  if (win.isDestroyed()) return;
  if (activeProgress.size === 0) { win.setProgressBar(-1); return; }
  let sum = 0;
  for (const v of activeProgress.values()) sum += v;
  win.setProgressBar(Math.min(1, Math.max(0, sum / activeProgress.size / 100)));
}

/** Kết thúc 1 tải (xong / lỗi / huỷ). notify=true: nháy taskbar nếu cửa sổ đang không được focus. */
function finish(win: BrowserWindow, id: string, notify: boolean) {
  activeCancels.delete(id);
  activeProgress.delete(id);
  updateTaskbar(win);
  if (notify && activeProgress.size === 0 && !win.isDestroyed() && !win.isFocused()) {
    win.flashFrame(true);
    win.once("focus", () => win.flashFrame(false));
  }
}

/** Dừng toàn bộ tải (kèm ffmpeg con) — gọi khi thoát app để không để tiến trình chạy mồ côi. */
export function cancelAllDownloads() {
  for (const cancel of activeCancels.values()) {
    try { cancel(true); } catch { /* ignore */ }
  }
  activeCancels.clear();
  activeProgress.clear();
}

export function registerDownloadHandlers(win: BrowserWindow) {
  app.on("before-quit", cancelAllDownloads);

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
      activeProgress.set(req.id, 0);
      updateTaskbar(win);

      emitter.on("progress", p => {
        // Bỏ qua progress đến muộn sau khi đã huỷ/kết thúc
        if (!activeCancels.has(p.id)) return;
        activeProgress.set(p.id, p.percent);
        updateTaskbar(win);
        send.progress(win, p);
      });
      emitter.on("retrying", r => send.retrying(win, r));
      emitter.on("complete", c => { finish(win, req.id, true); send.complete(win, c); });
      emitter.on("error",    e => { finish(win, req.id, true); send.error(win, e); });
    } catch (err) {
      // Bọc toàn bộ trong try/catch: mọi lỗi bất ngờ khi khởi động tải sẽ được
      // báo về UI dưới dạng thông báo lỗi thay vì làm crash main process.
      logger.error("ipc:download", "Lỗi không mong muốn khi bắt đầu tải", err);
      finish(win, req.id, false);
      send.error(win, { id: req.id, message: "Đã xảy ra lỗi không mong muốn khi bắt đầu tải." });
    }
  });

  ipcMain.on(IPC.DOWNLOAD_CANCEL, (_evt: unknown, id: string) => {
    activeCancels.get(id)?.();
    finish(win, id, false);
  });
}
