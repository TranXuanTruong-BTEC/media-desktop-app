import { ipcMain, BrowserWindow, dialog, app } from "electron";
import path from "path";
import { IPC, DownloadRequest } from "../../shared/ipc-types.js";
import { startDownload } from "../core/downloader.js";
import { logger } from "../core/logger.js";
import { isValidId, isValidDownloadUrl, validateOutputDir, VALID_QUALITIES, redactUrl } from "../core/security.js";
import { isTrustedSender } from "./guard.js";

type CancelFn = (sync?: boolean) => void;

const activeCancels  = new Map<string, CancelFn>();
/** % tiến trình của từng tải đang chạy — dùng để vẽ thanh tiến trình trên taskbar */
const activeProgress = new Map<string, number>();

/** Thư mục người dùng đã chọn qua hộp thoại trong phiên này (cho phép cả đường dẫn UNC). */
const dialogDirs = new Set<string>();

/** Giới hạn số tiến trình yt-dlp chạy đồng thời ở phía main (renderer chỉ chạy tối đa 3). */
const MAX_ACTIVE_DOWNLOADS = 8;

/**
 * Kiểm tra + chuẩn hoá request từ renderer trước khi đụng tới filesystem/spawn.
 * Trả về request đã làm sạch, hoặc null nếu không hợp lệ.
 */
function parseRequest(req: unknown): DownloadRequest | null {
  if (!req || typeof req !== "object") return null;
  const r = req as Partial<DownloadRequest>;
  if (!isValidId(r.id)) return null;
  if (!isValidDownloadUrl(r.url)) return null;
  if (typeof r.quality !== "string" || !VALID_QUALITIES.has(r.quality)) return null;
  const outputDir = validateOutputDir(r.outputDir, dialogDirs);
  if (!outputDir) return null;
  return { id: r.id, url: r.url, quality: r.quality as DownloadRequest["quality"], outputDir };
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

  ipcMain.handle(IPC.SELECT_DIR, async (evt) => {
    if (!isTrustedSender(evt, win, IPC.SELECT_DIR)) return null;
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    const chosen = r.filePaths[0];
    const norm = validateOutputDir(chosen, new Set([path.normalize(chosen)]));
    if (!norm) return null;
    dialogDirs.add(norm);          // người dùng tự chọn → tin cậy (kể cả UNC)
    return chosen;
  });

  ipcMain.on(IPC.DOWNLOAD_START, (evt, raw: unknown) => {
    if (!isTrustedSender(evt, win, IPC.DOWNLOAD_START)) return;

    const req = parseRequest(raw);
    if (!req) {
      const rawReq = (raw && typeof raw === "object" ? raw : {}) as Partial<DownloadRequest>;
      logger.warn("ipc:download", "Request không hợp lệ bị chặn", { url: redactUrl(rawReq.url) });
      if (isValidId(rawReq.id)) {
        send.error(win, { id: rawReq.id, message: "Yêu cầu tải không hợp lệ (URL, chất lượng hoặc thư mục lưu không đúng)." });
      }
      return;
    }

    if (activeCancels.has(req.id)) return;   // trùng id: không ghi đè hàm huỷ của tải đang chạy
    if (activeCancels.size >= MAX_ACTIVE_DOWNLOADS) {
      send.error(win, { id: req.id, message: "Đang có quá nhiều lượt tải chạy cùng lúc. Hãy thử lại sau." });
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

  ipcMain.on(IPC.DOWNLOAD_CANCEL, (evt, id: unknown) => {
    if (!isTrustedSender(evt, win, IPC.DOWNLOAD_CANCEL)) return;
    if (!isValidId(id)) return;
    activeCancels.get(id)?.();
    finish(win, id, false);
  });
}
