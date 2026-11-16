// src/renderer/src/components/UpdateToast.tsx
// Thông báo cập nhật KHÔNG chặn thao tác (thay cho hộp thoại toàn màn hình cũ).
//  - Cập nhật ngầm: chỉ hiện khi bản mới đã tải xong ("ready"), kèm 1 nút "Cập nhật ngay" (bỏ qua cũng không sao: tự cài khi đóng app).
//  - Người dùng tự bấm "Kiểm tra" trong Cài đặt: còn hiện thêm tiến độ tải và lỗi.
import React from "react";
import { UpdaterState } from "../hooks/useUpdater";

interface Props {
  state: UpdaterState;
  onDismiss: () => void;
  onInstall: () => void;
}

export function UpdateToast({ state, onDismiss, onInstall }: Props) {
  const { phase, version, percent, errorMsg, silent } = state;

  const show =
    phase === "ready" ||
    (!silent && (phase === "available" || phase === "downloading" || phase === "error"));
  if (!show) return null;

  return (
    <div className="absolute right-4 bottom-10 z-40 w-[320px] rounded-xl border border-[#1e293b] bg-[#0f1117] shadow-2xl" role="status" aria-live="polite">
      <div className="p-3.5">
        {phase === "ready" && (
          <>
            <p className="text-[13px] font-semibold text-[#f1f5f9]">Đã có bản mới {version}</p>
            <p className="text-[11px] text-[#94a3b8] mt-1">
              Bản mới đã được tải sẵn và sẽ tự cài khi bạn đóng ứng dụng. Muốn dùng ngay, bấm nút bên dưới (mất vài giây, app tự mở lại).
            </p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button type="button" onClick={onDismiss}
                className="text-[12px] px-3 py-1.5 rounded-lg text-[#64748b] hover:text-[#94a3b8] hover:bg-white/5 transition-colors">
                Để sau
              </button>
              <button type="button" onClick={onInstall}
                className="text-[12px] px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-500 transition-colors font-medium">
                Cập nhật ngay
              </button>
            </div>
          </>
        )}

        {(phase === "available" || phase === "downloading") && (
          <>
            <p className="text-[13px] font-semibold text-[#f1f5f9]">
              {phase === "available" ? `Đang tải bản ${version ?? "mới"}…` : "Đang tải bản cập nhật…"}
            </p>
            {phase === "downloading" && (
              <div className="w-full h-[3px] rounded-full bg-white/10 overflow-hidden mt-2.5">
                <div className="h-full rounded-full bg-accent transition-all duration-300 ease-out" style={{ width: `${percent ?? 0}%` }} />
              </div>
            )}
            <p className="text-[11px] text-[#64748b] mt-2">Không cần làm gì thêm, bạn vẫn dùng app bình thường.</p>
          </>
        )}

        {phase === "error" && (
          <>
            <p className="text-[13px] font-semibold text-[#f1f5f9]">Không cập nhật được</p>
            <p className="text-[11px] text-[#94a3b8] mt-1 break-words">{errorMsg}</p>
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={onDismiss}
                className="text-[12px] px-3 py-1.5 rounded-lg text-[#64748b] hover:text-[#94a3b8] hover:bg-white/5 transition-colors">
                Đóng
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
