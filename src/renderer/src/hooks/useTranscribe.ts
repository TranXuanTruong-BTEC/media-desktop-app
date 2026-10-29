import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscribeInfo, TranscribeResult, ModelId, ModelProgress } from "../electron.d";

const MODEL_KEY = "mediaget.whisperModel";

export type Job =
  | { status: "idle" }
  | { status: "running"; id: string; stage: "extract" | "transcribe" | "finalize"; percent: number; text?: string }
  | { status: "done"; result: TranscribeResult }
  | { status: "error"; message: string };

export interface PickedFile { path: string; name: string; }

function uid() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

function loadModel(): ModelId {
  try { const v = localStorage.getItem(MODEL_KEY); if (v === "small" || v === "turbo" || v === "large") return v; } catch { /* ignore */ }
  return "turbo";
}

export function useTranscribe() {
  const [info, setInfo]       = useState<TranscribeInfo | null>(null);
  const [file, setFile]       = useState<PickedFile | null>(null);
  const [modelId, setModelId] = useState<ModelId>(loadModel);
  const [dl, setDl]           = useState<ModelProgress | null>(null);
  const [dlMsg, setDlMsg]     = useState<{ ok: boolean; text: string } | null>(null);
  const [job, setJob]         = useState<Job>({ status: "idle" });
  const jobId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try { setInfo(await window.api.transcribeInfo()); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void refresh();
    const offJob = window.api.onTranscribeProgress((p) => {
      if (p.id !== jobId.current) return;
      setJob(prev => prev.status === "running"
        ? { ...prev, stage: p.stage, percent: p.percent >= 0 && p.percent > 0 ? p.percent : prev.percent, text: p.text ?? prev.text }
        : prev);
    });
    const offModel = window.api.onModelProgress((p) => setDl(p));
    return () => { offJob(); offModel(); };
  }, [refresh]);

  const selectModel = useCallback((id: ModelId) => {
    setModelId(id);
    try { localStorage.setItem(MODEL_KEY, id); } catch { /* ignore */ }
  }, []);

  const pickFile = useCallback(async () => {
    const p = await window.api.transcribeSelectFile();
    if (p) { setFile({ path: p, name: baseName(p) }); setJob({ status: "idle" }); }
  }, []);

  const dropFile = useCallback((f: File) => {
    const p = window.api.getPathForFile(f);
    if (!p) { setJob({ status: "error", message: "Không lấy được đường dẫn file đã thả vào." }); return; }
    setFile({ path: p, name: baseName(p) });
    setJob({ status: "idle" });
  }, []);

  const downloadModel = useCallback(async (id: ModelId) => {
    setDlMsg(null);
    setDl({ id, percent: 0, receivedMB: 0, totalMB: 0 });
    try {
      const r = await window.api.downloadWhisperModel(id);
      if (r) setDlMsg({ ok: r.ok, text: r.message });
    } finally {
      setDl(null);
      void refresh();
    }
  }, [refresh]);

  const cancelModelDownload = useCallback((id: ModelId) => { void window.api.cancelModelDownload(id); }, []);

  const start = useCallback(async (outputDir: string) => {
    if (!file) return;
    const id = uid();
    jobId.current = id;
    setJob({ status: "running", id, stage: "extract", percent: 0 });
    try {
      const r = await window.api.transcribeStart({ id, inputPath: file.path, outputDir, modelId });
      if (jobId.current !== id) return;
      if (!r) setJob({ status: "error", message: "Yêu cầu bị từ chối." });
      else if (r.ok) setJob({ status: "done", result: r.result });
      else setJob(r.cancelled ? { status: "idle" } : { status: "error", message: r.message });
    } catch (e: any) {
      setJob({ status: "error", message: e?.message ?? String(e) });
    }
  }, [file, modelId]);

  const cancel = useCallback(() => {
    if (jobId.current) void window.api.transcribeCancel(jobId.current);
  }, []);

  return { info, file, modelId, dl, dlMsg, job, selectModel, pickFile, dropFile, downloadModel, cancelModelDownload, start, cancel, refresh };
}
export type TranscribeApi = ReturnType<typeof useTranscribe>;
