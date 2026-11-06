// src/renderer/src/components/LlmSettingsCard.tsx — cài đặt AI dịch (Claude / Gemini / OpenAI / tương thích)
import React, { useEffect, useState } from "react";
import type { LlmApi } from "../hooks/useLlmSettings";
import type { LlmProvider } from "../../../shared/ipc-types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL: Record<LlmProvider, string> = { anthropic: "claude-sonnet-5-5", openai: "gemini-3.1-pro-preview" };
const MODEL_PRESETS: Record<LlmProvider, string[]> = {
  anthropic: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  openai: ["gemini-3.1-pro-preview", "gemini-2.5-flash", "gpt-4o-mini"],
};

const input = "w-full px-3 py-1.5 bg-[#0f1117] border border-[#3a4258] rounded text-[12px] text-text placeholder:text-muted outline-none focus:border-accent";
const btn = "h-8 px-3 rounded text-[12px] transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed";

export function LlmSettingsCard({ llm, disabled }: { llm: LlmApi; disabled?: boolean }) {
  const { settings, busy, notice, save, test, clearKey } = llm;
  const [draft, setDraft] = useState({ provider: "anthropic" as LlmProvider, model: "", baseUrl: "", review: true, apiKey: "" });
  const [open, setOpen] = useState(false);

  // Đồng bộ form từ cài đặt đã lưu (key không bao giờ được trả về nên ô key luôn trống)
  useEffect(() => {
    if (!settings) return;
    setDraft({ provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl, review: settings.review, apiKey: "" });
    if (!settings.hasKey) setOpen(true);
  }, [settings]);

  if (!settings) return null;
  const off = disabled || busy;

  const setProvider = (p: LlmProvider) => setDraft(d => ({
    ...d, provider: p, baseUrl: "",
    model: !d.model || d.model === DEFAULT_MODEL[d.provider] ? DEFAULT_MODEL[p] : d.model,
  }));

  const persistAndTest = async () => {
    const ok = await save({
      provider: draft.provider, model: draft.model.trim(), baseUrl: draft.baseUrl.trim(), review: draft.review,
      ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
    });
    if (ok) await test();
  };

  return (
    <div className="mt-3 rounded-lg border border-[#252a38] bg-[#141823] p-3">
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300 mb-2.5">
        Bước dịch bằng AI <b>gửi văn bản lời thoại</b> (không gửi video/âm thanh) tới nhà cung cấp bạn chọn, và có thể tốn phí theo bảng giá của họ.
        API key chỉ lưu trên máy này, được mã hoá bằng Windows.
      </div>

      <button type="button" onClick={() => setOpen(o => !o)} className="text-[12px] text-accent hover:underline">
        {open ? "Ẩn cài đặt AI" : settings.hasKey ? `Cài đặt AI · ${settings.model} · đã có API key` : "Cài đặt AI · cần nhập API key"}
      </button>

      {open && (
        <div className="space-y-2.5 mt-2.5">
          <label className="block">
            <span className="text-[11px] text-subtle">Nhà cung cấp</span>
            <select className={input} value={draft.provider} onChange={e => setProvider(e.target.value as LlmProvider)} disabled={off}>
              <option value="anthropic">Claude (Anthropic)</option>
              <option value="openai">Gemini / OpenAI / API tương thích OpenAI</option>
            </select>
          </label>

          {draft.provider === "openai" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted">Điền nhanh:</span>
              <button type="button" disabled={off} className={`${btn} h-7 bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text`}
                onClick={() => setDraft(d => ({ ...d, baseUrl: GEMINI_BASE, model: "gemini-3.1-pro-preview" }))}>Google Gemini</button>
              <button type="button" disabled={off} className={`${btn} h-7 bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text`}
                onClick={() => setDraft(d => ({ ...d, baseUrl: "", model: "gpt-4o-mini" }))}>OpenAI</button>
            </div>
          )}

          <label className="block">
            <span className="text-[11px] text-subtle">Model {draft.provider === "openai" && "(đúng tên model của nhà cung cấp)"}</span>
            <input className={input} list="llm-models" value={draft.model} onChange={e => setDraft(d => ({ ...d, model: e.target.value }))} disabled={off} spellCheck={false} />
            <datalist id="llm-models">{MODEL_PRESETS[draft.provider].map(m => <option key={m} value={m} />)}</datalist>
          </label>

          {draft.provider === "openai" && (
            <label className="block">
              <span className="text-[11px] text-subtle">Địa chỉ API (để trống = OpenAI)</span>
              <input className={input} placeholder="https://api.openai.com/v1" value={draft.baseUrl} onChange={e => setDraft(d => ({ ...d, baseUrl: e.target.value }))} disabled={off} spellCheck={false} />
              <span className="block text-[10px] text-muted mt-0.5 break-all">Gemini: {GEMINI_BASE} · Ollama (chạy trên máy bạn): http://localhost:11434/v1</span>
            </label>
          )}

          <label className="block">
            <span className="text-[11px] text-subtle">API key {settings.hasKey && <span className="text-emerald-400">· đã lưu</span>}</span>
            <input className={input} type="password" autoComplete="off" spellCheck={false} value={draft.apiKey} disabled={off}
              placeholder={settings.hasKey ? "Nhập key mới nếu muốn thay" : "Dán API key vào đây"} onChange={e => setDraft(d => ({ ...d, apiKey: e.target.value }))} />
            {!settings.encryptionAvailable && <span className="block text-[10px] text-red-400 mt-0.5">Máy này không hỗ trợ mã hoá nên không thể lưu API key.</span>}
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5 accent-[#3b82f6]" checked={draft.review} disabled={off} onChange={e => setDraft(d => ({ ...d, review: e.target.checked }))} />
            <span className="text-[12px] text-text">Soát lại bản dịch bằng lượt AI thứ hai <span className="text-muted">(sửa xưng hô/tên không thống nhất, câu dịch máy móc; chậm và tốn token hơn một chút — khuyên dùng)</span></span>
          </label>

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button type="button" disabled={off || !draft.model.trim()} onClick={() => void persistAndTest()}
              className={`${btn} bg-accent/15 hover:bg-accent/25 text-accent font-medium`}>Lưu &amp; kiểm tra kết nối</button>
            {settings.hasKey && (
              <button type="button" disabled={off} onClick={() => void clearKey()}
                className={`${btn} bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text`}>Xoá API key</button>
            )}
          </div>
        </div>
      )}
      {notice && <p className={`mt-2 text-[12px] break-words ${notice.error ? "text-red-400" : "text-emerald-400"}`}>{notice.text}</p>}
    </div>
  );
}
