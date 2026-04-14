// src/renderer/src/hooks/useDownload.ts
import { useState, useEffect, useCallback } from "react";
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
  addedAt:   number;
  retryInfo?: RetryInfo;
}

function uid() { return Math.random().toString(36).slice(2, 10); }

export function useDownload(defaultOutputDir: string) {
  const [items, setItems] = useState<DownloadItem[]>([]);

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
          ? { ...item, status: "done", percent: 100, filename: c.filename || item.filename, retryInfo: undefined }
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

  const selectOutputDir = useCallback(async () => {
    return (await window.api?.selectOutputDir()) ?? null;
  }, []);

  const stats = {
    total:   items.length,
    active:  items.filter(i => i.status === "downloading" || i.status === "retrying").length,
    done:    items.filter(i => i.status === "done").length,
    failed:  items.filter(i => i.status === "error").length,
  };

  return { items, addDownload, cancelDownload, removeItem, clearCompleted, selectOutputDir, stats };
}
