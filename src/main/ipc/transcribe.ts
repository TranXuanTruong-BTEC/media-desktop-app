// src/main/ipc/transcribe.ts
// IPC cho tính năng "Trích xuất văn bản". Renderer KHÔNG được gửi đường dẫn tuỳ ý: file nguồn chỉ nhận qua hộp thoại
// do main mở (trả về token), kết quả được giữ ở main nên lưu/sao chép không cần renderer gửi lại nội dung.
import { ipcMain, BrowserWindow, dialog, clipboard, app } from "electron";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  IPC, TranscribeRequest, TranscribeStatus, TranscribePickResult, TranscribeActionResult, TranscribeSegment,
} from "../../shared/ipc-types.js";
import { startTranscription } from "../core/transcriber.js";
import { findFfmpeg } from "../core/downloader.js";
import { ensureWhisperTool, ensureModel, isToolInstalled, isModelInstalled, modelRelPath } from "../core/whisper-install.js";
import { MODEL_IDS, WHISPER_MODELS, isWhisperModelId, pickThreads } from "../core/whisper.js";
import { formatSrt, toPlainText } from "../core/srt.js";
import { isValidId } from "../core/security.js";
import { logger } from "../core/logger.js";
import { isTrustedSender } from "./guard.js";

const MAX_TOKENS = 20;
const MAX_RESULTS = 3;

const pickedFiles = new Map<string, { path: string; name: string }>();
const results = new Map<string, { segments: TranscribeSegment[]; inputPath: string }>();
let active: { id: string; cancel: () => void } | null = null;

const baseDir = () => path.join(app.getPath("userData"), "whisper");

/** Huỷ tác vụ đang chạy (gọi khi thoát app để không bỏ lại tiến trình whisper-cli/ffmpeg). */
export function cancelActiveTranscription(): void {
  try { active?.cancel(); } catch { /* ignore */ }
  active = null;
}

function remember<K, V>(map: Map<K, V>, key: K, value: V, max: number) {
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value as K);
}

