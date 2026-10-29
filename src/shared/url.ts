export function extractFirstUrl(text: string): string | null {
  if (typeof text !== "string") return null;
  const m = text.match(/https?:\/\/(?:(?!https?:\/\/)[^\s<>"'`【】「」（）()\u3000-\u303f\uff00-\uffef\u4e00-\u9fff])+/i);
  if (!m) return null;
  return m[0].replace(/[.,;:!?)\]}>]+$/, "");
}

const DOUYIN_HOST = /(^|\.)douyin\.com$/i;
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

export function normalizeDownloadUrl(input: string): string | null {
  const first = extractFirstUrl(input.trim());
  return first ? canonicalizeDouyin(first) : null;
}
