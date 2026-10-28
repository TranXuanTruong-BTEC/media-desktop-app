// src/main/ipc/cookies.ts
// Quản lý cookies.txt do người dùng cung cấp. Nội dung cookie KHÔNG bao giờ được gửi ngược về renderer
// hay ghi vào log — chỉ trả số lượng + tên miền.
import { ipcMain, BrowserWindow, dialog } from "electron";
import fs from "fs";
import { IPC, CookiesResult, CookiesStatus } from "../../shared/ipc-types.js";
import { getCookiesPath } from "../core/downloader.js";
import { parseCookiesText, MAX_COOKIES_BYTES } from "../core/cookies.js";
import { logger } from "../core/logger.js";
import { isTrustedSender } from "./guard.js";

const MAX_DOMAINS_SHOWN = 8;

function readStatus(): CookiesStatus {
  const file = getCookiesPath();
  const empty: CookiesStatus = { exists: false, count: 0, domains: [], totalDomains: 0, updatedAt: null };
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_COOKIES_BYTES) return empty;
    const parsed = parseCookiesText(fs.readFileSync(file, "utf8"));
    if (!parsed.ok) return empty;
    return {
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

  ipcMain.handle(IPC.COOKIES_CLEAR, (evt): CookiesResult => {
    if (!isTrustedSender(evt, win, IPC.COOKIES_CLEAR)) return { ok: false, error: "Yêu cầu bị từ chối." };
    try {
      fs.rmSync(getCookiesPath(), { force: true });
      logger.info("ipc:cookies", "Đã xoá cookies");
      return { ok: true, status: readStatus() };
    } catch (err) {
      logger.error("ipc:cookies", "Không xoá được cookies.txt", err);
      return { ok: false, error: "Không xoá được file cookies." };
    }
  });
}
