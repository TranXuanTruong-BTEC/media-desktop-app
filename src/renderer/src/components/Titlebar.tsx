// src/renderer/src/components/Titlebar.tsx
import React from "react";

interface Props { activeCount: number; }

export function Titlebar({ activeCount }: Props) {
  return (
    <div
      className="flex items-center justify-between h-9 px-3 bg-[#0a0d14] border-b border-[#1e2333] shrink-0"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Logo + title */}
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded bg-accent flex items-center justify-center shrink-0">
          <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3">
            <path d="M8 2v8M5 7l3 3 3-3M3 13h10" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </div>
        <span className="text-text font-semibold text-[12px] tracking-wider uppercase">MediaGet</span>
        {activeCount > 0 && (
          <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-medium">
            {activeCount} đang tải
          </span>
        )}
      </div>

      {/* Window controls */}
      <div
        className="flex items-center gap-0.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={() => (window as any).api?.winMinimize?.()}
          className="w-8 h-7 rounded hover:bg-white/10 flex items-center justify-center text-muted hover:text-text transition-colors"
          title="Thu nhỏ"
        >
          <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3">
            <path d="M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        <button
          onClick={() => (window as any).api?.winMaximize?.()}
          className="w-8 h-7 rounded hover:bg-white/10 flex items-center justify-center text-muted hover:text-text transition-colors"
          title="Phóng to"
        >
          <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3">
            <rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
          </svg>
        </button>
        <button
          onClick={() => (window as any).api?.winClose?.()}
          className="w-8 h-7 rounded hover:bg-danger hover:text-white flex items-center justify-center text-muted transition-colors"
          title="Đóng"
        >
          <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
