// src/renderer/src/components/DownloadForm.tsx
import React, { useState } from "react";
import { VideoQuality } from "../../../shared/ipc-types";

interface Props {
  outputDir: string;
  onOutputDirChange: (dir: string) => void;
  onSelectDir: () => void;
  onSubmit: (url: string, quality: VideoQuality, outputDir: string) => void;
}

const QUALITY_OPTIONS: { value: VideoQuality; label: string; tag: string }[] = [
  { value: "bestvideo+bestaudio", label: "Tốt nhất (tự động)",  tag: "AUTO" },
  { value: "1080p",               label: "1080p Full HD",        tag: "HD"   },
  { value: "720p",                label: "720p HD",              tag: "HD"   },
  { value: "480p",                label: "480p",                 tag: "SD"   },
  { value: "360p",                label: "360p",                 tag: "SD"   },
  { value: "audio_mp3",           label: "Chỉ âm thanh (MP3)",  tag: "MP3"  },
  { value: "audio_m4a",           label: "Chỉ âm thanh (M4A)",  tag: "M4A"  },
];

export function DownloadForm({ outputDir, onOutputDirChange, onSelectDir, onSubmit }: Props) {
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState<VideoQuality>("bestvideo+bestaudio");
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) { setError("Vui lòng nhập URL"); return; }
    if (!trimmed.startsWith("http")) { setError("URL không hợp lệ"); return; }
    if (!outputDir) { setError("Vui lòng chọn thư mục lưu"); return; }
    setError("");
    onSubmit(trimmed, quality, outputDir);
    setUrl("");
  }

  return (
    <div className="bg-[#181c27] border-b border-[#252a38] p-3 shrink-0">
      {/* URL Row */}
      <form onSubmit={handleSubmit}>
        <div className="flex gap-2 mb-2">
          <div className="flex-1 relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
                <path d="M6.5 11.5l-2 2a2.83 2.83 0 01-4-4l2-2m7 1l2-2a2.83 2.83 0 00-4-4l-2 2m-1 4l4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </div>
            <input
              type="text"
              value={url}
              onChange={e => { setUrl(e.target.value); setError(""); }}
              onPaste={e => {
                const pasted = e.clipboardData.getData("text").trim();
                if (pasted.startsWith("http")) { setUrl(pasted); setError(""); }
              }}
              placeholder="Dán link YouTube, TikTok, Facebook, Twitter..."
              className="w-full h-8 pl-8 pr-3 bg-[#0f1117] border border-[#252a38] rounded text-[12px] text-text placeholder-muted outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Quality selector */}
          <select
            value={quality}
            onChange={e => setQuality(e.target.value as VideoQuality)}
            className="h-8 px-2 bg-[#0f1117] border border-[#252a38] rounded text-[12px] text-text outline-none focus:border-accent cursor-pointer min-w-[160px]"
          >
            {QUALITY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Download button */}
          <button
            type="submit"
            className="h-8 px-4 bg-accent hover:bg-blue-500 text-white rounded text-[12px] font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
              <path d="M8 2v8M5 7l3 3 3-3M3 13h10" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Tải xuống
          </button>
        </div>

        {/* Output dir row */}
        <div className="flex gap-2 items-center">
          <div className="flex-1 flex items-center gap-2 h-7 px-3 bg-[#0f1117] border border-[#252a38] rounded text-[11px] text-subtle overflow-hidden">
            <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3 shrink-0 text-muted">
              <path d="M2 4a1 1 0 011-1h3l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
            <span className="truncate">{outputDir || "Chưa chọn thư mục..."}</span>
          </div>
          <button
            type="button"
            onClick={onSelectDir}
            className="h-7 px-3 bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text rounded text-[11px] transition-colors whitespace-nowrap"
          >
            Thay đổi
          </button>

          {error && (
            <span className="text-danger text-[11px]">{error}</span>
          )}
        </div>
      </form>
    </div>
  );
}
