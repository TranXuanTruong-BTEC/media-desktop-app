// src/renderer/src/components/UpdateDialog.tsx
import React from "react";
import { UpdaterState } from "../hooks/useUpdater";

interface Props {
  state: UpdaterState;
  currentVersion: string;
  onConfirm: () => void;
  onDismiss: () => void;
  onInstall: () => void;
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full h-[3px] rounded-full bg-white/10 overflow-hidden mt-3">
      <div
        className="h-full rounded-full bg-accent transition-all duration-300 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function UpdateDialog({ state, currentVersion, onConfirm, onDismiss, onInstall }: Props) {
  const { phase, version, percent } = state;

  const visible =
    phase === "available" ||
    phase === "downloading" ||
    phase === "ready";

  if (!visible) return null;

  return (
    /* Overlay */
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
      <div className="w-[340px] rounded-2xl border border-[#1e293b] bg-[#0f1117] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start gap-3">
            {/* Icon */}
            <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center shrink-0 mt-0.5">
              {phase === "ready" ? (
                <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-green-400">
                  <path d="M4 10l4.5 4.5 8-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : phase === "downloading" ? (
                <svg className="animate-spin w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2"/>
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-accent">
                  <path d="M10 14V6M7 9l3-3 3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M4 16h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              )}
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              {phase === "available" && (
                <>
                  <p className="text-[13px] font-semibold text-[#f1f5f9]">Có bản cập nhật mới</p>
                  <p className="text-[11px] text-[#64748b] mt-0.5">
                    {version} &nbsp;·&nbsp; <span className="text-[#475569]">Hiện tại: {currentVersion}</span>
                  </p>
                </>
              )}
              {phase === "downloading" && (
                <>
                  <p className="text-[13px] font-semibold text-[#f1f5f9]">Đang tải xuống…</p>
                  <p className="text-[11px] text-[#64748b] mt-0.5">{percent}% hoàn thành</p>
                </>
              )}
              {phase === "ready" && (
                <>
                  <p className="text-[13px] font-semibold text-[#f1f5f9]">Sẵn sàng cài đặt</p>
                  <p className="text-[11px] text-[#64748b] mt-0.5">MediaGet {version} đã tải xong</p>
                </>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {phase === "downloading" && <ProgressBar percent={percent ?? 0} />}
        </div>

        {/* Divider */}
        <div className="h-px bg-[#1e293b] mx-0" />

        {/* Actions */}
        <div className="px-5 py-3 flex items-center justify-end gap-2">
          {phase === "available" && (
            <>
              <button
                onClick={onDismiss}
                className="text-[12px] px-3 py-1.5 rounded-lg text-[#64748b] hover:text-[#94a3b8] hover:bg-white/5 transition-colors"
              >
                Để sau
              </button>
              <button
                onClick={onConfirm}
                className="text-[12px] px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/80 transition-colors font-medium"
              >
                Cập nhật ngay
              </button>
            </>
          )}
          {phase === "downloading" && (
            <span className="text-[11px] text-[#475569]">Vui lòng đợi…</span>
          )}
          {phase === "ready" && (
            <>
              <button
                onClick={onDismiss}
                className="text-[12px] px-3 py-1.5 rounded-lg text-[#64748b] hover:text-[#94a3b8] hover:bg-white/5 transition-colors"
              >
                Để sau
              </button>
              <button
                onClick={onInstall}
                className="text-[12px] px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-500 transition-colors font-medium flex items-center gap-1.5"
              >
                <svg viewBox="0 0 14 14" fill="none" className="w-3 h-3">
                  <path d="M7 1v7M4.5 6l2.5 2.5L9.5 6M2 11h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                Cài &amp; khởi động lại
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
