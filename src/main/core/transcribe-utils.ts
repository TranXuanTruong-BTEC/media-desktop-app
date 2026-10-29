/**
 * src/main/core/transcribe-utils.ts
 * Hàm thuần (không phụ thuộc Electron) cho tính năng Trích xuất văn bản: danh sách model,
 * parse/làm sạch SRT, parse tiến độ ffmpeg/whisper, đặt tên thư mục an toàn.
 */

import nodePath from "path";

// ─── Models (whisper.cpp ggml) ───────────────────────────────────────────────
// SHA-1 lấy từ models/README.md của whisper.cpp (tag v1.9.5). Tải xong phải khớp mới dùng.

export type ModelId = "small" | "turbo" | "large";

export interface WhisperModel {
  id: ModelId;
  label: string;
  desc: string;
  file: string;
  sizeMB: number;
  sha1: string;
}

export const WHISPER_MODELS: readonly WhisperModel[] = [
  { id: "small", label: "Nhanh",              desc: "Nhẹ, chạy nhanh, độ chính xác vừa phải",
    file: "ggml-small.bin",               sizeMB: 466,  sha1: "55356645c2b361a969dfd0ef2c5a50d530afd8d5" },
  { id: "turbo", label: "Cân bằng (khuyên dùng)", desc: "Nhanh và chính xác tốt cho tiếng Trung",
    file: "ggml-large-v3-turbo-q5_0.bin", sizeMB: 547,  sha1: "e050f7970618a659205450ad97eb95a18d69c9ee" },
  { id: "large", label: "Chính xác nhất",     desc: "Chậm hơn, cần nhiều RAM, chính xác cao nhất",
    file: "ggml-large-v3-q5_0.bin",       sizeMB: 1100, sha1: "e6e2ed78495d403bef4b7cff42ef4aaadcfea8de" },
];

export const MODEL_HOSTS: readonly string[] = ["huggingface.co", "hf.co"];
export const modelUrl = (file: string) =>
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`;

export function getModel(id: unknown): WhisperModel | null {
  return WHISPER_MODELS.find(m => m.id === id) ?? null;
}

// ─── Input validation ────────────────────────────────────────────────────────

const MEDIA_EXTS = new Set([
  "mp4", "mkv", "mov", "avi", "webm", "flv", "ts", "m4v", "wmv", "3gp", "mpg", "mpeg",
  "mp3", "m4a", "wav", "aac", "flac", "ogg", "opus", "wma", "amr",
]);
export const MEDIA_EXT_LIST: string[] = [...MEDIA_EXTS];

export function isMediaFile(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0 || p.length > 1024 || p.includes("\0")) return false;
  const ext = nodePath.extname(p).slice(1).toLowerCase();
  return MEDIA_EXTS.has(ext);
}

/** Tên thư mục đầu ra an toàn trên Windows (bỏ ký tự cấm, tên thiết bị, dấu chấm/khoảng trắng cuối). */
export function safeFolderName(name: string, fallback = "video"): string {
  // eslint-disable-next-line no-control-regex
  let s = name.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/[. ]+$/g, "").slice(0, 80).replace(/[. ]+$/g, "");
  if (!s || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) return fallback;
  return s;
}

// ─── Progress parsing ────────────────────────────────────────────────────────

/** "Duration: 00:01:23.45" (ffmpeg) → giây. */
export function parseFfmpegDuration(text: string): number | null {
  const m = text.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : null;
}

/** Lần xuất hiện CUỐI của "time=00:00:12.34" (ffmpeg) → giây. */
export function parseFfmpegTime(text: string): number | null {
  let last: RegExpExecArray | null = null;
  const re = /time=\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g;
  for (let m; (m = re.exec(text)); ) last = m;
  return last ? (+last[1]) * 3600 + (+last[2]) * 60 + parseFloat(last[3]) : null;
}

/** "progress =  42%" (whisper-cli --print-progress) → 42. */
export function parseWhisperProgress(text: string): number | null {
  let last: number | null = null;
  const re = /progress\s*=\s*(\d{1,3})\s*%/g;
  for (let m; (m = re.exec(text)); ) last = Math.min(100, +m[1]);
  return last;
}

// ─── SRT ─────────────────────────────────────────────────────────────────────

export interface SrtCue { start: string; end: string; text: string; }

const TIME = /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/;

function normTime(t: string): string {
  const [hms, ms = "0"] = t.replace(".", ",").split(",");
  const [h, m, s] = hms.split(":");
  return `${h.padStart(2, "0")}:${m}:${s},${ms.padEnd(3, "0").slice(0, 3)}`;
}

export function parseSrt(text: string): SrtCue[] {
  const cues: SrtCue[] = [];
  const blocks = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").map(l => l.trimEnd());
    const i = lines.findIndex(l => TIME.test(l));
    if (i < 0) continue;
    const m = lines[i].match(TIME)!;
    cues.push({ start: normTime(m[1]), end: normTime(m[2]), text: lines.slice(i + 1).join("\n").trim() });
  }
  return cues;
}

export function formatSrt(cues: SrtCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${c.start} --> ${c.end}\n${c.text}\n`).join("\n");
}

// Whisper hay "ảo giác" các câu này ở đoạn im lặng/nhạc nền (tiếng Trung).
const HALLUCINATIONS: RegExp[] = [
  /amara\.org/i, /字幕志愿者/, /字幕由.{0,12}提供/, /明镜与点点栏目/, /请不吝点赞/,
];
const NOISE_TAG = /^[\s\[\]()（）【】♪♫*_-]*(blank_audio|music|musique|applause|silence|音乐|音樂|掌声|掌聲|笑声|笑聲|\s)*[\s\[\]()（）【】♪♫*_-]*$/i;

const canon = (s: string) => s.replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();

export interface CleanResult { cues: SrtCue[]; dropped: number; }

/**
 * Làm sạch kết quả: bỏ cue rỗng / thẻ nhiễu ([BLANK_AUDIO], 音乐...) / câu ảo giác quen thuộc,
 * và gộp vòng lặp (cùng một câu lặp ≥3 lần liên tiếp → giữ 1).
 */
export function cleanCues(input: SrtCue[]): CleanResult {
  const out: SrtCue[] = [];
  let dropped = 0;
  let loopKey = "";
  let loopCount = 0;

  for (const c of input) {
    const text = c.text.trim();
    const key = canon(text);
    if (!key || NOISE_TAG.test(text) || HALLUCINATIONS.some(r => r.test(text))) { dropped++; continue; }

    if (key === loopKey) loopCount++; else { loopKey = key; loopCount = 1; }
    if (loopCount >= 3) { dropped++; continue; }

    out.push({ ...c, text });
  }
  return { cues: out, dropped };
}

/** Lấy tối đa n dòng chữ đầu để xem trước. */
export function previewLines(cues: SrtCue[], n = 4): string[] {
  return cues.slice(0, n).map(c => `${c.start.slice(0, 8)}  ${c.text.replace(/\s*\n\s*/g, " ")}`);
}
