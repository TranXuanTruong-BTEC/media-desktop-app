// src/renderer/src/components/UpdateBanner.tsx
import React, { useEffect, useRef, useState } from "react";
import { UpdaterState } from "../hooks/useUpdater";

interface Props {
  state: UpdaterState;
  onDownload: () => void;
  onInstall:  () => void;
  onDismiss:  () => void;
}

/** Animated shimmer bar for downloading state */
function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full h-[3px] rounded-full bg-white/10 overflow-hidden mt-2">
      <div
        className="h-full rounded-full bg-accent transition-all duration-300 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** Spinning circle icon while checking / downloading */
function SpinnerIcon() {
  return (
    <svg
      className="animate-spin w-4 h-4 text-accent shrink-0"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
    </svg>
  );
}

/** Arrow-up-in-circle icon for "update available" */
function UpdateIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 text-accent shrink-0">
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M10 13.5V7M7.5 9.5l2.5-2.5 2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/** Checkmark icon for "ready to install" */
function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 text-green-400 shrink-0">
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M6.5 10l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function UpdateBanner({ state, onDownload, onInstall, onDismiss }: Props) {
  const { phase, version, percent, errorMsg } = state;
  const [visible, setVisible] = useState(false);
  const prevPhase = useRef<string>("idle");

  // Trigger slide-in animation whenever we go to a visible phase
  useEffect(() => {
    const showPhases = ["available", "downloading", "ready", "error", "checking"];
    if (showPhases.includes(phase)) {
      setVisible(true);
    } else if (phase === "dismissed" || phase === "not-available") {
      setVisible(false);
    }
    prevPhase.current = phase;
  }, [phase]);

  if (
    phase === "idle" ||
    phase === "not-available" ||
    phase === "dismissed"
  ) return null;

  // ── Layout helpers ──────────────────────────────────────────────────────
  const isChecking   = phase === "checking";
  const isAvailable  = phase === "available";
  const isDownloading = phase === "downloading";
  const isReady      = phase === "ready";
  const isError      = phase === "error";

  return (
    <div
      className={`
        mx-3 mb-2 rounded-xl border bg-[#111827]/95 backdrop-blur-sm
        border-[#1e293b] shadow-lg
        transition-all duration-500 ease-out overflow-hidden
        ${visible ? "opacity-100 translate-y-0 max-h-40" : "opacity-0 translate-y-4 max-h-0"}
      `}
      style={{ willChange: "transform, opacity, max-height" }}
    >
      <div className="px-4 py-3">
        {/* ── Row 1: icon + message + dismiss ── */}
        <div className="flex items-center gap-2.5">
          {/* Icon */}
          {isChecking || isDownloading ? <SpinnerIcon /> : null}
          {isAvailable                 ? <UpdateIcon />  : null}
          {isReady                     ? <CheckIcon />   : null}
          {isError && (
            <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 text-red-400 shrink-0">
              <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M10 6v4M10 13.5h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          )}

          {/* Message */}
          <div className="flex-1 min-w-0">
            {isChecking && (
              <p className="text-[12px] text-[#94a3b8]">Đang kiểm tra bản cập nhật…</p>
            )}
            {isAvailable && (
              <p className="text-[12px] text-[#e2e8f0] leading-snug">
                <span className="text-accent font-semibold">MediaGet {version}</span>
                <span className="text-[#94a3b8]"> — phiên bản mới có sẵn</span>
              </p>
            )}
            {isDownloading && (
              <p className="text-[12px] text-[#94a3b8]">
                Đang tải xuống… <span className="text-[#e2e8f0] font-medium">{percent}%</span>
              </p>
            )}
            {isReady && (
              <p className="text-[12px] text-[#e2e8f0] leading-snug">
                <span className="text-green-400 font-semibold">MediaGet {version}</span>
                <span className="text-[#94a3b8]"> đã sẵn sàng cài đặt</span>
              </p>
            )}
            {isError && (
              <p className="text-[12px] text-[#94a3b8] truncate">
                <span className="text-red-400">Lỗi: </span>{errorMsg}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isAvailable && (
              <>
                <button
                  onClick={onDismiss}
                  className="text-[11px] px-2.5 py-1 rounded-lg text-[#64748b] hover:text-[#94a3b8] hover:bg-white/5 transition-colors"
                >
                  Để sau
                </button>
                <button
                  onClick={onDownload}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-accent text-white hover:bg-accent/80 transition-colors font-medium"
                >
                  Tải ngay
                </button>
              </>
            )}
            {isReady && (
              <>
                <button
                  onClick={onDismiss}
                  className="text-[11px] px-2.5 py-1 rounded-lg text-[#64748b] hover:text-[#94a3b8] hover:bg-white/5 transition-colors"
                >
                  Để sau
                </button>
                <button
                  onClick={onInstall}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-green-600 text-white hover:bg-green-500 transition-colors font-medium flex items-center gap-1"
                >
                  <svg viewBox="0 0 14 14" fill="none" className="w-3 h-3">
                    <path d="M7 1v7M4.5 6l2.5 2.5L9.5 6M2 11h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  Cài và khởi động lại
                </button>
              </>
            )}
            {(isChecking || isDownloading) && (
              /* No dismiss while actively doing work; show only progress */
              <div className="w-1" />
            )}
            {isError && (
              <button
                onClick={onDismiss}
                className="text-[11px] px-2.5 py-1 rounded-lg text-[#64748b] hover:text-[#94a3b8] hover:bg-white/5 transition-colors"
              >
                Đóng
              </button>
            )}
          </div>
        </div>

        {/* ── Row 2: progress bar ── */}
        {isDownloading && <ProgressBar percent={percent ?? 0} />}
      </div>
    </div>
  );
}
