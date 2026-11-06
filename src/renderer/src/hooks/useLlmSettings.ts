// src/renderer/src/hooks/useLlmSettings.ts — cài đặt AI dịch (API key không bao giờ về lại giao diện)
import { useCallback, useEffect, useRef, useState } from "react";
import type { LlmSettingsSave, LlmSettingsView } from "../../../shared/ipc-types";

export function useLlmSettings() {
  const [settings, setSettings] = useState<LlmSettingsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((text: string, error = false) => {
    if (timer.current) clearTimeout(timer.current);
    setNotice({ text, error });
    timer.current = setTimeout(() => setNotice(null), 7000);
  }, []);

  const refresh = useCallback(async () => {
    try { const s = await window.api.getLlmSettings(); if (s) setSettings(s); } catch { /* ignore */ }
  }, []);
  useEffect(() => { void refresh(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [refresh]);

  const save = useCallback(async (req: LlmSettingsSave): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await window.api.saveLlmSettings(req);
      if (!r.ok) { show(r.error ?? "Không lưu được cài đặt.", true); return false; }
      if (r.settings) setSettings(r.settings);
      return true;
    } finally { setBusy(false); }
  }, [show]);

  const test = useCallback(async () => {
    setBusy(true);
    try {
      const r = await window.api.testLlm();
      show(r.ok ? (r.message ?? "Kết nối thành công.") : (r.error ?? "Không kết nối được."), !r.ok);
      return r.ok;
    } finally { setBusy(false); }
  }, [show]);

  const clearKey = useCallback(async () => { if (await save({ clearKey: true })) show("Đã xoá API key."); }, [save, show]);

  return { settings, busy, notice, save, test, clearKey };
}
export type LlmApi = ReturnType<typeof useLlmSettings>;
