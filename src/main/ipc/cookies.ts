// src/main/ipc/cookies.ts
// Quản lý cookies.txt do người dùng cung cấp. Nội dung cookie KHÔNG bao giờ được gửi ngược về renderer
// hay ghi vào log — chỉ trả số lượng + tên miền.
import { ipcMain, BrowserWindow, dialog } from "electron";
import fs from "fs";
import { IPC, CookiesResult, CookiesStatus } from "../../shared/ipc-types.js";
import { getCookiesPath, getCookieBrowser, setCookieBrowser, setCookieUserAgent, clearCookieUserAgent } from "../core/downloader.js";
import {
  parseCookiesText, isCookieBrowser, isCookieSite, toNetscapeLines, mergeCookieText,
  COOKIE_SITES, MAX_COOKIES_BYTES,
} from "../core/cookies.js";
import { runCookieLogin, clearLoginSession } from "../core/cookie-login.js";
import { logger } from "../core/logger.js";
import { isTrustedSender } from "./guard.js";

const MAX_DOMAINS_SHOWN = 8;

function readStatus(): CookiesStatus {
  const file = getCookiesPath();
  const browser = getCookieBrowser();
  const empty: CookiesStatus = { browser, exists: false, count: 0, domains: [], totalDomains: 0, updatedAt: null };
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_COOKIES_BYTES) return empty;
    const parsed = parseCookiesText(fs.readFileSync(file, "utf8"));
    if (!parsed.ok) return empty;
    return {
      browser,
      exists: true,
      count: parsed.summary.count,
      domains: parsed.summary.domains.slice(0, MAX_DOMAINS_SHOWN),
      totalDomains: parsed.summary.domains.length,
      updatedAt: stat.mtimeMs,
    };
  } catch {
    return empty;
  }
}

/** Ghi nguyên tử (file tạm → rename) và giới hạn quyền đọc ở chủ sở hữu. */
function saveCookies(raw: unknown): CookiesResult {
  const parsed = parseCookiesText(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const file = getCookiesPath();
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, parsed.text, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    logger.error("ipc:cookies", "Không ghi được cookies.txt", err);
    return { ok: false, error: "Không lưu được cookies. Hãy thử lại." };
  }
  logger.info("ipc:cookies", "Đã lưu cookies", { count: parsed.summary.count, domains: parsed.summary.domains.length });
  return { ok: true, status: readStatus() };
}

export function registerCookiesHandlers(win: BrowserWindow) {
  ipcMain.handle(IPC.COOKIES_STATUS, (evt): CookiesStatus | null =>
    isTrustedSender(evt, win, IPC.COOKIES_STATUS) ? readStatus() : null);

  ipcMain.handle(IPC.COOKIES_SAVE, (evt, text: unknown): CookiesResult => {
    if (!isTrustedSender(evt, win, IPC.COOKIES_SAVE)) return { ok: false, error: "Yêu cầu bị từ chối." };
    return saveCookies(text);
  });

  ipcMain.handle(IPC.COOKIES_IMPORT, async (evt): Promise<CookiesResult> => {
    if (!isTrustedSender(evt, win, IPC.COOKIES_IMPORT)) return { ok: false, error: "Yêu cầu bị từ chối." };
    const r = await dialog.showOpenDialog(win, {
      title: "Chọn file cookies.txt",
      properties: ["openFile"],
      filters: [{ name: "cookies.txt", extensions: ["txt"] }, { name: "Tất cả file", extensions: ["*"] }],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    try {
      const stat = fs.statSync(r.filePaths[0]);
      if (!stat.isFile()) return { ok: false, error: "Đường dẫn đã chọn không phải là file." };
      if (stat.size > MAX_COOKIES_BYTES) return { ok: false, error: "File quá lớn (tối đa 2 MB)." };
      return saveCookies(fs.readFileSync(r.filePaths[0], "utf8"));
    } catch (err) {
      logger.warn("ipc:cookies", "Không đọc được file đã chọn", { err });
      return { ok: false, error: "Không đọc được file đã chọn." };
    }
  });

  ipcMain.handle(IPC.COOKIES_SET_BROWSER, (evt, browser: unknown): CookiesResult => {
    if (!isTrustedSender(evt, win, IPC.COOKIES_SET_BROWSER)) return { ok: false, error: "Yêu cầu bị từ chối." };
    if (!isCookieBrowser(browser)) return { ok: false, error: "Trình duyệt không hợp lệ." };
    try {
      setCookieBrowser(browser);
      logger.info("ipc:cookies", "Đã đổi nguồn cookies trình duyệt", { browser });
      return { ok: true, status: readStatus() };
    } catch (err) {
      logger.error("ipc:cookies", "Không lưu được lựa chọn trình duyệt", err);
      return { ok: false, error: "Không lưu được lựa chọn. Hãy thử lại." };
    }
  });

  // Tự lấy cookies: mở cửa sổ đăng nhập → đọc cookies của phiên → gộp vào cookies.txt
  ipcMain.handle(IPC.COOKIES_LOGIN, async (evt, site: unknown): Promise<CookiesResult> => {
    if (!isTrustedSender(evt, win, IPC.COOKIES_LOGIN)) return { ok: false, error: "Yêu cầu bị từ chối." };
    if (!isCookieSite(site)) return { ok: false, error: "Trang không hợp lệ." };

    let outcome;
    try {
      outcome = await runCookieLogin(win, site);
    } catch {
      return { ok: false, error: "Cửa sổ đăng nhập đang mở. Hãy hoàn tất hoặc đóng nó trước." };
    }

    const cfg = COOKIE_SITES[site];
    const lines = toNetscapeLines(outcome.cookies, cfg.domains);
    if (lines.length === 0) {
      return { ok: false, error: "Chưa lấy được cookies. Hãy thử lại và chờ trang tải xong trước khi đóng cửa sổ." };
    }

    let existing: string | null = null;
    try {
      const f = getCookiesPath();
      if (fs.existsSync(f) && fs.statSync(f).size <= MAX_COOKIES_BYTES) existing = fs.readFileSync(f, "utf8");
    } catch { existing = null; }

    const saved = saveCookies(mergeCookieText(existing, lines, cfg.domains));
    if (!saved.ok) return saved;

    try {
      setCookieBrowser("none");                       // cookies vừa lấy là nguồn mới nhất → bỏ lựa chọn trình duyệt cũ
      setCookieUserAgent(outcome.userAgent);          // yt-dlp dùng đúng UA của cửa sổ đăng nhập cho Douyin/TikTok
    } catch (err) { logger.warn("ipc:cookies", "Không lưu được cài đặt đi kèm", { err }); }

    logger.info("ipc:cookies", "Đã lấy cookies qua cửa sổ đăng nhập", { site, count: lines.length, loggedIn: outcome.loggedIn });
    return { ok: true, loggedIn: outcome.loggedIn, count: lines.length, status: readStatus() };
  });

  ipcMain.handle(IPC.COOKIES_CLEAR, async (evt): Promise<CookiesResult> => {
    if (!isTrustedSender(evt, win, IPC.COOKIES_CLEAR)) return { ok: false, error: "Yêu cầu bị từ chối." };
    try {
      fs.rmSync(getCookiesPath(), { force: true });
      clearCookieUserAgent();
      await clearLoginSession();                      // đăng xuất khỏi cửa sổ đăng nhập
      logger.info("ipc:cookies", "Đã xoá cookies");
      return { ok: true, status: readStatus() };
    } catch (err) {
      logger.error("ipc:cookies", "Không xoá được cookies.txt", err);
      return { ok: false, error: "Không xoá được file cookies." };
    }
  });
}
