// src/renderer/src/components/ConfirmDialog.tsx
// Hộp thoại xác nhận trong app (thay cho window.confirm — tránh lỗi mất focus ô nhập trên Electron/Windows).
import { useEffect, useRef } from "react";

interface Props {
  open:        boolean;
  title:       string;
  message:     string;
  confirmText?: string;
  /** null = ẩn nút Huỷ (hộp thoại chỉ có 1 nút thông báo) */
  cancelText?:  string | null;
  danger?:      boolean;
  onConfirm:   () => void;
  onCancel:    () => void;
}

export function ConfirmDialog({
  open, title, message, confirmText = "OK", cancelText = "Huỷ", danger, onConfirm, onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/55 fade-in"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-[380px] max-w-[90%] rounded-lg bg-[#181c27] border border-[#252a38] shadow-[0_16px_40px_rgba(0,0,0,0.6)] p-4"
      >
        <h3 className="text-[13px] font-semibold text-text mb-1.5">{title}</h3>
        <p className="text-[12px] text-subtle leading-relaxed whitespace-pre-line break-words">{message}</p>
        <div className="flex justify-end gap-2 mt-4">
          {cancelText !== null && (
            <button
              type="button"
              onClick={onCancel}
              className="h-7 px-3 rounded text-[12px] bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text transition-colors"
            >
              {cancelText}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`h-7 px-3 rounded text-[12px] font-semibold text-white transition-colors ${
              danger ? "bg-red-600 hover:bg-red-500" : "bg-accent hover:bg-blue-500"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
