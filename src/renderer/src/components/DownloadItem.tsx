// src/renderer/src/components/DownloadItem.tsx
import React from "react";
import { DownloadItem } from "../hooks/useDownload";

interface Props {
  item: DownloadItem;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenFolder: (id: string) => void;
}

const QUALITY_LABEL: Record<string, string> = {
  "bestvideo+bestaudio": "AUTO",
  "1080p": "1080p", "720p": "720p", "480p": "480p", "360p": "360p",
  "audio_mp3": "MP3", "audio_m4a": "M4A",
};

const STATUS_COLOR: Record<string, string> = {
  downloading: "#3b82f6",
  done:        "#22c55e",
  error:       "#ef4444",
  cancelled:   "#4b5563",
  queued:      "#f59e0b",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#4b5563";
  const label = { downloading: "Đang tải", done: "Hoàn thành", error: "Lỗi", cancelled: "Đã hủy", queued: "Chờ" }[status] ?? status;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ color, background: color + "22" }}>
      {label}
    </span>
  );
}

function SpeedDot() {
  return (
    <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent mr-1.5" style={{
      boxShadow: "0 0 4px #3b82f6",
      animation: "pulse 1s ease-in-out infinite",
    }} />
  );
}

export function DownloadItemRow({ item, onCancel, onRemove, onOpenFolder }: Props) {
  const isActive = item.status === "downloading";
  const isDone   = item.status === "done";
  const isError  = item.status === "error";

  const displayName = item.filename
    ? (item.filename.length > 70 ? item.filename.slice(0, 67) + "…" : item.filename)
    : (item.url.length > 70 ? item.url.slice(0, 67) + "…" : item.url);

  return (
    <div className={`fade-in flex flex-col gap-1.5 px-3 py-2.5 border-b border-[#1e2333] hover:bg-white/[0.02] transition-colors ${isError ? "bg-red-500/5" : ""}`}>
      {/* Row 1: filename + badges + actions */}
      <div className="flex items-center gap-2">
        {/* File icon */}
        <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${isDone ? "bg-success/15" : isError ? "bg-danger/15" : "bg-accent/15"}`}>
          {item.quality.startsWith("audio") ? (
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
              <path d="M9 2v8.5a2 2 0 11-2-2V4l4-1V2H9z" stroke={isDone ? "#22c55e" : isError ? "#ef4444" : "#3b82f6"} strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
              <rect x="2" y="2" width="12" height="12" rx="2" stroke={isDone ? "#22c55e" : isError ? "#ef4444" : "#3b82f6"} strokeWidth="1.3"/>
              <path d="M6 5.5l4 2.5-4 2.5V5.5z" fill={isDone ? "#22c55e" : isError ? "#ef4444" : "#3b82f6"}/>
            </svg>
          )}
        </div>

        {/* Name */}
        <span className="flex-1 text-[12px] text-text truncate" title={item.filename || item.url}>
          {isActive && <SpeedDot />}
          {displayName}
        </span>

        {/* Quality tag */}
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#252a38] text-subtle shrink-0">
          {QUALITY_LABEL[item.quality] ?? item.quality}
        </span>

        {/* Status */}
        <StatusBadge status={item.status} />

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {isActive && (
            <button
              onClick={() => onCancel(item.id)}
              title="Hủy"
              className="w-6 h-6 rounded hover:bg-danger/20 flex items-center justify-center text-muted hover:text-danger transition-colors"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
          {isDone && (
            <button
              onClick={() => onOpenFolder(item.id)}
              title="Mở thư mục"
              className="w-6 h-6 rounded hover:bg-success/20 flex items-center justify-center text-muted hover:text-success transition-colors"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3">
                <path d="M2 4a1 1 0 011-1h3l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.3"/>
              </svg>
            </button>
          )}
          {(isDone || isError || item.status === "cancelled") && (
            <button
              onClick={() => onRemove(item.id)}
              title="Xóa khỏi danh sách"
              className="w-6 h-6 rounded hover:bg-white/10 flex items-center justify-center text-muted hover:text-subtle transition-colors"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Row 2: progress bar */}
      {isActive && (
        <div className="flex items-center gap-2 pl-8">
          <div className="flex-1 h-1.5 bg-[#1e2333] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full progress-bar-active transition-all duration-300"
              style={{ width: `${item.percent}%`, background: "linear-gradient(90deg, #2563eb, #3b82f6)" }}
            />
          </div>
          <span className="text-[10px] text-subtle w-8 text-right shrink-0">{item.percent.toFixed(0)}%</span>
          {item.speed && <span className="text-[10px] text-accent shrink-0">{item.speed}</span>}
          {item.eta && item.eta !== "Unknown" && (
            <span className="text-[10px] text-muted shrink-0">ETA {item.eta}</span>
          )}
          {item.size && <span className="text-[10px] text-muted shrink-0">{item.size}</span>}
        </div>
      )}

      {/* Row 2: done — full bar */}
      {isDone && (
        <div className="pl-8">
          <div className="h-1.5 bg-success/20 rounded-full overflow-hidden">
            <div className="h-full w-full bg-success rounded-full" />
          </div>
        </div>
      )}

      {/* Row 2: error message */}
      {isError && item.error && (
        <div className="pl-8 text-[11px] text-danger/80 truncate" title={item.error}>
          ⚠ {item.error}
        </div>
      )}
    </div>
  );
}
