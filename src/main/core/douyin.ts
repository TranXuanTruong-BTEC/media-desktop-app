// src/main/core/douyin.ts
// Phần thuần (không phụ thuộc electron) của luồng tải Douyin: phân tích dữ liệu video, chọn chất lượng,
// đặt tên file, kiểm tra link tải. Dễ test.

export class UserFacingError extends Error {}

export function isDouyinUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "douyin.com" || h.endsWith(".douyin.com") || h === "iesdouyin.com" || h.endsWith(".iesdouyin.com");
  } catch { return false; }
}

/** ID video nếu link có dạng /video/<id> hoặc /note/<id>; link rút gọn (v.douyin.com) thì null. */
export function extractAwemeId(url: string): string | null {
  const m = /\/(?:video|note)\/(\d{8,})/.exec(url);
  return m ? m[1] : null;
}

export interface MediaCandidate {
  urls: string[];      // các link thay thế cho cùng một bản (ưu tiên link CDN trực tiếp)
  width: number;
  height: number;
  bitrate: number;
  hevc: boolean;
}

export interface DouyinMedia {
  id: string;
  title: string;
  author: string;
  candidates: MediaCandidate[];
  isImagePost: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : 0;
const truthy = (v: unknown): boolean => v === true || v === 1 || v === "1";
function pick(o: Obj, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

function normUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  let s = u.trim();
  if (s.startsWith("//")) s = "https:" + s;
  return /^https?:\/\//i.test(s) ? s : null;
}

/** Lấy mọi link từ các dạng địa chỉ khác nhau: {url_list:[..]}, [{src}], chuỗi... */
function collectUrls(addr: unknown): string[] {
  const out: string[] = [];
  const push = (u: unknown) => { const n = normUrl(u); if (n && !out.includes(n)) out.push(n); };
  if (typeof addr === "string") push(addr);
  else if (Array.isArray(addr)) {
    for (const it of addr) {
      if (typeof it === "string") push(it);
      else if (isObj(it)) { push(it.src); push(it.url); }
    }
  } else if (isObj(addr)) {
    const l = pick(addr, "url_list", "urlList");
    if (Array.isArray(l)) for (const u of l) push(u);
    push(addr.src); push(addr.url);
  }
  // Link qua API (aweme/v1) hay bị chặn → để sau cùng
  return out.sort((a, b) => Number(a.includes("/aweme/v1/")) - Number(b.includes("/aweme/v1/")));
}

function collectCandidates(video: Obj): MediaCandidate[] {
  const cands: MediaCandidate[] = [];
  const vw = num(video.width), vh = num(video.height);

  const add = (addr: unknown, hevc: boolean, bitrate = 0) => {
    const a = isObj(addr) ? addr : {};
    if (str(a.url_key).includes("bytevc2")) return;            // codec H.266 riêng của ByteDance, chưa phát được
    const urls = collectUrls(addr);
    if (urls.length === 0) return;
    if (cands.some(c => c.urls[0] === urls[0])) return;
    cands.push({ urls, width: num(a.width) || vw, height: num(a.height) || vh, bitrate, hevc });
  };

  const videoHevc = truthy(pick(video, "is_bytevc1", "isBytevc1", "is_h265", "isH265"));
  add(pick(video, "play_addr", "playAddr"), videoHevc);
  add(pick(video, "play_addr_h264", "playAddrH264"), false);
  add(pick(video, "play_addr_bytevc1", "playAddrBytevc1"), true);

  const rates = pick(video, "bit_rate", "bitRateList", "bitRate");
  if (Array.isArray(rates)) {
    for (const br of rates) {
      if (!isObj(br)) continue;
      const hevc = truthy(pick(br, "is_bytevc1", "isBytevc1", "is_h265", "isH265"));
      const bitrate = num(pick(br, "bit_rate", "bitRate"));
      const addr = pick(br, "play_addr", "playAddr", "playApi");
      if (isObj(addr) || Array.isArray(addr) || typeof addr === "string") {
        // width/height của entry nằm ở chính entry (RENDER_DATA) hoặc trong play_addr (API)
        const merged: Obj = isObj(addr) ? { ...addr } : { url_list: collectUrls(addr) };
        if (!merged.width && br.width) merged.width = br.width;
        if (!merged.height && br.height) merged.height = br.height;
        add(merged, hevc, bitrate);
      }
    }
  }

  // Bản có watermark chỉ dùng khi không còn lựa chọn nào khác
  if (cands.length === 0) add(pick(video, "download_addr", "downloadAddr"), false);
  return cands;
}

/** Tìm (BFS, có giới hạn) object aweme trong cây JSON bất kỳ, ưu tiên đúng `wantId` nếu có. */
function findAweme(root: unknown, wantId?: string): Obj | null {
  const queue: unknown[] = [root];
  let first: Obj | null = null;
  for (let i = 0, seen = 0; i < queue.length && seen < 30000; i++, seen++) {
    const v = queue[i];
    if (Array.isArray(v)) { for (const x of v) queue.push(x); continue; }
    if (!isObj(v)) continue;
    const id = str(pick(v, "aweme_id", "awemeId"));
    if (id && (isObj(v.video) || Array.isArray(v.images))) {
      if (!wantId || id === wantId) return v;
      first = first ?? v;
    }
    for (const k of Object.keys(v)) { const c = v[k]; if (typeof c === "object" && c !== null) queue.push(c); }
  }
  return wantId ? null : first;
}

/** Phân tích phản hồi API `aweme/v1/web/aweme/detail/` (hoặc JSON RENDER_DATA của trang). */
export function parseAwemeDetail(input: unknown, wantId?: string): DouyinMedia | null {
  const d = findAweme(isObj(input) && isObj(input.aweme_detail) ? input.aweme_detail : input, wantId);
  if (!d) return null;
  const id = str(pick(d, "aweme_id", "awemeId"));
  const video = d.video;
  const images = pick(d, "images", "imageInfos");
  const isImagePost = Array.isArray(images) && images.length > 0;
  const authorObj = pick(d, "author", "authorInfo");
  return {
    id,
    title: str(d.desc),
    author: isObj(authorObj) ? str(authorObj.nickname) : "",
    candidates: isObj(video) ? collectCandidates(video) : [],
    isImagePost,
  };
}

const HEIGHT_LIMITS: Record<string, number> = { "1080p": 1080, "720p": 720, "480p": 480, "360p": 360 };
const shortSide = (c: MediaCandidate) => Math.min(c.width || 0, c.height || 0);

/**
 * Chọn bản tải theo chất lượng người dùng chọn. "Độ phân giải" tính theo cạnh ngắn (video dọc 1080x1920 = 1080p).
 * Cùng độ phân giải thì ưu tiên H.264 (dễ phát hơn HEVC), rồi bitrate cao. Âm thanh: chọn bản nhỏ nhất cho nhẹ.
 */
export function pickCandidate(cands: readonly MediaCandidate[], quality: string): MediaCandidate | null {
  if (cands.length === 0) return null;
  const byQualityDesc = (a: MediaCandidate, b: MediaCandidate) =>
    shortSide(b) - shortSide(a) || Number(a.hevc) - Number(b.hevc) || b.bitrate - a.bitrate;

  if (quality === "audio_mp3" || quality === "audio_m4a") {
    const size = (c: MediaCandidate) => (shortSide(c) === 0 ? Number.MAX_SAFE_INTEGER : shortSide(c));
    return [...cands].sort((a, b) => size(a) - size(b) || a.bitrate - b.bitrate)[0];
  }
  const limit = HEIGHT_LIMITS[quality];
  if (limit === undefined) return [...cands].sort(byQualityDesc)[0];
  const eligible = cands.filter(c => shortSide(c) === 0 || shortSide(c) <= limit);
  if (eligible.length > 0) return [...eligible].sort(byQualityDesc)[0];
  return [...cands].sort((a, b) => shortSide(a) - shortSide(b))[0];   // không có bản nào đủ nhỏ → lấy bản nhỏ nhất
}

const RESERVED_WIN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Tên file an toàn trên Windows (bỏ ký tự cấm, cắt độ dài theo ký tự Unicode, tránh tên thiết bị). */
export function safeFilename(name: string, fallback: string, maxChars = 100): string {
  // eslint-disable-next-line no-control-regex
  let s = (name || "").replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim();
  s = Array.from(s).slice(0, maxChars).join("").replace(/[. ]+$/g, "").trim();
  if (!s) s = fallback;
  if (RESERVED_WIN.test(s)) s = "_" + s;
  return s;
}

/** Chỉ http(s) tới host công cộng — không cho link tải trỏ vào máy nội bộ (localhost, 192.168.x, ...). */
export function isSafeMediaUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (u.username || u.password) return false;
    const h = u.hostname.toLowerCase();
    if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
    if (h.startsWith("[")) return false;                       // IPv6 literal
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
    }
    return true;
  } catch { return false; }
}
