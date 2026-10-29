// src/main/ipc/cookies.ts — nhập / xoá cookie Douyin ngay trong app (người dùng exe không có đường dẫn để tự lưu file).
import { ipcMain, dialog, BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import { getCookiesPath } from "../core/downloader.js";
import {
  sanitizeDouyinCookies, summarizeCookieFile, MAX_COOKIE_INPUT_BYTES, CookieError,
} from "../core/cookies.js";
import { isTrustedSender } from "./guard.js";
import { logger } from "../core/logger.js";

export interface CookiesStatus { exists: boolean; count: number; hasSvWebId: boolean; updatedAt: number | null; }
export interface CookiesImportResult { ok: boolean; message: string; status: CookiesStatus; canceled?: boolean; }

const ERR_VI: Record<CookieError, string> = {
  "empty":             "Nội dung trống.",
  "too-large":         "Dữ liệu quá lớn (tối đa 1MB).",
  "no-douyin-cookies": "Không tìm thấy cookie của douyin.com. Hãy xuất cookie khi đang mở trang douyin.com.",
};

function readStatus(): CookiesStatus {
  try {
    const p = getCookiesPath();
    const st = fs.statSync(p);
    return { exists: true, ...summarizeCookieFile(fs.readFileSync(p, "utf8")), updatedAt: st.mtimeMs };
  } catch {
    return { exists: false, count: 0, hasSvWebId: false, updatedAt: null };
  }
}

function save(input: unknown): CookiesImportResult {
  const r = sanitizeDouyinCookies(input);
  if (!r.ok) return { ok: false, message: ERR_VI[r.error], status: readStatus() };
  const dest = getCookiesPath();
  const tmp  = `${dest}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(tmp, r.result.content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, dest);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    logger.error("cookies", "Không ghi được cookies", e);
    return { ok: false, message: "Không lưu được cookie vào thư mục dữ liệu của app.", status: readStatus() };
  }
  const extra = r.result.skipped ? ` (bỏ qua ${r.result.skipped} dòng không phải Douyin/sai định dạng)` : "";
  const warn  = r.result.hasSvWebId ? "" : " Lưu ý: chưa thấy cookie s_v_web_id — nếu vẫn lỗi, hãy xuất lại cookie sau khi mở một video trên douyin.com.";
  return { ok: true, message: `Đã lưu ${r.result.count} cookie Douyin${extra}.${warn}`, status: readStatus() };
}

export function registerCookiesHandlers(win: BrowserWindow) {
  ipcMain.handle("cookies:status", (evt) =>
    isTrustedSender(evt, win, "cookies:status") ? readStatus() : null);

  ipcMain.handle("cookies:importFile", async (evt): Promise<CookiesImportResult | null> => {
    if (!isTrustedSender(evt, win, "cookies:importFile")) return null;
    const r = await dialog.showOpenDialog(win, {
      title: "Chọn file cookies.txt",
      properties: ["openFile"],
      filters: [{ name: "Cookies", extensions: ["txt", "cookies"] }, { name: "Tất cả", extensions: ["*"] }],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true, message: "", status: readStatus() };
    try {
      const f = r.filePaths[0];
      if (fs.statSync(f).size > MAX_COOKIE_INPUT_BYTES) return { ok: false, message: ERR_VI["too-large"], status: readStatus() };
      return save(fs.readFileSync(f, "utf8"));
    } catch {
      return { ok: false, message: "Không đọc được file đã chọn.", status: readStatus() };
    }
  });

  ipcMain.handle("cookies:importText", (evt, text: unknown): CookiesImportResult | null =>
    isTrustedSender(evt, win, "cookies:importText") ? save(text) : null);

  ipcMain.handle("cookies:clear", (evt): CookiesStatus | null => {
    if (!isTrustedSender(evt, win, "cookies:clear")) return null;
    try { fs.rmSync(getCookiesPath(), { force: true }); } catch (e) { logger.warn("cookies", "Không xoá được cookies", { e }); }
    return readStatus();
  });
}
