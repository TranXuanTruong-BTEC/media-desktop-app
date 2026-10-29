export const COOKIE_SITES = {
  douyin: "Douyin",
  tiktok: "TikTok",
} as const;

export type CookieSiteKey = keyof typeof COOKIE_SITES;

export interface BrowserCookie {
  domain: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  expires?: number;
}

export function isLoggedIn(site: CookieSiteKey, cookies: BrowserCookie[]): boolean {
  // Logic kiểm tra đăng nhập tùy theo site
  return cookies.length > 0;
}

export const MAX_COOKIE_INPUT_BYTES = 1024 * 1024;
const MAX_COOKIES = 500;

export interface CookieResult {
  content: string;          // nội dung cookies.txt đã chuẩn hoá (Netscape)
  count: number;            // số cookie giữ lại
  skipped: number;          // số dòng cookie bị loại (domain khác / sai định dạng)
  hasSvWebId: boolean;      // yt-dlp cần s_v_web_id cho Douyin
}

export type CookieError = "empty" | "too-large" | "no-douyin-cookies";

const HEADER = "# Netscape HTTP Cookie File\n# Chỉ chứa cookie douyin.com (do MediaGet lọc)\n\n";

export function isDouyinDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase().replace(/^\./, "");
  return d === "douyin.com" || d.endsWith(".douyin.com") || d === "iesdouyin.com" || d.endsWith(".iesdouyin.com");
}

// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f]/;

function buildLine(prefix: string, f: string[]): string | null {
  const [domain, sub, p, secure, expiry, name, ...rest] = f;
  const value = rest.join("\t");
  if (!isDouyinDomain(domain)) return null;
  if (!/^(TRUE|FALSE)$/i.test(sub) || !/^(TRUE|FALSE)$/i.test(secure)) return null;
  if (!/^\d+$/.test(expiry)) return null;
  if (!name || /[\s=;]/.test(name) || BAD_CHARS.test(name) || BAD_CHARS.test(value) || BAD_CHARS.test(p)) return null;
  return `${prefix}${domain}\t${sub.toUpperCase()}\t${p || "/"}\t${secure.toUpperCase()}\t${expiry}\t${name}\t${value}`;
}

function fromNetscape(text: string): { lines: string[]; skipped: number; names: string[] } {
  const lines: string[] = [];
  const names: string[] = [];
  let skipped = 0;
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    let prefix = "";
    if (line.startsWith("#HttpOnly_")) { prefix = "#HttpOnly_"; line = line.slice(prefix.length); }
    else if (line.startsWith("#")) continue;

    let f = line.split("\t");
    if (f.length < 7) f = line.split(/\s+/);          // tab bị đổi thành khoảng trắng khi copy-paste
    if (f.length < 7) { skipped++; continue; }
    const out = buildLine(prefix, f);
    if (out) { lines.push(out); names.push(f[5]); } else skipped++;
  }
  return { lines, skipped, names };
}

function fromCookieHeader(text: string): { lines: string[]; skipped: number; names: string[] } {
  const lines: string[] = [];
  const names: string[] = [];
  let skipped = 0;
  const exp = String(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30);
  for (const part of text.replace(/^cookie:\s*/i, "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) { if (part.trim()) skipped++; continue; }
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    const out = buildLine("", [".douyin.com", "TRUE", "/", "TRUE", exp, name, value]);
    if (out) { lines.push(out); names.push(name); } else skipped++;
  }
  return { lines, skipped, names };
}

export function sanitizeDouyinCookies(input: unknown): { ok: true; result: CookieResult } | { ok: false; error: CookieError } {
  if (typeof input !== "string" || !input.trim()) return { ok: false, error: "empty" };
  if (Buffer.byteLength(input, "utf8") > MAX_COOKIE_INPUT_BYTES) return { ok: false, error: "too-large" };

  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const looksNetscape = text.includes("\t") || /^\s*#(HttpOnly_|\s*Netscape)/m.test(text) || text.trim().split("\n").length > 1;
  const parsed = looksNetscape ? fromNetscape(text) : fromCookieHeader(text);

  const unique = new Map<string, string>();               // khử trùng: domain|path|name
  parsed.lines.forEach((l) => {
    const f = l.replace(/^#HttpOnly_/, "").split("\t");
    unique.set(`${f[0]}|${f[2]}|${f[5]}`, l);
  });
  const lines = [...unique.values()].slice(0, MAX_COOKIES);
  if (lines.length === 0) return { ok: false, error: "no-douyin-cookies" };

  return {
    ok: true,
    result: {
      content: HEADER + lines.join("\n") + "\n",
      count: lines.length,
      skipped: parsed.skipped,
      hasSvWebId: parsed.names.includes("s_v_web_id"),
    },
  };
}

/** Đếm cookie trong file cookies.txt đã lưu (cho màn hình trạng thái). */
export function summarizeCookieFile(content: string): { count: number; hasSvWebId: boolean } {
  const lines = content.split(/\r?\n/).filter(l => l && (!l.startsWith("#") || l.startsWith("#HttpOnly_")));
  return { count: lines.length, hasSvWebId: lines.some(l => l.split("\t")[5] === "s_v_web_id") };
}