const MEDIA_FILTERS = [
  { name: "Âm thanh / Video", extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma", "mp4", "mkv", "mov", "avi", "webm", "flv", "ts", "m4v", "3gp"] },
  { name: "Tất cả file", extensions: ["*"] },
];

export function registerTranscribeHandlers(win: BrowserWindow) {
  // Dọn thư mục tạm còn sót lại nếu lần trước app bị tắt đột ngột
  try { fs.rmSync(path.join(baseDir(), "jobs"), { recursive: true, force: true }); } catch { /* ignore */ }

  const send = (channel: string, payload: unknown) => { if (!win.isDestroyed()) win.webContents.send(channel, payload); };
  const setTaskbar = (v: number) => { if (!win.isDestroyed()) win.setProgressBar(v); };

  ipcMain.handle(IPC.TRANSCRIBE_PICK, async (evt): Promise<TranscribePickResult> => {
    if (!isTrustedSender(evt, win, IPC.TRANSCRIBE_PICK)) return { ok: false, error: "Yêu cầu bị từ chối." };
    const r = await dialog.showOpenDialog(win, { title: "Chọn file âm thanh hoặc video", properties: ["openFile"], filters: MEDIA_FILTERS });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    try {
      const p = r.filePaths[0];
      const st = fs.statSync(p);
      if (!st.isFile()) return { ok: false, error: "Đường dẫn đã chọn không phải là file." };
      const token = crypto.randomBytes(8).toString("hex");
      remember(pickedFiles, token, { path: p, name: path.basename(p) }, MAX_TOKENS);
      return { ok: true, file: { token, name: path.basename(p), sizeBytes: st.size } };
    } catch {
      return { ok: false, error: "Không đọc được file đã chọn." };
    }
  });

  ipcMain.handle(IPC.TRANSCRIBE_STATUS, (evt): TranscribeStatus | null => {
    if (!isTrustedSender(evt, win, IPC.TRANSCRIBE_STATUS)) return null;
    return {
      toolsInstalled: isToolInstalled(baseDir()),
      busy: active !== null,
      models: MODEL_IDS.map(id => ({
        id, label: WHISPER_MODELS[id].label, desc: WHISPER_MODELS[id].desc, sizeMb: WHISPER_MODELS[id].sizeMb,
        installed: isModelInstalled(baseDir(), id),
      })),
    };
  });

  ipcMain.handle(IPC.TRANSCRIBE_START, (evt, req: unknown): TranscribeActionResult => {
    if (!isTrustedSender(evt, win, IPC.TRANSCRIBE_START)) return { ok: false, error: "Yêu cầu bị từ chối." };
    const r = (req && typeof req === "object" ? req : {}) as Partial<TranscribeRequest>;
    if (!isValidId(r.id) || !isWhisperModelId(r.model) || typeof r.fileToken !== "string") return { ok: false, error: "Yêu cầu không hợp lệ." };
    const file = pickedFiles.get(r.fileToken);
    if (!file) return { ok: false, error: "Hãy chọn lại file (phiên chọn file đã hết hạn)." };
    if (active) return { ok: false, error: "Đang có một tác vụ trích xuất khác đang chạy." };
    try { if (!fs.statSync(file.path).isFile()) throw new Error("not a file"); }
    catch { return { ok: false, error: "File nguồn không còn tồn tại." }; }

    const id = r.id;
    const model = r.model;
    logger.info("ipc:transcribe", "Bắt đầu trích xuất văn bản", { model });

    const installOpts = (signal: AbortSignal, onProgress: (p: number, m: string) => void) => ({ signal, onProgress });
    const job = startTranscription({ id, inputPath: file.path, model }, {
      baseDir: baseDir(),
      threads: pickThreads(os.cpus().length),
      ffmpeg: findFfmpeg,
      ensureTools: (onProgress, signal) => ensureWhisperTool(baseDir(), installOpts(signal, onProgress)),
      ensureModel: async (m, onProgress, signal) => {
        await ensureModel(baseDir(), m, installOpts(signal, onProgress));
        return modelRelPath(m);
      },
      log: (message, extra) => logger.info("transcribe", message, extra),
    });
    active = { id, cancel: job.cancel };

    const end = () => { if (active?.id === id) active = null; setTaskbar(-1); };
    job.emitter.on("progress", (p) => { setTaskbar(p.percent / 100); send(IPC.TRANSCRIBE_PROGRESS, p); });
    job.emitter.on("done", (d) => {
      remember(results, id, { segments: d.segments, inputPath: file.path }, MAX_RESULTS);
      end();
      send(IPC.TRANSCRIBE_DONE, d);
    });
    job.emitter.on("error", (e) => { end(); send(IPC.TRANSCRIBE_ERROR, e); });
    return { ok: true };
  });

  ipcMain.on(IPC.TRANSCRIBE_CANCEL, (evt, id: unknown) => {
    if (!isTrustedSender(evt, win, IPC.TRANSCRIBE_CANCEL)) return;
    if (isValidId(id) && active?.id === id) { active.cancel(); active = null; setTaskbar(-1); }
  });

  ipcMain.handle(IPC.TRANSCRIBE_SAVE, async (evt, id: unknown): Promise<TranscribeActionResult> => {
    if (!isTrustedSender(evt, win, IPC.TRANSCRIBE_SAVE)) return { ok: false, error: "Yêu cầu bị từ chối." };
    const res = isValidId(id) ? results.get(id) : undefined;
    if (!res) return { ok: false, error: "Không còn kết quả để lưu. Hãy trích xuất lại." };
    const r = await dialog.showSaveDialog(win, {
      title: "Lưu file phụ đề",
      defaultPath: path.join(path.dirname(res.inputPath), "transcript.srt"),
      filters: [{ name: "Phụ đề SRT", extensions: ["srt"] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(r.filePath, formatSrt(res.segments), "utf8");
      return { ok: true, path: r.filePath };
    } catch (err) {
      logger.error("ipc:transcribe", "Không ghi được file SRT", err);
      return { ok: false, error: "Không ghi được file. Hãy chọn thư mục khác." };
    }
  });

  ipcMain.handle(IPC.TRANSCRIBE_COPY, (evt, id: unknown): TranscribeActionResult => {
    if (!isTrustedSender(evt, win, IPC.TRANSCRIBE_COPY)) return { ok: false, error: "Yêu cầu bị từ chối." };
    const res = isValidId(id) ? results.get(id) : undefined;
    if (!res) return { ok: false, error: "Không còn kết quả để sao chép." };
    clipboard.writeText(toPlainText(res.segments));
    return { ok: true };
  });
}
