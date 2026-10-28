// src/main/core/cookies.ts
// Kiểm tra + chuẩn hoá cookies.txt (định dạng Netscape) do người dùng dán / chọn file.
// Thuần logic, không phụ thuộc electron → dễ test.

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
