// src/renderer/src/components/YtdlpUpdateBanner.tsx
//
// Banner nhỏ gọn hiển thị trạng thái cập nhật yt-dlp.
// Tự ẩn sau khi "updated" 4 giây.

import React, { useEffect } from "react";
import { YtdlpUpdaterState } from "../hooks/useYtdlpUpdater";

interface Props {
  state:     YtdlpUpdaterState;
  onForce:   () => void;
  onDismiss: () => void;
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full h-[2px] rounded-full bg-white/10 overflow-hidden mt-2">
      <div
        className="h-full rounded-full bg-accent transition-all duration-300 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function YtdlpUpdateBanner({ state, onForce, onDismiss }: Props) {
  const { phase, currentVersion, latestVersion, percent, errorMsg } = state;

  // Tự dismiss sau khi updated thành công
  useEffect(() => {
    if (phase === "updated") {
      const t = setTimeout(onDismiss, 4000);
      return () => clearTimeout(t);
    }
  }, [phase, onDismiss]);

  // Chỉ hiện khi có thông tin đáng hiển thị
  if (phase === "idle" || phase === "checking" || phase === "up-to-date") return null;

  const isUpdateFound = phase === "update-found";
  const isDownloading = phase === "downloading";
  const isUpdated     = phase === "updated";
  const isError       = phase === "error";
  const isNotFound    = phase === "not-found";

  return (
    <div className="mx-3 mb-2 rounded-xl border border-[#1e293b] bg-[#111827]/95 px-4 py-3 shadow-md">
      <div className="flex items-center gap-2.5">

        {/* Icon */}
        {isDownloading && (
          <svg className="animate-spin w-4 h-4 text-accent shrink-0" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
          </svg>
        )}
        {isUpdateFound && (
          <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 text-yellow-400 shrink-0">
            <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 6v4M10 13.5h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
        {isUpdated && (
          <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 text-green-400 shrink-0">
            <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M6.5 10l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
        {(isError || isNotFound) && (
          <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 text-red-400 shrink-0">
            <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 6v4M10 13.5h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}

        {/* Message */}
        <div className="flex-1 min-w-0 text-[12px]">
          {isUpdateFound && (
            <span className="text-[#e2e8f0]">
              yt-dlp{" "}
              <span className="text-yellow-400 font-medium">{latestVersion}</span>
              <span className="text-[#64748b]"> — đang cập nhật từ {currentVersion}…</span>
            </span>
          )}
          {isDownloading && (
            <span className="text-[#94a3b8]">
              Đang tải yt-dlp{" "}
              <span className="text-[#e2e8f0] font-medium">{latestVersion}</span>
              {" "}· {percent}%
            </span>
          )}
          {isUpdated && (
            <span className="text-green-400 font-medium">
              yt-dlp đã cập nhật lên {currentVersion} ✓
            </span>
          )}
          {isError && (
            <span>
              <span className="text-red-400">yt-dlp update lỗi: </span>
              <span className="text-[#94a3b8] truncate">{errorMsg}</span>
            </span>
          )}
          {isNotFound && (
            <span className="text-[#94a3b8]">
              Không tìm thấy <span className="text-[#e2e8f0]">yt-dlp.exe</span> trong thư mục tools/
            </span>
          )}
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {(isError || isNotFound) && (
            <button
              onClick={onForce}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-accent text-white hover:bg-accent/80 transition-colors font-medium"
            >
              Tải lại
            </button>
          )}
          {(isError || isNotFound || isUpdated) && (
            <button
              onClick={onDismiss}
              className="text-[11px] px-2.5 py-1 rounded-lg text-[#64748b] hover:text-[#94a3b8] hover:bg-white/5 transition-colors"
            >
              Đóng
            </button>
          )}
        </div>
      </div>

      {isDownloading && <ProgressBar percent={percent ?? 0} />}
    </div>
  );
}
