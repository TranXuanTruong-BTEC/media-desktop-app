// src/renderer/src/components/DownloadForm.tsx
import React, { useEffect, useRef, useState } from "react";
import { VideoQuality } from "../../../shared/ipc-types";

interface Props {
  outputDir: string;
  onOutputDirChange: (dir: string) => void;
  onSelectDir: () => void;
  onSubmit: (url: string, quality: VideoQuality, outputDir: string) => void;
  /** Tăng giá trị này để xoá ô nhập link (App chỉ xoá khi link thực sự được nhận) */
  clearKey?: number;
}

interface QualityOption {
  value: VideoQuality;
  label: string;
  hint: string;
}

const VIDEO_OPTIONS: QualityOption[] = [
  { value: "bestvideo+bestaudio", label: "Tốt nhất (tự động)", hint: "Video" },
  { value: "1080p",               label: "1080p Full HD",       hint: "Video" },
  { value: "720p",                label: "720p HD",             hint: "Video" },
  { value: "480p",                label: "480p",                hint: "Video" },
  { value: "360p",                label: "360p",                hint: "Video" },
];

const AUDIO_OPTIONS: QualityOption[] = [
  { value: "audio_mp3", label: "Chỉ âm thanh (MP3)", hint: "MP3" },
  { value: "audio_m4a", label: "Chỉ âm thanh (M4A)", hint: "M4A" },
];

const ALL_OPTIONS = [...VIDEO_OPTIONS, ...AUDIO_OPTIONS];

function QualitySelect({
  value,
  onChange,
}: {
  value: VideoQuality;
  onChange: (q: VideoQuality) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = ALL_OPTIONS.find(o => o.value === value) ?? VIDEO_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(q: VideoQuality) {
    onChange(q);
    setOpen(false);
  }

  function renderOption(opt: QualityOption, opts?: { last?: boolean }) {
    const active = opt.value === value;
    return (
      <button
        key={opt.value}
        type="button"
        role="option"
        aria-selected={active}
        onClick={() => pick(opt.value)}
        className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-[12px] transition-colors
          ${opts?.last ? "" : "border-b border-[#1e2433]"}
          ${active ? "bg-accent/15 text-text" : "text-subtle hover:bg-[#1e2433] hover:text-text"}`}
      >
        <span className="font-medium">{opt.label}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${active ? "bg-accent/30 text-accent" : "bg-[#1a2030] text-muted"}`}>
          {opt.hint}
        </span>
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="h-8 min-w-[188px] px-2.5 bg-[#0f1117] border border-[#3a4258] rounded text-[12px] text-text
          outline-none hover:border-accent/70 focus:border-accent cursor-pointer flex items-center justify-between gap-2"
      >
        <span className="truncate">{selected.label}</span>
        <svg viewBox="0 0 12 12" className={`w-3 h-3 text-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-[calc(100%+4px)] z-50 w-[260px] rounded-md overflow-hidden
            bg-[#0e1118] border border-[#4b5568] shadow-[0_10px_28px_rgba(0,0,0,0.55)]"
        >
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-sky-300 bg-[#152033] border-b border-[#2d3a55]">
            Video
          </div>
          {VIDEO_OPTIONS.map((opt, i) => renderOption(opt, { last: i === VIDEO_OPTIONS.length - 1 }))}

          <div className="flex items-center gap-2 px-3 py-2 bg-[#1a1410] border-y-2 border-[#c2782a]/70">
            <span className="flex-1 h-px bg-[#c2782a]/80" />
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-400 whitespace-nowrap">
              Chỉ âm thanh
            </span>
            <span className="flex-1 h-px bg-[#c2782a]/80" />
          </div>

          <div className="bg-[#16120e]">
            {AUDIO_OPTIONS.map((opt, i) => renderOption(opt, { last: i === AUDIO_OPTIONS.length - 1 }))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DownloadForm({ outputDir, onSelectDir, onSubmit, clearKey }: Props) {
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState<VideoQuality>("bestvideo+bestaudio");
  const [error, setError] = useState("");

  useEffect(() => { if (clearKey) setUrl(""); }, [clearKey]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) { setError("Vui lòng nhập URL"); return; }
    if (!trimmed.startsWith("http")) { setError("URL không hợp lệ"); return; }
    if (!outputDir) { setError("Vui lòng chọn thư mục lưu"); return; }
    setError("");
    onSubmit(trimmed, quality, outputDir);
  }

  return (
    <div className="bg-[#181c27] border-b border-[#252a38] p-3 shrink-0">
      <form onSubmit={handleSubmit}>
        <div className="flex flex-wrap gap-2 mb-2">
          <div className="flex-1 relative min-w-[200px]">
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
              className="w-full h-8 pl-8 pr-3 bg-[#0f1117] border border-[#3a4258] rounded text-[12px] text-text placeholder-muted outline-none focus:border-accent transition-colors"
            />
          </div>

          <QualitySelect value={quality} onChange={setQuality} />

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

        <div className="flex gap-2 items-center">
          <div className="flex-1 min-w-0 flex items-center gap-2 h-7 px-3 bg-[#0f1117] border border-[#3a4258] rounded text-[11px] text-subtle overflow-hidden">
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
