import React, { useEffect, useRef, useState } from "react";
import { YtdlpUpdaterState } from "../hooks/useYtdlpUpdater";
import { UpdaterState } from "../hooks/useUpdater";
import type { CookiesStatus, CookiesResult } from "../../../shared/ipc-types";

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

const COOKIES_PLACEHOLDER =
  "# Netscape HTTP Cookie File\n.tiktok.com\tTRUE\t/\tTRUE\t1793673935\tten_cookie\tgia_tri";

function CookiesCard() {
  const [status, setStatus]   = useState<CookiesStatus | null>(null);
  const [text, setText]       = useState("");
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.api.getCookiesStatus().then(setStatus).catch(() => setStatus(null));
    return () => { if (clearTimer.current) clearTimeout(clearTimer.current); };
  }, []);

  const applyResult = (r: CookiesResult, okMessage: (s: CookiesStatus) => string) => {
    if (r.canceled) return;
    if (r.ok && r.status) {
      setStatus(r.status);
      setMsg({ ok: true, text: okMessage(r.status) });
    } else {
      setMsg({ ok: false, text: r.error ?? "Có lỗi xảy ra." });
    }
  };

  const run = async (fn: () => Promise<CookiesResult>, okMessage: (s: CookiesStatus) => string) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      applyResult(r, okMessage);
      return r;
    } catch {
      setMsg({ ok: false, text: "Có lỗi xảy ra. Hãy thử lại." });
    } finally {
      setBusy(false);
    }
  };

  const savedMsg = (s: CookiesStatus) => `Đã lưu ${s.count} cookie từ ${s.totalDomains} trang.`;

  const handleSave = async () => {
    if (!text.trim()) { setMsg({ ok: false, text: "Hãy dán nội dung cookies.txt vào ô bên trên." }); return; }
    const r = await run(() => window.api.saveCookies(text), savedMsg);
    if (r?.ok) setText("");   // không giữ cookie trong bộ nhớ giao diện sau khi đã lưu
  };

  const handleClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      clearTimer.current = setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setConfirmClear(false);
    void run(() => window.api.clearCookies(), () => "Đã xoá cookies.");
  };

  const hasCookies = !!status?.exists;
  const btnBase = "h-8 px-3 rounded text-[12px] transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <Card
      title="Cookies đăng nhập"
      hint="Dùng cho các trang yêu cầu đăng nhập hoặc cookie mới (Douyin, TikTok, nội dung giới hạn...). Chỉ lưu trên máy này."
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="flex-1 min-w-[160px] text-[12px] text-subtle">
          {hasCookies
            ? `Đang dùng ${status!.count} cookie · ${status!.totalDomains} trang`
            : "Chưa có cookies"}
        </p>
        {hasCookies && (
          <button
            type="button"
            onClick={handleClear}
            disabled={busy}
            className={`${btnBase} ${confirmClear ? "bg-red-500/20 text-red-400" : "bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text"}`}
          >
            {confirmClear ? "Bấm lần nữa để xoá" : "Xoá cookies"}
          </button>
        )}
      </div>

      {hasCookies && status!.domains.length > 0 && (
        <p className="text-[11px] text-muted mb-2 break-words">
          {status!.domains.join(", ")}
          {status!.totalDomains > status!.domains.length ? ` và ${status!.totalDomains - status!.domains.length} trang khác` : ""}
        </p>
      )}

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={COOKIES_PLACEHOLDER}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        rows={5}
        className="w-full resize-y px-3 py-2 bg-[#0f1117] border border-[#3a4258] focus:border-accent outline-none rounded text-[11px] font-mono text-subtle placeholder:text-muted/60"
      />

      <div className="flex flex-wrap items-center gap-2 mt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || !text.trim()}
          className={`${btnBase} bg-accent/15 hover:bg-accent/25 text-accent font-medium`}
        >
          {hasCookies ? "Thay bằng cookies mới" : "Lưu cookies"}
        </button>
        <button
          type="button"
          onClick={() => run(() => window.api.importCookies(), savedMsg)}
          disabled={busy}
          className={`${btnBase} bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text`}
        >
          Chọn file cookies.txt...
        </button>
        {msg && (
          <span className={`text-[12px] ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</span>
        )}
      </div>

      <p className="text-[11px] text-muted mt-3 leading-relaxed">
        Cách lấy: đăng nhập trang web trong trình duyệt, dùng tiện ích “Get cookies.txt LOCALLY” để xuất file
        (định dạng Netscape), rồi dán nội dung hoặc chọn file ở đây. Cookies tương đương phiên đăng nhập của bạn —
        đừng chia sẻ cho người khác.
      </p>
    </Card>
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

      <CookiesCard />

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
