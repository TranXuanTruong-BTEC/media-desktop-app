// src/main/ipc/updater.ts
// Cập nhật NGẦM (kiểu Chrome): tự kiểm tra lúc mở app và định kỳ → tự tải trong nền → cài im lặng khi người dùng đóng app.
// Người dùng không phải bấm gì. Chỉ khi bản mới đã tải xong, giao diện hiện một thông báo nhỏ (không chặn thao tác)
// với nút "Cập nhật ngay" nếu họ muốn dùng bản mới liền. Lỗi mạng của lần kiểm tra tự động chỉ ghi log, không làm phiền.
import { ipcMain, BrowserWindow, app } from "electron";
import { autoUpdater, UpdateInfo } from "electron-updater";
import { logger } from "../core/logger.js";
import { isTrustedSender } from "./guard.js";

export type UpdateStatus =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available";    version: string; releaseNotes: string }
  | { phase: "not-available" }
  | { phase: "downloading";  percent: number }
  | { phase: "ready";        version: string }
  | { phase: "error";        message: string };

/** silent=true: sự kiện của lần kiểm tra tự động → giao diện không được hiện hộp thoại/lỗi. */
function send(win: BrowserWindow, status: UpdateStatus, silent: boolean) {
  if (!win.isDestroyed()) win.webContents.send("updater:status", { ...status, silent });
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

const FIRST_CHECK_MS = 15_000;                  // chờ app khởi động xong rồi mới kiểm tra
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;      // người để app mở nhiều giờ vẫn nhận được bản mới
const RETRY_MS       = 10 * 60 * 1000;          // lỗi mạng → thử lại sớm

export function registerUpdaterHandlers(win: BrowserWindow) {
  let updateDownloaded = false;     // chỉ cho "cài & khởi động lại" khi đã tải xong một bản hợp lệ
  let downloadedVersion = "";
  let busy = false;                 // đang kiểm tra hoặc đang tải
  let manual = false;               // lần kiểm tra do người dùng bấm (hiện đủ trạng thái); tự động thì im lặng
  let timer: NodeJS.Timeout | null = null;

  autoUpdater.autoDownload = true;                // tải ngầm ngay khi thấy bản mới
  autoUpdater.autoInstallOnAppQuit = true;        // đóng app → cài im lặng (không hiện trình cài đặt)
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

  const out = (s: UpdateStatus) => send(win, s, !manual);
  const endCycle = () => { busy = false; manual = false; };

  function schedule(ms: number) {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!app.isPackaged || updateDownloaded) return;
    timer = setTimeout(() => { void runCheck(false).finally(() => schedule(CHECK_EVERY_MS)); }, ms);
    timer.unref();
  }

  async function runCheck(isManual: boolean): Promise<void> {
    if (!app.isPackaged) { if (isManual) send(win, { phase: "not-available" }, false); return; }
    if (updateDownloaded) { if (isManual) send(win, { phase: "ready", version: downloadedVersion }, false); return; }
    if (busy) {
      if (isManual) manual = true;                // người dùng bấm khi đang tự tải ngầm → từ giờ hiện tiến độ cho họ xem
      return;
    }
    busy = true; manual = isManual;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      // Thường 'error' đã được phát (và đã kết thúc chu kỳ); chỉ xử lý nếu chưa.
      if (busy) {
        logger.error("updater", "checkForUpdates thất bại", e);
        out({ phase: "error", message: friendlyMessage(e) });
        endCycle();
        schedule(RETRY_MS);
      }
    }
  }

  autoUpdater.on("checking-for-update", () => out({ phase: "checking" }));

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    const notes =
      typeof info.releaseNotes === "string"
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map((n: any) => (typeof n === "string" ? n : n?.note ?? "")).join("\n")
        : "";
    out({ phase: "available", version: info.version, releaseNotes: notes.replace(/<[^>]+>/g, "").trim() });
    // autoDownload = true → electron-updater tự tải tiếp, không cần người dùng bấm.
  });

  autoUpdater.on("update-not-available", () => { out({ phase: "not-available" }); endCycle(); });

  autoUpdater.on("download-progress", (p) => out({ phase: "downloading", percent: Math.round(p.percent) }));

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    updateDownloaded = true;
    downloadedVersion = info.version;
    out({ phase: "ready", version: info.version });
    endCycle();
    if (timer) { clearTimeout(timer); timer = null; }
    logger.info("updater", `Đã tải xong ${info.version}; sẽ tự cài khi đóng app hoặc khi người dùng bấm "Cập nhật ngay".`);
  });

  autoUpdater.on("error", (err: Error) => {
    logger.error("updater", "autoUpdater error", err);
    out({ phase: "error", message: friendlyMessage(err) });
    endCycle();
    schedule(RETRY_MS);
  });

  // Người dùng bấm "Kiểm tra" trong Cài đặt → hiện đủ trạng thái.
  ipcMain.handle("updater:check", async (evt) => {
    if (!isTrustedSender(evt, win, "updater:check")) return;
    await runCheck(true);
  });

  // Giữ để tương thích: với autoDownload=true việc tải đã tự chạy; chỉ cần khi một lần tải trước đó bị lỗi.
  ipcMain.handle("updater:downloadNow", async (evt) => {
    if (!isTrustedSender(evt, win, "updater:downloadNow")) return;
    if (!app.isPackaged) { send(win, { phase: "error", message: "Không tải cập nhật được ở chế độ dev." }, false); return; }
    if (updateDownloaded || busy) return;
    manual = true; busy = true;
    try {
      await autoUpdater.downloadUpdate();
    } catch (e) {
      if (busy) {
        logger.error("updater", "downloadUpdate thất bại", e);
        out({ phase: "error", message: friendlyMessage(e) });
        endCycle();
      }
    }
  });

  // "Cập nhật ngay": cài IM LẶNG (không hiện trình cài đặt) rồi tự mở lại app.
  ipcMain.handle("updater:installNow", (evt) => {
    if (!isTrustedSender(evt, win, "updater:installNow")) return;
    if (!updateDownloaded) {
      logger.warn("updater", "installNow bị từ chối: chưa có bản cập nhật nào được tải xong");
      return;
    }
    autoUpdater.quitAndInstall(true, true);      // isSilent=true, isForceRunAfter=true
  });

  schedule(FIRST_CHECK_MS);                      // kiểm tra tự động lần đầu (sau đó định kỳ)
}
