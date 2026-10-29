// src/shared/url.ts
// Làm sạch link người dùng dán vào — thuần hàm, dùng được ở cả renderer lẫn main.

/** Lấy link http(s) ĐẦU TIÊN trong đoạn text (link dán dính đôi, hoặc cả đoạn "chia sẻ" của Douyin/TikTok). */
export function extractFirstUrl(text: string): string | null {
  if (typeof text !== "string") return null;
  // Dừng trước khoảng trắng, dấu ngoặc/nháy, ký tự CJK, hoặc khi gặp "http" kế tiếp (link dính liền nhau).
  const m = text.match(/https?:\/\/(?:(?!https?:\/\/)[^\s<>"'`【】「」（）()\u3000-\u303f\uff00-\uffef\u4e00-\u9fff])+/i);
  if (!m) return null;
  return m[0].replace(/[.,;:!?)\]}>]+$/, "");
}

const DOUYIN_HOST = /(^|\.)douyin\.com$/i;

/**
 * Douyin: các trang dạng /jingxuan?modal_id=ID, /discover?modal_id=ID, /user/xxx?modal_id=ID,
 * /search/xxx?modal_id=ID, /follow?modal_id=ID... đều là video ID — yt-dlp chỉ nhận /video/ID.
 */
export function canonicalizeDouyin(raw: string): string {
  try {
    const u = new URL(raw);
    if (!DOUYIN_HOST.test(u.hostname) || u.hostname.toLowerCase().startsWith("v.")) return raw;
    const m = u.pathname.match(/^\/(?:video|note)\/(\d{6,25})\/?$/);
    if (m) return `https://www.douyin.com/video/${m[1]}`;
    const id = u.searchParams.get("modal_id");
    if (id && /^\d{6,25}$/.test(id)) return `https://www.douyin.com/video/${id}`;
    return raw;
  } catch {
    return raw;
  }
}

/** Link sạch để tải, hoặc null nếu không tìm thấy link http(s). */
export function normalizeDownloadUrl(input: string): string | null {
  const first = extractFirstUrl(input.trim());
  return first ? canonicalizeDouyin(first) : null;
}
