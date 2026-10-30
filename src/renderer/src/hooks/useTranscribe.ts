// src/renderer/src/hooks/useTranscribe.ts
// Trạng thái của tính năng "Trích xuất văn bản". Đặt ở App để vẫn giữ nguyên khi người dùng chuyển sang tab khác.
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PickedFile, TranscribeProgress, TranscribeSegment, TranscribeStatus, WhisperModelId,
} from "../../../shared/ipc-types";

export type TranscribePhase = "idle" | "running" | "done" | "error";

export interface TranscribeState {
  file: PickedFile | null;
  model: WhisperModelId;
  status: TranscribeStatus | null;
  phase: TranscribePhase;
  progress: TranscribeProgress | null;
  segments: TranscribeSegment[];
  translated: boolean;
  warning: string | null;
  translateToVi: boolean;
  error: string | null;
  notice: string | null;      // thông báo nhỏ (đã lưu / đã sao chép...)
  noticeIsError: boolean;
}

function uid() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

export function useTranscribe() {
  const [state, setState] = useState<TranscribeState>({
    file: null, model: "small", status: null, phase: "idle", progress: null,
    segments: [], translated: false, warning: null, translateToVi: true,
    error: null, notice: null, noticeIsError: false,
  });
  const jobId = useRef<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patch = useCallback((p: Partial<TranscribeState>) => setState(s => ({ ...s, ...p })), []);

  const showNotice = useCallback((text: string, isError = false) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setState(s => ({ ...s, notice: text, noticeIsError: isError }));
    noticeTimer.current = setTimeout(() => setState(s => ({ ...s, notice: null })), 5000);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await window.api.getTranscribeStatus();
      if (status) setState(s => ({ ...s, status }));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const offP = window.api.onTranscribeProgress(p => {
      if (p.id === jobId.current) setState(s => ({ ...s, progress: p }));
    });
    const offD = window.api.onTranscribeDone(d => {
      if (d.id !== jobId.current) return;
      setState(s => ({
        ...s, phase: "done", segments: d.segments, progress: null, error: null,
        translated: d.translated === true, warning: d.warning ?? null,
      }));
      void refreshStatus();
    });
    const offE = window.api.onTranscribeError(e => {
      if (e.id !== jobId.current) return;
      setState(s => ({ ...s, phase: "error", error: e.message, progress: null }));
      void refreshStatus();
    });
    return () => { offP(); offD(); offE(); if (noticeTimer.current) clearTimeout(noticeTimer.current); };
  }, [refreshStatus]);

  const pickFile = useCallback(async () => {
    if (state.phase === "running") return;
    const r = await window.api.pickTranscribeFile();
    if (r.canceled) return;
    if (!r.ok || !r.file) { showNotice(r.error ?? "Không chọn được file.", true); return; }
    jobId.current = null;
    setState(s => ({
      ...s, file: r.file!, phase: "idle", segments: [], error: null, progress: null,
      translated: false, warning: null,
    }));
  }, [state.phase, showNotice]);

  const setModel = useCallback((model: WhisperModelId) => patch({ model }), [patch]);
  const setTranslateToVi = useCallback((translateToVi: boolean) => patch({ translateToVi }), [patch]);

  const start = useCallback(async () => {
    if (!state.file || state.phase === "running") return;
    const id = uid();
    jobId.current = id;
    setState(s => ({
      ...s, phase: "running", segments: [], error: null, notice: null,
      translated: false, warning: null,
      progress: { id, stage: "tools", percent: 0, message: "Đang chuẩn bị..." },
    }));
    const r = await window.api.startTranscribe({
      id, fileToken: state.file.token, model: state.model, translateToVi: state.translateToVi,
    });
    if (!r.ok) {
      jobId.current = null;
      setState(s => ({ ...s, phase: "error", error: r.error ?? "Không bắt đầu được.", progress: null }));
    }
  }, [state.file, state.model, state.phase, state.translateToVi]);

  const cancel = useCallback(() => {
    if (jobId.current) window.api.cancelTranscribe(jobId.current);
    jobId.current = null;
    setState(s => ({ ...s, phase: "idle", progress: null }));
    void refreshStatus();
  }, [refreshStatus]);

  const saveSrt = useCallback(async () => {
    if (!jobId.current) return;
    const r = await window.api.saveTranscribeSrt(jobId.current);
    if (r.canceled) return;
    if (r.ok) showNotice("Đã lưu file phụ đề.");
    else showNotice(r.error ?? "Không lưu được file.", true);
  }, [showNotice]);

  const copyText = useCallback(async () => {
    if (!jobId.current) return;
    const r = await window.api.copyTranscribeText(jobId.current);
    if (r.ok) showNotice("Đã sao chép văn bản.");
    else showNotice(r.error ?? "Không sao chép được.", true);
  }, [showNotice]);

  return { state, pickFile, setModel, setTranslateToVi, start, cancel, saveSrt, copyText };
}

export type TranscribeApi = ReturnType<typeof useTranscribe>;
