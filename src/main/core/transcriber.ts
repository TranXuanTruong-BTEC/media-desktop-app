/**
 * src/main/core/transcriber.ts
 * Trích xuất văn bản giọng nói tiếng Trung từ video/audio → <thư mục đầu ra>/<tên file>/transcript.srt
 *
 *   ffmpeg (16kHz mono WAV)  →  whisper-cli (whisper.cpp, -l zh -osrt)  →  làm sạch SRT  →  transcript.srt
 *
 * Lưu ý Windows: whisper-cli đọc đường dẫn/đối số theo code page hệ thống, nên mọi file làm việc
 * (model, wav, args, srt) được đặt trong thư mục models và truyền bằng TÊN TƯƠNG ĐỐI (chỉ ASCII)
 * với cwd = thư mục đó. Đường dẫn Unicode của người dùng chỉ đi qua Node/ffmpeg (an toàn).
 * Prompt tiếng Trung được đưa qua file "@args" (UTF-8) thay vì dòng lệnh.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import { StringDecoder } from "string_decoder";
import { app } from "electron";
import { getBundledToolsDir, getUserToolsDir, findFfmpeg, killTree } from "./downloader.js";
import { getModelsDir, modelPath, isModelInstalled } from "./model-downloader.js";
import { appendCapped } from "./security.js";
import { logger } from "./logger.js";
import {
  getModel, safeFolderName, parseFfmpegDuration, parseFfmpegTime, parseWhisperProgress,
  parseSrt, cleanCues, formatSrt, previewLines, ModelId,
} from "./transcribe-utils.js";

export interface TranscribeRequest { id: string; inputPath: string; outputDir: string; modelId: ModelId; }
export interface TranscribeProgress { id: string; stage: "extract" | "transcribe" | "finalize"; percent: number; text?: string; }
export interface TranscribeResult {
  id: string; srtPath: string; folder: string; segments: number; dropped: number; preview: string[];
}
export type TranscribeOutcome =
  | { ok: true; result: TranscribeResult }
  | { ok: false; cancelled?: boolean; message: string };

const PROMPT_ZH = "以下是普通话的句子。";      // gợi ý Whisper xuất chữ giản thể + có dấu câu
const EXE = process.platform === "win32" ? ".exe" : "";

export function getWhisperPath(): string | null {
  for (const dir of [getUserToolsDir(), getBundledToolsDir()]) {
    const p = path.join(dir, `whisper-cli${EXE}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Chỉ chạy MỘT lượt tại một thời điểm (rất nặng CPU/RAM)
let active: { id: string; cancel: () => void } | null = null;
export const isTranscribing = () => active !== null;
export function cancelTranscribe(id: string): void { if (active && active.id === id) active.cancel(); }

function tailError(buf: string): string {
  const lines = buf.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines.reverse().find(l => /error|failed|invalid|cannot|unable|not found/i.test(l)) ?? lines[0] ?? "";
}

export async function transcribe(
  req: TranscribeRequest,
  onProgress: (p: TranscribeProgress) => void,
): Promise<TranscribeOutcome> {
  if (active) return { ok: false, message: "Đang có một lượt trích xuất khác. Hãy đợi nó xong." };

  const model = getModel(req.modelId);
  if (!model) return { ok: false, message: "Model không hợp lệ." };
  const whisper = getWhisperPath();
  if (!whisper) return { ok: false, message: `Thiếu thành phần nhận diện giọng nói (whisper-cli${EXE}). Hãy cài lại bản MediaGet mới nhất.` };
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return { ok: false, message: "Không tìm thấy ffmpeg." };
  if (!isModelInstalled(model)) return { ok: false, message: `Chưa tải model "${model.label}". Hãy bấm "Tải model" trước.` };
  try { if (!fs.statSync(req.inputPath).isFile()) throw new Error(); }
  catch { return { ok: false, message: "Không đọc được file đầu vào (đã bị xoá hoặc di chuyển?)." }; }

  const workDir  = getModelsDir();
  const base     = `job-${req.id}`;                    // id đã được kiểm tra regex ở lớp IPC → chỉ ASCII
  const wavFile  = `${base}.wav`;
  const argsFile = `${base}.args`;
  const srtFile  = `${base}.srt`;
  const cleanup  = () => { for (const f of [wavFile, argsFile, srtFile]) { try { fs.rmSync(path.join(workDir, f), { force: true }); } catch { /* ignore */ } } };

  let cancelled = false;
  let proc: ChildProcess | null = null;
  active = { id: req.id, cancel: () => { cancelled = true; if (proc) killTree(proc); } };

  const emit = (stage: TranscribeProgress["stage"], percent: number, text?: string) =>
    onProgress({ id: req.id, stage, percent: Math.max(0, Math.min(100, Math.round(percent))), text });

  try {
    fs.mkdirSync(workDir, { recursive: true });
    cleanup();

    // ── 1) ffmpeg: tách âm thanh 16kHz mono ────────────────────────────────
    emit("extract", 0);
    let duration: number | null = null;
    const ff = await run(ffmpeg, [
      "-y", "-hide_banner", "-nostdin", "-protocol_whitelist", "file,pipe",
      "-i", req.inputPath, "-vn", "-map", "0:a:0?", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
      path.join(workDir, wavFile),
    ], undefined, (chunk, all) => {
      duration ??= parseFfmpegDuration(all);
      const t = parseFfmpegTime(chunk);
      if (duration && t !== null) emit("extract", Math.min(100, (t / duration) * 100) * 0.1);
    });
    if (cancelled) return { ok: false, cancelled: true, message: "Đã huỷ." };
    if (ff.code !== 0 || !fs.existsSync(path.join(workDir, wavFile)) || fs.statSync(path.join(workDir, wavFile)).size < 1000) {
      const noAudio = /does not contain any stream|Stream map .* matches no streams/i.test(ff.stderr);
      return { ok: false, message: noAudio ? "File này không có âm thanh để nhận diện." : "ffmpeg không đọc được file: " + tailError(ff.stderr) };
    }

    // ── 2) whisper-cli ─────────────────────────────────────────────────────
    const threads = Math.max(2, Math.min(8, os.cpus().length - 1));
    const common = ["-m", model.file, "-f", wavFile, "-of", base, "-osrt", "-l", "zh", "-pp", "-sns", "-t", String(threads)];
    emit("transcribe", 10);

    const runWhisper = (withPrompt: boolean) => {
      let args: string[];
      if (withPrompt) {
        fs.writeFileSync(path.join(workDir, argsFile), [...common, "--prompt", PROMPT_ZH].join("\n") + "\n", "utf8");
        args = [`@${argsFile}`];
      } else {
        args = common;
      }
      const dec = new StringDecoder("utf8");
      return run(whisper, args, workDir, (chunk, _all, isErr) => {
        if (isErr) {
          const p = parseWhisperProgress(chunk);
          if (p !== null) emit("transcribe", 10 + p * 0.88);
        } else {
          const text = dec.write(Buffer.from(chunk, "latin1"));
          const m = [...text.matchAll(/\]\s+(.+)$/gm)].pop();
          if (m) emit("transcribe", -1, m[1].trim());
        }
      }, true);
    };

    let w = await runWhisper(true);
    if (!cancelled && w.code !== 0 && /unknown argument|response file/i.test(w.stderr)) {
      logger.warn("transcriber", "whisper-cli không hỗ trợ @args — thử lại không có prompt");
      w = await runWhisper(false);
    }
    if (cancelled) return { ok: false, cancelled: true, message: "Đã huỷ." };
    if (w.code !== 0) {
      logger.error("transcriber", "whisper-cli lỗi", { code: w.code, err: w.stderr.slice(-500) });
      const oom = /out of memory|bad_alloc|failed to allocate/i.test(w.stderr);
      return { ok: false, message: oom ? "Không đủ RAM cho model này. Hãy chọn model \"Nhanh\"." : "Nhận diện thất bại: " + (tailError(w.stderr) || `mã lỗi ${w.code}`) };
    }

    // ── 3) Làm sạch & ghi transcript.srt ───────────────────────────────────
    emit("finalize", 99);
    const rawPath = path.join(workDir, srtFile);
    if (!fs.existsSync(rawPath)) return { ok: false, message: "whisper-cli không tạo ra file SRT." };
    const { cues, dropped } = cleanCues(parseSrt(fs.readFileSync(rawPath, "utf8")));
    if (cues.length === 0) return { ok: false, message: "Không nhận diện được lời nói nào trong file (im lặng, chỉ có nhạc, hoặc không phải tiếng Trung)." };

    const folder = path.join(req.outputDir, safeFolderName(path.basename(req.inputPath, path.extname(req.inputPath))));
    fs.mkdirSync(folder, { recursive: true });
    const srtPath = path.join(folder, "transcript.srt");
    const tmp = `${srtPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, formatSrt(cues), "utf8");
    fs.renameSync(tmp, srtPath);

    emit("finalize", 100);
    return { ok: true, result: { id: req.id, srtPath, folder, segments: cues.length, dropped, preview: previewLines(cues) } };
  } catch (e: any) {
    if (cancelled) return { ok: false, cancelled: true, message: "Đã huỷ." };
    logger.error("transcriber", "Lỗi không mong muốn", e);
    return { ok: false, message: e?.code === "ENOSPC" ? "Ổ đĩa đã đầy." : (e?.message ?? String(e)) };
  } finally {
    cleanup();
    active = null;
  }

  // ── helper: chạy tiến trình, gom stdout/stderr (có giới hạn) ───────────────
  function run(
    exe: string, args: string[], cwd: string | undefined,
    onChunk: (chunk: string, all: string, isErr: boolean) => void,
    stdoutToo = false,
  ): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve) => {
      const p = spawn(exe, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      proc = p;
      let err = "";
      p.stderr!.on("data", (b: Buffer) => { const s = b.toString("utf8"); err = appendCapped(err, s, 64 * 1024); onChunk(s, err, true); });
      p.stdout!.on("data", (b: Buffer) => { if (stdoutToo) onChunk(b.toString("latin1"), "", false); });
      p.on("error", (e) => { err += String(e); resolve({ code: -1, stderr: err }); });
      p.on("close", (code) => { proc = null; resolve({ code, stderr: err }); });
    });
  }
}
