import React from "react";
import { YtdlpUpdaterState } from "../hooks/useYtdlpUpdater";
import { UpdaterState } from "../hooks/useUpdater";

interface Props {
  outputDir: string;
  onSelectDir: () => void;
  ytdlpState: YtdlpUpdaterState;
  onCheckYtdlp: () => void;
  onForceYtdlp: () => void;
  updaterState: UpdaterState;
  onCheckAppUpdate: () => void;
  version: string;
}

const HOME_URL = "https://mytools-9ns.pages.dev/";

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#252a38] bg-[#181c27] p-4">
      <h2 className="text-[13px] font-semibold text-text">{title}</h2>
      {hint && <p className="text-[11px] text-muted mt-0.5 mb-3">{hint}</p>}
      {!hint && <div className="h-3" />}
      {children}
    </section>
  );
}

function ytdlpLabel(state: YtdlpUpdaterState) {
  switch (state.phase) {
    case "checking":     return "Đang kiểm tra yt-dlp...";
    case "up-to-date":   return `Đang dùng bản mới nhất${state.currentVersion ? ` (${state.currentVersion})` : ""}`;
    case "update-found": return `Có bản mới: ${state.latestVersion ?? ""}`;
    case "downloading":  return `Đang tải yt-dlp... ${state.percent ?? 0}%`;
    case "updated":      return `Đã cập nhật${state.currentVersion ? ` (${state.currentVersion})` : ""}`;
    case "error":        return state.errorMsg || "Không kiểm tra được yt-dlp";
    case "not-found":    return "Chưa tìm thấy yt-dlp";
    default:             return state.currentVersion ? `Phiên bản: ${state.currentVersion}` : "Chưa kiểm tra";
  }
}

function appUpdateLabel(state: UpdaterState) {
  switch (state.phase) {
    case "checking":      return "Đang kiểm tra cập nhật...";
    case "available":     return `Có bản mới: ${state.version}`;
    case "not-available": return "Bạn đang dùng bản mới nhất";
    case "downloading":   return `Đang tải bản cập nhật... ${state.percent ?? 0}%`;
    case "ready":         return `Sẵn sàng cài bản ${state.version}`;
    case "error":         return state.errorMsg || "Không kiểm tra được cập nhật";
    default:              return "Kiểm tra bản cập nhật ứng dụng";
  }
}

export function SettingsPage({
  outputDir,
  onSelectDir,
  ytdlpState,
  onCheckYtdlp,
  onForceYtdlp,
  updaterState,
  onCheckAppUpdate,
  version,
}: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      <Card title="Thư mục lưu" hint="Video và audio tải xong sẽ được ghi vào đây.">
        <div className="flex flex-wrap gap-2">
          <div className="flex-1 min-w-0 flex items-center gap-2 h-8 px-3 bg-[#0f1117] border border-[#3a4258] rounded text-[12px] text-subtle overflow-hidden">
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0 text-muted">
              <path d="M2 4a1 1 0 011-1h3l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
            <span className="truncate">{outputDir || "Chưa chọn thư mục..."}</span>
          </div>
          <button
            type="button"
            onClick={onSelectDir}
            className="h-8 px-3 bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text rounded text-[12px] transition-colors whitespace-nowrap shrink-0"
          >
            Thay đổi
          </button>
        </div>
      </Card>

      <Card title="Cập nhật ứng dụng" hint={version ? `MediaGet v${version}` : "MediaGet"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex-1 min-w-[160px] text-[12px] text-subtle">{appUpdateLabel(updaterState)}</p>
          <button
            type="button"
            onClick={onCheckAppUpdate}
            className="h-8 px-3 bg-accent/15 hover:bg-accent/25 text-accent rounded text-[12px] font-medium transition-colors whitespace-nowrap shrink-0"
          >
            Kiểm tra
          </button>
        </div>
      </Card>

      <Card title="Công cụ tải (yt-dlp)" hint="Engine dùng để lấy video từ YouTube, TikTok và các trang khác.">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex-1 min-w-[160px] text-[12px] text-subtle">{ytdlpLabel(ytdlpState)}</p>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={onCheckYtdlp}
              className="h-8 px-3 bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text rounded text-[12px] transition-colors"
            >
              Kiểm tra
            </button>
            <button
              type="button"
              onClick={onForceYtdlp}
              className="h-8 px-3 bg-accent/15 hover:bg-accent/25 text-accent rounded text-[12px] font-medium transition-colors"
            >
              Cập nhật
            </button>
          </div>
        </div>
      </Card>

      <Card title="Trang chủ" hint="Xem thêm các công cụ và tin mới nhất trên trang web của chúng tôi.">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex-1 min-w-[160px] text-[12px] text-subtle truncate">{HOME_URL}</p>
          <button
            type="button"
            onClick={() => (window as any).api?.openExternal?.(HOME_URL)}
            className="h-8 px-3 bg-accent/15 hover:bg-accent/25 text-accent rounded text-[12px] font-medium transition-colors whitespace-nowrap shrink-0"
          >
            Truy cập trang chủ
          </button>
        </div>
      </Card>
    </div>
  );
}
