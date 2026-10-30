// src/main/core/transcriber.ts
// Trích xuất văn bản từ file âm thanh/video: ffmpeg → WAV 16 kHz mono → whisper-cli (tiếng Trung) → SRT → các đoạn.
// Không import electron/logger: mọi phụ thuộc (đường dẫn, cài đặt công cụ, ffmpeg) được truyền qua `deps` để test được.
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { spawn as nodeSpawn, ChildProcess, SpawnOptions } from "child_process";
import type { TranscribeDone, TranscribeError, TranscribeProgress, TranscribeSegment, WhisperModelId } from "../../shared/ipc-types.js";
import { UserFacingError } from "./douyin.js";
import { parseSrt, cleanSegments, parseWhisperProgress, parseFfmpegSeconds } from "./srt.js";
import { buildWhisperArgs, explainWhisperExit } from "./whisper.js";
import { isValidId } from "./security.js";

export interface TranscribeEvents {
  progress: (p: TranscribeProgress) => void;
  done:     (d: TranscribeDone) => void;
  error:    (e: TranscribeError) => void;
}
export interface Transcription extends EventEmitter {
  on<K extends keyof TranscribeEvents>(event: K, listener: TranscribeEvents[K]): this;
  emit<K extends keyof TranscribeEvents>(event: K, ...args: Parameters<TranscribeEvents[K]>): boolean;
}

export type SpawnFn = (cmd: string, args: readonly string[], opts: SpawnOptions) => ChildProcess;

export interface TranscribeDeps {
  /** Thư mục gốc (cwd của whisper-cli); chứa models/ và jobs/. */
  baseDir: string;
  ensureTools(onProgress: (percent: number, message: string) => void, signal: AbortSignal): Promise<string>;
  /** Đảm bảo mô hình đã có tại <baseDir>/models/<file>; trả về đường dẫn tương đối (dấu /) so với baseDir. */
  ensureModel(model: WhisperModelId, onProgress: (percent: number, message: string) => void, signal: AbortSignal): Promise<string>;
  ffmpeg(): string | null;
  threads: number;
  spawn?: SpawnFn;
  env?: NodeJS.ProcessEnv;
  log?(message: string, extra?: unknown): void;
}

export interface TranscribeJob { id: string; inputPath: string; model: WhisperModelId; }

const tail = (s: string, n = 2000) => (s.length > n ? s.slice(-n) : s);

