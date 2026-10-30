// src/main/core/cookies.ts
// Kiểm tra + chuẩn hoá cookies.txt (định dạng Netscape) do người dùng dán / chọn file.
// Thuần logic, không phụ thuộc electron → dễ test.

export const COOKIE_BROWSERS: readonly string[] = ["none", "firefox", "edge", "chrome", "brave"];

export function isCookieBrowser(v: unknown): v is "none" | "firefox" | "edge" | "chrome" | "brave" {
  return typeof v === "string" && COOKIE_BROWSERS.includes(v);
}

/**
 * Các trang dùng cookies đọc trực tiếp từ trình duyệt (yt-dlp không tự ký được request của Douyin,
 * nên cần phiên trình duyệt thật). Trang khác vẫn dùng file cookies.txt như bình thường.
 */
const BROWSER_COOKIE_HOSTS = ["douyin.com", "iesdouyin.com", "tiktok.com"];

export function usesBrowserCookies(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return BROWSER_COOKIE_HOSTS.some(d => h === d || h.endsWith("." + d));
  } catch { return false; }
}

// ─── Tự lấy cookies qua cửa sổ đăng nhập ─────────────────────────────────────

export type CookieSiteKey = "douyin" | "tiktok";

export const COOKIE_SITES: Record<CookieSiteKey, { url: string; domains: readonly string[]; title: string }> = {
  douyin: { url: "https://www.douyin.com/", domains: ["douyin.com", "iesdouyin.com"], title: "Đăng nhập Douyin" },
  tiktok: { url: "https://www.tiktok.com/", domains: ["tiktok.com"],                   title: "Đăng nhập TikTok" },
};

export function isCookieSite(v: unknown): v is CookieSiteKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(COOKIE_SITES, v);
}

/** Cookie như Electron trả về từ session.cookies.get() (chỉ các trường ta cần). */
export interface BrowserCookie {
  name: string;
  value: string;
  domain?: string;
  hostOnly?: boolean;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  expirationDate?: number; // giây (có thể lẻ)
}

export function domainMatches(domain: string, suffixes: readonly string[]): boolean {
  const d = domain.replace(/^#HttpOnly_/, "").replace(/^\./, "").toLowerCase();
  return suffixes.some(s => d === s || d.endsWith("." + s));
}

/** Đã đăng nhập khi có cookie `sessionid` không rỗng thuộc tên miền của trang. */
export function isLoggedIn(cookies: readonly BrowserCookie[], suffixes: readonly string[]): boolean {
  return cookies.some(c => c.name === "sessionid" && !!c.value && !!c.domain && domainMatches(c.domain, suffixes));
}

/** Đổi cookie của trình duyệt sang các dòng Netscape; chỉ giữ cookie thuộc `suffixes`, bỏ cookie đã hết hạn. */
export function toNetscapeLines(
  cookies: readonly BrowserCookie[],
  suffixes: readonly string[],
  nowSec: number = Math.floor(Date.now() / 1000),
): string[] {
  const out: string[] = [];
  for (const c of cookies) {
    if (!c.domain || !domainMatches(c.domain, suffixes)) continue;
    const path = c.path || "/";
    if (/[\t\r\n\0]/.test(c.name + c.value + path + c.domain)) continue;
    const isSession = !!c.session || !c.expirationDate;
    if (!isSession && Math.floor(c.expirationDate as number) <= nowSec) continue;
    const includeSub = !c.hostOnly;
    const dom = (includeSub ? "." : "") + c.domain.replace(/^\./, "");
    out.push([
      (c.httpOnly ? "#HttpOnly_" : "") + dom,
      includeSub ? "TRUE" : "FALSE",
      path,
      c.secure ? "TRUE" : "FALSE",
      String(isSession ? 0 : Math.floor(c.expirationDate as number)),
      c.name,
      c.value,
    ].join("\t"));
  }
  return out;
}

/** Thay toàn bộ cookie thuộc `suffixes` trong file cũ bằng `newLines`; cookie của trang khác giữ nguyên. */
export function mergeCookieText(existing: string | null, newLines: readonly string[], suffixes: readonly string[]): string {
  const kept: string[] = [];
  if (existing) {
    for (const raw of existing.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, "");
      if (!line || (line.startsWith("#") && !line.startsWith("#HttpOnly_"))) continue;
      if (domainMatches(line.split("\t")[0], suffixes)) continue;
      kept.push(line);
    }
  }
  return `${COOKIES_HEADER}\n${[...kept, ...newLines].join("\n")}\n`;
}

