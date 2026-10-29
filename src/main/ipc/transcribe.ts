// src/main/ipc/transcribe.ts — IPC cho tính năng Trích xuất văn bản (tiếng Trung → transcript.srt)
import { ipcMain, dialog, BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import { isTrustedSender } from "./guard.js";
import { dialogDirs } from "./download.js";
import { isValidId, validateOutputDir } from "../core/security.js";
import { findFfmpeg } from "../core/downloader.js";
import { downloadModel, isModelInstalled, ModelDownloadHandle } from "../core/model-downloader.js";
import { transcribe, cancelTranscribe, getWhisperPath, TranscribeOutcome } from "../core/transcriber.js";
import { WHISPER_MODELS, getModel, isMediaFile, MEDIA_EXT_LIST } from "../core/transcribe-utils.js";
import { logger } from "../core/logger.js";

export const TR_IPC = {
  INFO: "transcribe:info",
  SELECT_FILE: "transcribe:selectFile",
  START: "transcribe:start",
  CANCEL: "transcribe:cancel",
  PROGRESS: "transcribe:progress",
  MODEL_DOWNLOAD: "transcribe:modelDownload",
  MODEL_CANCEL: "transcribe:modelCancel",
  MODEL_PROGRESS: "transcribe:modelProgress",
} as const;

const modelDownloads = new Map<string, ModelDownloadHandle>();

function info() {
  return {
    whisperFound: !!getWhisperPath(),
    ffmpegFound: !!findFfmpeg(),
    models: WHISPER_MODELS.map(m => ({
      id: m.id, label: m.label, desc: m.desc, sizeMB: m.sizeMB, installed: isModelInstalled(m),
    })),
  };
}

export function registerTranscribeHandlers(win: BrowserWindow) {
  const send = (channel: string, payload: unknown) => { if (!win.isDestroyed()) win.webContents.send(channel, payload); };

  ipcMain.handle(TR_IPC.INFO, (evt) => isTrustedSender(evt, win, TR_IPC.INFO) ? info() : null);

  ipcMain.handle(TR_IPC.SELECT_FILE, async (evt): Promise<string | null> => {
    if (!isTrustedSender(evt, win, TR_IPC.SELECT_FILE)) return null;
    const r = await dialog.showOpenDialog(win, {
      title: "Chọn video hoặc audio",
      properties: ["openFile"],
      filters: [{ name: "Video / Audio", extensions: MEDIA_EXT_LIST }, { name: "Tất cả", extensions: ["*"] }],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  ipcMain.handle(TR_IPC.START, async (evt, raw: unknown): Promise<TranscribeOutcome | null> => {
    if (!isTrustedSender(evt, win, TR_IPC.START)) return null;
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const model = getModel(r.modelId);
    const outputDir = validateOutputDir(r.outputDir, dialogDirs);
    if (!isValidId(r.id) || !model || !outputDir || !isMediaFile(r.inputPath) || !path.isAbsolute(r.inputPath as string)) {
      logger.warn("ipc:transcribe", "Request không hợp lệ bị chặn");
      return { ok: false, message: "Yêu cầu không hợp lệ (file, model hoặc thư mục đầu ra)." };
    }
    return transcribe(
      { id: r.id, inputPath: r.inputPath as string, outputDir, modelId: model.id },
      (p) => send(TR_IPC.PROGRESS, p),
    );
  });

  ipcMain.handle(TR_IPC.CANCEL, (evt, id: unknown) => {
    if (!isTrustedSender(evt, win, TR_IPC.CANCEL) || !isValidId(id)) return;
    cancelTranscribe(id);
  });

  ipcMain.handle(TR_IPC.MODEL_DOWNLOAD, async (evt, modelId: unknown): Promise<{ ok: boolean; message: string } | null> => {
    if (!isTrustedSender(evt, win, TR_IPC.MODEL_DOWNLOAD)) return null;
    const m = getModel(modelId);
    if (!m) return { ok: false, message: "Model không hợp lệ." };
    if (modelDownloads.has(m.id)) return { ok: false, message: "Model này đang được tải." };
    const h = downloadModel(m, (percent, receivedMB, totalMB) =>
      send(TR_IPC.MODEL_PROGRESS, { id: m.id, percent, receivedMB, totalMB }));
    modelDownloads.set(m.id, h);
    try {
      await h.promise;
      return { ok: true, message: "Đã tải xong model." };
    } catch (e: any) {
      logger.warn("ipc:transcribe", "Tải model thất bại", { message: e?.message });
      return { ok: false, message: e?.message === "Đã huỷ" ? "Đã huỷ tải model." : "Tải model thất bại: " + (e?.message ?? e) };
    } finally {
      modelDownloads.delete(m.id);
    }
  });

  ipcMain.handle(TR_IPC.MODEL_CANCEL, (evt, modelId: unknown) => {
    if (!isTrustedSender(evt, win, TR_IPC.MODEL_CANCEL)) return;
    const m = getModel(modelId);
    if (m) modelDownloads.get(m.id)?.cancel();
  });
}

export function cancelAllTranscribeWork() {
  for (const h of modelDownloads.values()) h.cancel();
}

// (fs import giữ lại cho các mở rộng sau)
void fs;
