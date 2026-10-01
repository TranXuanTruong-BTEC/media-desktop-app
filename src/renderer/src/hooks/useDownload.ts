// src/renderer/src/hooks/useDownload.ts
import { useState, useEffect, useCallback, useRef } from "react";
import {
  DownloadRequest,
  DownloadProgress,
  DownloadComplete,
  DownloadError,
  DownloadRetrying,
  VideoQuality,
} from "../../../shared/ipc-types";

export type DownloadStatus = "queued" | "downloading" | "retrying" | "done" | "error" | "cancelled";

export interface RetryInfo {
  attempt:     number;
  maxAttempts: number;
  reason:      string;
  delayMs:     number;
  /** Timestamp khi bắt đầu chờ — dùng để đếm ngược countdown */
  startedAt:   number;
}

export interface DownloadItem {
  id:        string;
  url:       string;
  quality:   VideoQuality;
  status:    DownloadStatus;
  percent:   number;
  speed:     string;
  eta:       string;
  size:      string;
  filename:  string;
  outputDir: string;
  error?:    string;
  warning?:  string;
  addedAt:   number;
  retryInfo?: RetryInfo;
}

function uid() { return Math.random().toString(36).slice(2, 10); }

// ── Lịch sử tải (lưu bền vững, độc lập với hàng đợi) ─────────────────────────
const HISTORY_KEY = "mediaget.history.v1";
const HISTORY_MAX = 1000;

const TERMINAL: DownloadStatus[] = ["done", "error", "cancelled"];

function loadHistory(): DownloadItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveHistory(list: DownloadItem[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); }
  catch { /* ignore quota / private mode */ }
}

/** Chuẩn hoá URL để so sánh trùng (YouTube watch?v= / youtu.be / shorts → cùng 1 khoá) */
export function normalizeUrl(raw: string): string {
  const url = raw.trim();
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (host === "youtu.be") return `youtube:${u.pathname.slice(1)}`;
    if (host.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return `youtube:${v}`;
      const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/);
      if (m) return `youtube:${m[2]}`;
    }
    return `${host}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function useDownload(defaultOutputDir: string) {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [history, setHistory] = useState<DownloadItem[]>(loadHistory);
  const historyRef = useRef(history);
  historyRef.current = history;

  // Mỗi khi 1 mục kết thúc (xong/lỗi/huỷ) → ghi vào lịch sử (upsert theo id).
  // Xoá mục khỏi hàng đợi KHÔNG ảnh hưởng lịch sử.
  useEffect(() => {
    const finished = items.filter(i => TERMINAL.includes(i.status));
    if (finished.length === 0) return;
    setHistory(prev => {
      let changed = false;
      const next = [...prev];
      for (const it of finished) {
        const idx = next.findIndex(h => h.id === it.id);
        if (idx === -1) { next.unshift(it); changed = true; }
        else if (next[idx].status !== it.status || next[idx].filename !== it.filename) {
          next[idx] = it; changed = true;
        }
      }
      if (!changed) return prev;
      saveHistory(next);
      return next;
    });
  }, [items]);

  useEffect(() => {
    if (!window.api) return;

    const offProgress = window.api.onProgress((p: DownloadProgress) =>
      setItems(prev => prev.map(item =>
        item.id === p.id
          ? {
              ...item,
              status:   "downloading",
              percent:  p.percent,
              speed:    p.speed,
              eta:      p.eta,
              size:     p.size,
              filename: p.filename || item.filename,
              retryInfo: undefined, // progressing → clear retry badge
            }
          : item
      ))
    );

    const offRetrying = (window.api as any).onRetrying?.((r: DownloadRetrying) =>
      setItems(prev => prev.map(item =>
        item.id === r.id
          ? {
              ...item,
              status:    "retrying",
              speed:     "",
              eta:       "",
              retryInfo: {
                attempt:     r.attempt,
                maxAttempts: r.maxAttempts,
                reason:      r.reason,
                delayMs:     r.delayMs,
                startedAt:   Date.now(),
              },
            }
          : item
      ))
    );

    const offComplete = window.api.onComplete((c: DownloadComplete) =>
      setItems(prev => prev.map(item =>
        item.id === c.id
          ? { ...item, status: "done", percent: 100, filename: c.filename || item.filename,
              warning: c.warning, retryInfo: undefined }
          : item
      ))
    );

    const offError = window.api.onError((e: DownloadError) =>
      setItems(prev => prev.map(item =>
        item.id === e.id
          ? { ...item, status: "error", error: e.message, retryInfo: undefined }
          : item
      ))
    );

    return () => {
      offProgress();
      offRetrying?.();
      offComplete();
      offError();
    };
  }, []);

  const addDownload = useCallback((url: string, quality: VideoQuality, outputDir: string) => {
    if (!window.api) return;
    const id  = uid();
    const req: DownloadRequest = { id, url, quality, outputDir };
    setItems(prev => [...prev, {
      id, url, quality, outputDir,
      status: "downloading",
      percent: 0, speed: "", eta: "", size: "", filename: "",
      addedAt: Date.now(),
    }]);
    window.api.startDownload(req);
    return id;
  }, []);

  const cancelDownload = useCallback((id: string) => {
    window.api?.cancelDownload(id);
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, status: "cancelled", retryInfo: undefined } : item
    ));
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setItems(prev => prev.filter(
      item => item.status !== "done" && item.status !== "error" && item.status !== "cancelled"
    ));
  }, []);

  const removeHistory = useCallback((id: string) => {
    setHistory(prev => { const next = prev.filter(h => h.id !== id); saveHistory(next); return next; });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]); saveHistory([]);
  }, []);

  /** Trả về mục đã tải THÀNH CÔNG trước đó với cùng URL (nếu có) */
  const findDuplicate = useCallback((url: string): DownloadItem | undefined => {
    const key = normalizeUrl(url);
    return historyRef.current.find(h => h.status === "done" && normalizeUrl(h.url) === key);
  }, []);

  const selectOutputDir = useCallback(async () => {
    return (await window.api?.selectOutputDir()) ?? null;
  }, []);

  const stats = {
    total:   items.length,
    active:  items.filter(i => i.status === "downloading" || i.status === "retrying").length,
    done:    items.filter(i => i.status === "done").length,
    failed:  items.filter(i => i.status === "error").length,
  };

  return {
    items, history, addDownload, cancelDownload, removeItem, clearCompleted,
    removeHistory, clearHistory, findDuplicate, selectOutputDir, stats,
  };
}