export function startTranscription(job: TranscribeJob, deps: TranscribeDeps): { emitter: Transcription; cancel: () => void } {
  const emitter = new EventEmitter() as Transcription;
  const ac = new AbortController();
  const doSpawn: SpawnFn = deps.spawn ?? ((c, a, o) => nodeSpawn(c, a as string[], o));
  let cancelled = false;
  let child: ChildProcess | null = null;
  let stopPendingRef: () => void = () => {};

  const cancel = () => {
    cancelled = true;
    stopPendingRef();
    ac.abort();
    try { child?.kill(); } catch { /* ignore */ }
  };

  // Giới hạn tần suất: tối đa ~5 lần/giây, chỉ khi % hoặc nội dung đổi; đổi giai đoạn thì luôn phát ngay.
  // Giá trị bị bỏ qua vì phát quá dày được giữ lại và phát sau khoảng nghỉ (để thanh tiến trình không đứng ở số cũ).
  const MIN_GAP_MS = 200;
  let lastKey = "", lastAt = 0, lastStage = "";
  let pending: TranscribeProgress | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  const stopPending = () => {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = null; pending = null;
  };
  stopPendingRef = stopPending;
  const emitNow = (p: TranscribeProgress) => {
    lastKey = `${p.stage}|${Math.floor(p.percent)}|${p.message}`; lastAt = Date.now(); lastStage = p.stage;
    emitter.emit("progress", p);
  };
  const progress = (stage: TranscribeProgress["stage"], percent: number, message: string, force = false) => {
    const p: TranscribeProgress = { id: job.id, stage, percent: Math.max(0, Math.min(100, Math.round(percent * 10) / 10)), message };
    const key = `${stage}|${Math.floor(p.percent)}|${message}`;
    const gap = Date.now() - lastAt;
    if (force || stage !== lastStage) { stopPending(); emitNow(p); return; }
    if (key === lastKey) return;
    if (gap >= MIN_GAP_MS) { stopPending(); emitNow(p); return; }
    pending = p;
    if (!pendingTimer) {
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        const q = pending; pending = null;
        if (q && !cancelled) emitNow(q);
      }, MIN_GAP_MS - gap);
    }
  };

  void (async () => {
    const jobRel = `jobs/${job.id}`;
    const jobDir = path.join(deps.baseDir, "jobs", job.id);
    try {
      await new Promise<void>(r => setImmediate(r));          // để nơi gọi kịp gắn listener
      if (cancelled) return;
      if (!isValidId(job.id)) throw new UserFacingError("Yêu cầu không hợp lệ.");

      // 1) công cụ + mô hình (tải ở lần đầu)
      const exe = await deps.ensureTools((p, m) => progress("tools", p, m), ac.signal);
      if (cancelled) return;
      const modelRel = await deps.ensureModel(job.model, (p, m) => progress("model", p, m), ac.signal);
      if (cancelled) return;

      // 2) ffmpeg: bất kỳ audio/video → WAV 16 kHz mono
      const ffmpeg = deps.ffmpeg();
      if (!ffmpeg) throw new UserFacingError("Không tìm thấy ffmpeg.exe để đọc âm thanh từ file.");
      fs.rmSync(jobDir, { recursive: true, force: true });
      fs.mkdirSync(jobDir, { recursive: true });
      const wavAbs = path.join(jobDir, "audio.wav");

      progress("audio", 0, "Đang trích âm thanh từ file...", true);
      await new Promise<void>((resolve, reject) => {
        const c = doSpawn(ffmpeg, ["-y", "-hide_banner", "-nostdin", "-stats_period", "1", "-i", job.inputPath,
          "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavAbs], { windowsHide: true, env: deps.env });
        child = c;
        let err = "", total: number | null = null;
        c.stderr?.setEncoding("utf8");
        c.stderr?.on("data", (d: string) => {
          err = tail(err + d);
          total = total ?? parseFfmpegSeconds(d, "Duration:");
          const t = parseFfmpegSeconds(d, "time=");
          if (t !== null && total) progress("audio", (t / total) * 100, "Đang trích âm thanh từ file...");
        });
        c.on("error", (e) => reject(new UserFacingError(`Không chạy được ffmpeg: ${e.message}`)));
        c.on("close", (code) => {
          child = null;
          if (cancelled) return resolve();
          if (code === 0) return resolve();
          if (/does not contain any stream|matches no streams|no audio/i.test(err)) return reject(new UserFacingError("File này không có âm thanh để nhận diện."));
          if (/invalid data found|no such file|permission denied|moov atom not found/i.test(err)) return reject(new UserFacingError("Không đọc được file (định dạng không hỗ trợ, file hỏng hoặc không có quyền truy cập)."));
          reject(new UserFacingError(`ffmpeg lỗi (mã ${code}): ${err.trim().split(/\r?\n/).pop() ?? ""}`));
        });
      });
      if (cancelled) return;

      // 3) whisper-cli (cwd = baseDir, chỉ truyền đường dẫn tương đối do app đặt)
      progress("recognize", 0, "Đang nhận diện giọng nói...", true);
      const args = buildWhisperArgs({ modelRel, wavRel: `${jobRel}/audio.wav`, outBaseRel: `${jobRel}/transcript`, threads: deps.threads });
      deps.log?.("Chạy whisper-cli", { model: job.model, threads: deps.threads });

      await new Promise<void>((resolve, reject) => {
        const c = doSpawn(exe, args, { cwd: deps.baseDir, windowsHide: true, env: deps.env });
        child = c;
        let err = "";
        c.stdout?.on("data", () => { /* chỉ cần tiêu thụ để pipe không đầy */ });
        c.stderr?.setEncoding("utf8");
        c.stderr?.on("data", (d: string) => {
          err = tail(err + d);
          const p = parseWhisperProgress(d);
          if (p !== null) progress("recognize", p, "Đang nhận diện giọng nói...");
        });
        c.on("error", (e) => reject(new UserFacingError(
          (e as NodeJS.ErrnoException).code === "ENOENT"
            ? "Không tìm thấy công cụ nhận diện (whisper-cli). Hãy thử lại để app tải lại."
            : `Không chạy được công cụ nhận diện: ${e.message}`)));
        c.on("close", (code) => {
          child = null;
          if (cancelled) return resolve();
          if (code === 0) return resolve();
          reject(new UserFacingError(explainWhisperExit(code, err)));
        });
      });
      if (cancelled) return;

      // 4) đọc SRT do whisper ghi
      const srtPath = path.join(jobDir, "transcript.srt");
      if (!fs.existsSync(srtPath)) throw new UserFacingError("Công cụ nhận diện không tạo ra file kết quả.");
      const segments: TranscribeSegment[] = cleanSegments(parseSrt(fs.readFileSync(srtPath, "utf8")));
      if (segments.length === 0) {
        throw new UserFacingError("Không nhận diện được lời nói nào trong file (có thể chỉ có nhạc/tiếng ồn, âm lượng quá nhỏ hoặc không phải tiếng Trung).");
      }
      progress("recognize", 100, "Hoàn tất", true);
      stopPending();
      emitter.emit("done", { id: job.id, segments });
    } catch (err) {
      stopPending();
      if (cancelled) return;
      const e = err as Error;
      deps.log?.("Trích xuất văn bản thất bại", { err: e.message });
      emitter.emit("error", {
        id: job.id,
        message: e instanceof UserFacingError ? e.message : `Không trích xuất được văn bản: ${e.message}`,
      });
    } finally {
      try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  })();

  return { emitter, cancel };
}