/** User-Agent chỉ gồm ký tự in được, độ dài hợp lý (được truyền cho yt-dlp qua --user-agent). */
export function isSafeUserAgent(v: unknown): v is string {
  return typeof v === "string" && /^[\x20-\x7E]{10,300}$/.test(v);
}

export const MAX_COOKIES_BYTES = 2 * 1024 * 1024; // 2 MB
export const COOKIES_HEADER = "# Netscape HTTP Cookie File";

export interface CookiesSummary {
  count: number;
  domains: string[]; // đã loại trùng, bỏ dấu chấm đầu
}

export type ParseCookiesResult =
  | { ok: true; text: string; summary: CookiesSummary }
  | { ok: false; error: string };

/**
 * Mỗi dòng cookie có 7 trường tách bằng TAB:
 * domain, includeSubdomains(TRUE/FALSE), path, secure(TRUE/FALSE), expiry, name, value
 * Dòng "#HttpOnly_<domain>" vẫn là cookie hợp lệ; các dòng "#..." khác là chú thích.
 */
export function parseCookiesText(raw: unknown): ParseCookiesResult {
  if (typeof raw !== "string") return { ok: false, error: "Dữ liệu cookies không hợp lệ." };
  if (Buffer.byteLength(raw, "utf8") > MAX_COOKIES_BYTES) {
    return { ok: false, error: "Nội dung quá lớn (tối đa 2 MB)." };
  }
  if (raw.includes("\0")) return { ok: false, error: "Nội dung chứa ký tự không hợp lệ." };

  const input = raw.replace(/^\uFEFF/, "").trim();
  if (!input) return { ok: false, error: "Chưa có nội dung cookies." };
  if (/^[[{]/.test(input)) {
    return {
      ok: false,
      error: "Có vẻ đây là cookies dạng JSON. Hãy xuất sang định dạng Netscape (cookies.txt) rồi dán lại.",
    };
  }

  const lines: string[] = [];
  const domains = new Set<string>();

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line) continue;
    if (line.startsWith("#") && !line.startsWith("#HttpOnly_")) continue; // chú thích

    let f = line.split("\t");
    // Dán qua trình soạn thảo có thể đổi TAB thành dấu cách → thử tách theo khoảng trắng
    if (f.length !== 7) {
      const alt = line.trim().split(/\s+/);
      if (alt.length === 7) f = alt;
      else continue;
    }

    const [domain, subdomains, p, secure, expiry, name, value] = f;
    const sub = subdomains.toUpperCase();
    const sec = secure.toUpperCase();
    if (!domain || /\s/.test(domain)) continue;
    if (sub !== "TRUE" && sub !== "FALSE") continue;
    if (sec !== "TRUE" && sec !== "FALSE") continue;
    if (!/^\d+$/.test(expiry)) continue;
    // name có thể rỗng: một số trang (vd. Douyin) có cookie không tên, yt-dlp vẫn đọc được

    lines.push([domain, sub, p, sec, expiry, name, value].join("\t"));
    domains.add(domain.replace(/^#HttpOnly_/, "").replace(/^\./, "").toLowerCase());
  }

  if (lines.length === 0) {
    return {
      ok: false,
      error:
        "Không tìm thấy cookie hợp lệ. File cần ở định dạng Netscape: mỗi dòng 7 cột, " +
        "ví dụ xuất bằng tiện ích \"Get cookies.txt LOCALLY\".",
    };
  }

  return {
    ok: true,
    text: `${COOKIES_HEADER}\n${lines.join("\n")}\n`,
    summary: { count: lines.length, domains: [...domains].sort() },
  };
}
