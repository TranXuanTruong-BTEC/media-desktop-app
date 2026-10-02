/**
 * src/main/core/security.ts
 *
 * Các hàm thuần (không phụ thuộc Electron) phục vụ kiểm tra đầu vào và xác minh
 * toàn vẹn. Tách riêng để có thể unit-test độc lập (xem scripts/security-selftest.js).
 */

import crypto from "crypto";
import fs from "fs";
import nodePath from "path";
import { VideoQuality } from "../../shared/ipc-types.js";

// ─── Request validation ──────────────────────────────────────────────────────

export const VALID_QUALITIES: ReadonlySet<string> = new Set<VideoQuality>([
  "bestvideo+bestaudio", "1080p", "720p", "480p", "360p", "audio_mp3", "audio_m4a",
]);

const MAX_URL_LENGTH  = 2048;
const MAX_PATH_LENGTH = 400;

/** id do renderer sinh ra; chỉ cho ký tự an toàn (dùng làm khoá Map + gửi lại UI). */
export function isValidId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** Chỉ nhận http(s), không khoảng trắng/ký tự điều khiển, độ dài hợp lý. */
export function isValidDownloadUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return false;
  try {
    const u = new URL(raw);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Minimal shape of node's `path` (so tests can pass path.win32). */
export interface PathApi {
  isAbsolute(p: string): boolean;
  normalize(p: string): string;
  sep: string;
}

/**
 * Kiểm tra thư mục lưu do renderer gửi lên. Trả về đường dẫn đã chuẩn hoá, hoặc null.
 *  - phải là đường dẫn tuyệt đối, không chứa NUL, không quá dài;
 *  - chặn namespace thiết bị Windows (\\.\ và \\?\);
 *  - đường dẫn UNC (\\server\share) chỉ được chấp nhận khi người dùng đã chọn nó
 *    qua hộp thoại chọn thư mục (allowedUnc) — tránh bị ép ghi/kết nối tới SMB
 *    của kẻ tấn công (rò rỉ hash NTLM).
 */
export function validateOutputDir(
  dir: unknown,
  allowedUnc: ReadonlySet<string> = new Set(),
  pathApi: PathApi = nodePath,
): string | null {
  if (typeof dir !== "string" || dir.length === 0 || dir.length > MAX_PATH_LENGTH) return null;
  if (dir.includes("\0")) return null;
  if (!pathApi.isAbsolute(dir)) return null;

  const normalized = pathApi.normalize(dir);
  const isWinStyle = pathApi.sep === "\\";

  if (isWinStyle) {
    if (/^[\\/]{2}[.?][\\/]/.test(normalized)) return null;          // \\.\ , \\?\
    if (/^[\\/]{2}[^\\/]/.test(normalized) && !allowedUnc.has(normalized)) return null; // UNC
  }
  return normalized;
}

/** yt-dlp diễn giải `%(...)s` trong template -o; thư mục chứa `%` phải được escape. */
export function escapeOutputTemplate(dir: string): string {
  return dir.replace(/%/g, "%%");
}

// ─── Network safety (updater / build scripts) ────────────────────────────────

/** Host được phép khi theo redirect lúc tải công cụ (chỉ GitHub + CDN của GitHub). */
export const GITHUB_HOSTS: readonly string[] = ["github.com", "githubusercontent.com"];

export function isAllowedHost(hostname: string, allowed: readonly string[]): boolean {
  const h = hostname.toLowerCase();
  return allowed.some(a => h === a || h.endsWith("." + a));
}

/**
 * Giải quyết header Location (có thể là đường dẫn tương đối) thành URL an toàn:
 * chỉ https và host nằm trong allowlist. Trả null nếu không hợp lệ.
 */
export function resolveSafeRedirect(
  location: string,
  base: string,
  allowedHosts: readonly string[] = GITHUB_HOSTS,
): URL | null {
  try {
    const u = new URL(location, base);
    if (u.protocol !== "https:") return null;
    if (!isAllowedHost(u.hostname, allowedHosts)) return null;
    return u;
  } catch {
    return null;
  }
}

/** Tag release yt-dlp hợp lệ, vd. "2026.08.19" hoặc "2026.08.19.1". */
export function isValidYtdlpTag(tag: unknown): boolean {
  return typeof tag === "string" && /^\d{4}\.\d{2}\.\d{2}(\.\d{1,8})?$/.test(tag);
}

// ─── Integrity ───────────────────────────────────────────────────────────────

/** Đọc hash SHA-256 của `filename` từ nội dung file dạng `<hex>  <name>` (SHA2-256SUMS). */
export function parseSha256Sums(text: string, filename: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (!m) continue;
    const name = m[2].trim().replace(/^\.?\//, "");
    if (name === filename) return m[1].toLowerCase();
  }
  return null;
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("error", reject)
      .on("data", d => h.update(d))
      .on("end", () => resolve(h.digest("hex")));
  });
}

/** File thực thi Windows (PE) bắt đầu bằng "MZ". */
export function looksLikeWindowsExe(file: string): boolean {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const b = Buffer.alloc(2);
      fs.readSync(fd, b, 0, 2, 0);
      return b[0] === 0x4d && b[1] === 0x5a;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

// ─── Logging hygiene ─────────────────────────────────────────────────────────

/** Bỏ query/hash/credentials khỏi URL trước khi ghi log (có thể chứa token). */
export function redactUrl(raw: unknown): string {
  if (typeof raw !== "string") return "[non-string]";
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}${u.search || u.hash ? "?…" : ""}`;
  } catch {
    return "[invalid-url]";
  }
}

/** Nối text vào buffer nhưng chỉ giữ lại `max` ký tự cuối (tránh phình bộ nhớ). */
export function appendCapped(buf: string, text: string, max = 256 * 1024): string {
  const next = buf + text;
  return next.length > max ? next.slice(next.length - max) : next;
}
