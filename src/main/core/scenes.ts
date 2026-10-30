// src/main/core/scenes.ts
// Tách cảnh video (cắt cảnh từ stderr ffmpeg/showinfo) và gom đoạn phụ đề theo cảnh / khoảng lặng.
import type { TranscribeSegment } from "../../shared/ipc-types.js";

export interface SceneRange {
  index: number;
  startMs: number;
  endMs: number;
}

const PAUSE_GAP_MS = 1800;
const MIN_CUT_MS = 250;
const MIN_CUT_GAP_MS = 400;

/** pts_time từ showinfo / metadata của ffmpeg → mốc mili-giây. */
export function parseSceneCutMs(stderr: string): number[] {
  const raw: number[] = [];
  for (const m of stderr.matchAll(/pts_time:\s*(-?\d+(?:\.\d+)?)/g)) {
    const sec = Number(m[1]);
    if (!Number.isFinite(sec) || sec < 0) continue;
    raw.push(Math.round(sec * 1000));
  }
  return uniqueCuts(raw);
}

export function uniqueCuts(ms: readonly number[], minGap = MIN_CUT_GAP_MS): number[] {
  const sorted = [...new Set(ms.filter(t => Number.isFinite(t) && t >= MIN_CUT_MS))].sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of sorted) {
    if (out.length === 0 || t - out[out.length - 1] >= minGap) out.push(t);
  }
  return out;
}

/** Cắt cảnh → các khoảng [start, end). durationMs là hết video/lời thoại. */
export function cutsToRanges(cutMs: readonly number[], durationMs: number): SceneRange[] {
  const dur = Math.max(0, Math.round(Number.isFinite(durationMs) ? durationMs : 0));
  const cuts = uniqueCuts(cutMs.filter(t => t < dur));
  const edges = [0, ...cuts, dur];
  const ranges: SceneRange[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const startMs = edges[i];
    const endMs = edges[i + 1];
    if (endMs <= startMs) continue;
    ranges.push({ index: ranges.length, startMs, endMs });
  }
  if (ranges.length === 0) ranges.push({ index: 0, startMs: 0, endMs: dur });
  return ranges;
}

function mid(s: TranscribeSegment): number {
  return s.startMs + Math.max(0, s.endMs - s.startMs) / 2;
}

function rangeIndexAt(t: number, ranges: readonly SceneRange[]): number {
  for (let i = ranges.length - 1; i >= 0; i--) {
    if (t >= ranges[i].startMs) return ranges[i].index;
  }
  return 0;
}

/** Gom đoạn theo khoảng lặng (khi không có / ít cắt cảnh hình). */
export function pauseRanges(segs: readonly TranscribeSegment[], gapMs = PAUSE_GAP_MS): SceneRange[] {
  if (segs.length === 0) return [{ index: 0, startMs: 0, endMs: 0 }];
  const ranges: SceneRange[] = [];
  let start = segs[0].startMs;
  let end = segs[0].endMs;
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i];
    if (s.startMs - end >= gapMs) {
      ranges.push({ index: ranges.length, startMs: start, endMs: end });
      start = s.startMs;
    }
    end = Math.max(end, s.endMs);
  }
  ranges.push({ index: ranges.length, startMs: start, endMs: end });
  return ranges;
}

/**
 * Gắn sceneIndex: ưu tiên cắt cảnh hình; nếu không có cắt nào thì dùng khoảng lặng giữa câu.
 * Giữ nguyên thứ tự đoạn.
 */
export function attachSceneIndex(segs: readonly TranscribeSegment[], cutMs: readonly number[]): TranscribeSegment[] {
  if (segs.length === 0) return [];
  const durationMs = Math.max(segs[segs.length - 1].endMs, ...cutMs, 0);
  const visual = uniqueCuts(cutMs);
  const ranges = visual.length > 0 ? cutsToRanges(visual, durationMs) : pauseRanges(segs);
  return segs.map(s => ({ ...s, sceneIndex: rangeIndexAt(mid(s), ranges) }));
}

export function groupByScene(segs: readonly TranscribeSegment[]): { index: number; startMs: number; endMs: number; segments: TranscribeSegment[] }[] {
  const groups: { index: number; startMs: number; endMs: number; segments: TranscribeSegment[] }[] = [];
  for (const s of segs) {
    const idx = s.sceneIndex ?? 0;
    const last = groups[groups.length - 1];
    if (!last || last.index !== idx) {
      groups.push({ index: idx, startMs: s.startMs, endMs: s.endMs, segments: [s] });
    } else {
      last.segments.push(s);
      last.endMs = Math.max(last.endMs, s.endMs);
    }
  }
  return groups;
}

const MAX_BATCH_CHARS = 1400;
const MAX_BATCH_LINES = 8;

/** Chia nhóm cảnh thành lô vừa gửi dịch (giữ nguyên thứ tự đoạn). */
export function batchesForTranslation(segs: readonly TranscribeSegment[]): TranscribeSegment[][] {
  const groups = groupByScene(segs);
  const batches: TranscribeSegment[][] = [];
  for (const g of groups) {
    let cur: TranscribeSegment[] = [];
    let chars = 0;
    const flush = () => {
      if (cur.length) batches.push(cur);
      cur = [];
      chars = 0;
    };
    for (const s of g.segments) {
      const n = s.text.length;
      const tooBig = cur.length > 0 && (cur.length >= MAX_BATCH_LINES || chars + n > MAX_BATCH_CHARS);
      const pause = cur.length > 0 && s.startMs - cur[cur.length - 1].endMs >= PAUSE_GAP_MS;
      if (tooBig || pause) flush();
      cur.push(s);
      chars += n;
    }
    flush();
  }
  return batches;
}
