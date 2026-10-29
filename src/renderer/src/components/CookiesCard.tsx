import React, { useCallback, useEffect, useState } from "react";
import type { CookiesStatus } from "../electron.d";

const DOUYIN_URL = "https://www.douyin.com/";

export function CookiesCard() {
  const [status, setStatus] = useState<CookiesStatus | null>(null);
  const [text, setText]     = useState("");
  const [msg, setMsg]       = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy]     = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const refresh = useCallback(async () => {
    try { setStatus(await window.api.getCookiesStatus()); } catch { /* ignore */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function run(fn: () => Promise<{ ok: boolean; message: string; status: CookiesStatus; canceled?: boolean } | null>, clearText = false) {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      if (!r) return;
      setStatus(r.status);
      if (r.canceled) return;
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok && clearText) setText("");
    } finally { setBusy(false); }
  }

  async function clear() {
    setBusy(true); setMsg(null);
    try { setStatus(await window.api.clearCookies()); setMsg({ ok: true, text: "Đã xoá cookie Douyin." }); }
    finally { setBusy(false); }
  }

  const label = status?.exists
    ? `Đã nhập ${status.count} cookie${status.hasSvWebId ? "" : " (thiếu s_v_web_id)"}`
    : "Chưa có cookie";

  const btn = "h-8 px-3 rounded text-[12px] transition-colors whitespace-nowrap disabled:opacity-50";
  return (
    <section className="rounded-xl border border-[#252a38] bg-[#181c27] p-4">
      <h2 className="text-[13px] font-semibold text-text">Cookie Douyin</h2>
      <p className="text-[11px] text-muted mt-0.5 mb-3">
        Douyin yêu cầu cookie mới của trình duyệt mới tải được video. Cookie chỉ lưu trên máy bạn, và app chỉ giữ cookie của douyin.com.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`flex-1 min-w-[160px] text-[12px] ${status?.exists ? "text-subtle" : "text-muted"}`}>{label}</p>
        <div className="flex gap-2 shrink-0">
          <button type="button" disabled={busy} onClick={() => run(() => window.api.importCookiesFile())}
            className={`${btn} bg-accent/15 hover:bg-accent/25 text-accent font-medium`}>
            Chọn file cookies.txt…
          </button>
          {status?.exists && (
            <button type="button" disabled={busy} onClick={clear}
              className={`${btn} bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text`}>
              Xoá
            </button>
          )}
        </div>
      </div>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        spellCheck={false}
        rows={3}
        placeholder="Hoặc dán vào đây: nội dung cookies.txt, hoặc chuỗi cookie (a=1; b=2; ...)"
        className="mt-3 w-full resize-y px-3 py-2 bg-[#0f1117] border border-[#3a4258] rounded text-[12px] text-subtle placeholder:text-muted font-mono outline-none focus:border-accent"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !text.trim()} onClick={() => run(() => window.api.importCookiesText(text), true)}
          className={`${btn} bg-accent/15 hover:bg-accent/25 text-accent font-medium`}>
          Lưu cookie đã dán
        </button>
        <button type="button" onClick={() => setShowHelp(v => !v)}
          className="text-[11px] text-muted hover:text-subtle underline-offset-2 hover:underline">
          {showHelp ? "Ẩn hướng dẫn" : "Cách lấy cookie?"}
        </button>
      </div>

      {msg && <p className={`mt-2 text-[12px] ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}

      {showHelp && (
        <div className="mt-3 rounded-lg bg-[#0f1117] border border-[#252a38] p-3 text-[11px] text-subtle space-y-2 leading-relaxed">
          <p className="font-medium text-text">Cách nhanh (không cần tiện ích):</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>Mở <button type="button" className="text-accent hover:underline" onClick={() => window.api && (window as any).api.openExternal?.(DOUYIN_URL)}>douyin.com</button> trên trình duyệt và chờ trang tải xong (nên mở thử 1 video).</li>
            <li>Nhấn <b>F12</b> → tab <b>Console</b>, gõ <code className="text-accent">document.cookie</code> rồi Enter.</li>
            <li>Sao chép chuỗi kết quả (bỏ dấu nháy ở hai đầu), dán vào ô trên và bấm <b>Lưu cookie đã dán</b>.</li>
          </ol>
          <p className="font-medium text-text pt-1">Hoặc dùng file:</p>
          <p>Cài tiện ích <b>Get cookies.txt LOCALLY</b>, mở douyin.com, xuất file cookies.txt (định dạng Netscape) rồi bấm <b>Chọn file cookies.txt…</b></p>
          <p className="text-muted">Cookie hết hạn sau một thời gian — nếu Douyin lại báo lỗi, hãy nhập lại cookie mới.</p>
        </div>
      )}
    </section>
  );
}
