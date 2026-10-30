// src/main/core/srt.ts
// Đọc / ghi SRT và phân tích tiến trình của whisper-cli. Thuần logic, không phụ thuộc electron.
import type { TranscribeSegment } from "../../shared/ipc-types.js";

export type Segment = TranscribeSegment;

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/** 83450 → "00:01:23,450" */
export function formatTimestamp(ms: number): string {
  const t = Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(t % 1000, 3)}`;
}

const TS = String.raw`(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})`;
const TS_LINE_RE = new RegExp(String.raw`^\s*${TS}\s*-->\s*${TS}`);

function toMs(h: string, m: string, s: string, frac: string): number {
  return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(frac.padEnd(3, "0"));
}

/** Đọc SRT (CRLF/LF, nhiều dòng, đoạn trống). Dòng chỉ gồm số chỉ coi là số thứ tự khi dòng kế là mốc thời gian. */
export function parseSrt(text: string): Segment[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const segs: Segment[] = [];
  let cur: { startMs: number; endMs: number; text: string[] } | null = null;
  const flush = () => { if (cur) segs.push({ startMs: cur.startMs, endMs: cur.endMs, text: cur.text.join("\n").trim() }); cur = null; };

  for (let i = 0; i < lines.length; i++) {
    const m = TS_LINE_RE.exec(lines[i]);
    if (m) {
      flush();
      cur = { startMs: toMs(m[1], m[2], m[3], m[4]), endMs: toMs(m[5], m[6], m[7], m[8]), text: [] };
      continue;
    }
    if (!cur) continue;
    if (/^\s*\d+\s*$/.test(lines[i]) && i + 1 < lines.length && TS_LINE_RE.test(lines[i + 1])) continue;   // số thứ tự
    cur.text.push(lines[i].trim());
  }
  flush();
  return segs;
}

const ONLY_PUNCT_RE = /^[\s\p{P}\p{S}]*$/u;

/** Bỏ đoạn rỗng / chỉ có dấu câu, gọn khoảng trắng, đảm bảo mốc kết thúc không nhỏ hơn mốc bắt đầu. */
export function cleanSegments(segs: readonly Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    const text = s.text.replace(/[ \t\u3000]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
    if (!text || ONLY_PUNCT_RE.test(text)) continue;
    const startMs = Math.max(0, Math.round(s.startMs));
    out.push({ startMs, endMs: Math.max(startMs, Math.round(s.endMs)), text });
  }
  return out;
}

/** Ghi SRT chuẩn (đánh số lại từ 1, dòng trống giữa các đoạn). */
export function formatSrt(segs: readonly Segment[]): string {
  return segs.map((s, i) => `${i + 1}\n${formatTimestamp(s.startMs)} --> ${formatTimestamp(s.endMs)}\n${s.text}\n`).join("\n");
}

/** Văn bản thuần (mỗi đoạn một dòng) để sao chép. */
export function toPlainText(segs: readonly Segment[]): string {
  return segs.map(s => s.text.replace(/\n/g, " ")).join("\n");
}

/** Lấy % tiến trình mới nhất từ stderr của whisper-cli ("progress =  42%"); null nếu không có. */
export function parseWhisperProgress(chunk: string): number | null {
  let last: number | null = null;
  for (const m of chunk.matchAll(/progress\s*=\s*(\d{1,3})\s*%/g)) last = Math.min(100, Number(m[1]));
  return last;
}

/** "Duration: 00:01:23.45" / "time=00:00:10.50" của ffmpeg → giây. */
export function parseFfmpegSeconds(chunk: string, key: "Duration:" | "time="): number | null {
  const re = new RegExp(`${key.replace("=", "\\=")}\\s*(\\d+):(\\d{2}):(\\d{2}(?:\\.\\d+)?)`, "g");
  let last: number | null = null;
  for (const m of chunk.matchAll(re)) last = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return last;
}
