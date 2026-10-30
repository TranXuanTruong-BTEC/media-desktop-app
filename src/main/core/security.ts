import crypto from "crypto";
import fs from "fs";
import nodePath from "path";
import { VideoQuality } from "../../shared/ipc-types.js";

// ─── Request validation 

export const VALID_QUALITIES: ReadonlySet<string> = new Set<VideoQuality>([
  "bestvideo+bestaudio", "1080p", "720p", "480p", "360p", "audio_mp3", "audio_m4a",
]);

const MAX_URL_LENGTH  = 2048;
const MAX_PATH_LENGTH = 400;

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
export interface PathApi {
  isAbsolute(p: string): boolean;
  normalize(p: string): string;
  sep: string;
}
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


export const GITHUB_HOSTS: readonly string[] = ["github.com", "githubusercontent.com"];

export function isAllowedHost(hostname: string, allowed: readonly string[]): boolean {
  const h = hostname.toLowerCase();
  return allowed.some(a => h === a || h.endsWith("." + a));
}
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

export function isValidYtdlpTag(tag: unknown): boolean {
  return typeof tag === "string" && /^\d{4}\.\d{2}\.\d{2}(\.\d{1,8})?$/.test(tag);
}

// ─── Integrity

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
/** Băm file theo luồng (dùng cho mô hình lớn: SHA-1 do whisper.cpp công bố, SHA-256 cho file nhị phân). */
export function fileDigest(file: string, algorithm: "sha1" | "sha256"): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algorithm);
    fs.createReadStream(file)
      .on("error", reject)
      .on("data", d => h.update(d))
      .on("end", () => resolve(h.digest("hex")));
  });
}

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

// ─── Logging hygiene

export function redactUrl(raw: unknown): string {
  if (typeof raw !== "string") return "[non-string]";
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}${u.search || u.hash ? "?…" : ""}`;
  } catch {
    return "[invalid-url]";
  }
}
export function appendCapped(buf: string, text: string, max = 256 * 1024): string {
  const next = buf + text;
  return next.length > max ? next.slice(next.length - max) : next;
}
