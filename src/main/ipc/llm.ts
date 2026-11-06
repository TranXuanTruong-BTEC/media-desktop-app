// src/main/ipc/llm.ts
// IPC cho cài đặt AI dịch. Giao diện không bao giờ nhận lại API key: key chỉ nằm ở main (mã hoá bằng safeStorage)
// và được đưa thẳng vào tiến trình dịch qua getLlmRuntime().
import { ipcMain, BrowserWindow, app, safeStorage } from "electron";
import path from "path";
import { IPC, LlmSettingsView, LlmResult } from "../../shared/ipc-types.js";
import { LlmStore, sanitizeSave } from "../core/llm-store.js";
import { pingModel, validateBaseUrl, DEFAULT_BASE } from "../core/llm.js";
import type { LlmRuntime } from "../core/llm-translate.js";
import { logger } from "../core/logger.js";
import { isTrustedSender } from "./guard.js";

let store: LlmStore | null = null;
const getStore = () => (store ??= new LlmStore(path.join(app.getPath("userData"), "llm-settings.json"), {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b),
}));

function view(): LlmSettingsView {
  const st = getStore();
  return { ...st.settings, hasKey: st.hasKey(), encryptionAvailable: st.encryptionAvailable };
}

function baseOf(s = getStore().settings): string {
  return validateBaseUrl(s.baseUrl, s.provider) ?? DEFAULT_BASE[s.provider];
}

/** Dùng ở main để chạy dịch bằng AI. Trả về lỗi tiếng Việt nếu chưa cấu hình xong. */
export function getLlmRuntime(): { ok: true; rt: LlmRuntime } | { ok: false; error: string } {
  const st = getStore(), s = st.settings, key = st.getKey();
  if (!key) {
    return { ok: false, error: st.hasKey()
      ? "Không đọc được API key đã lưu (đổi tài khoản Windows?). Hãy nhập lại key trong phần cài đặt AI."
      : "Chưa có API key. Hãy nhập key trong phần cài đặt AI hoặc chọn Google Dịch." };
  }
  return { ok: true, rt: { cfg: { provider: s.provider, apiKey: key, model: s.model, baseUrl: baseOf(s) }, review: s.review } };
}

export function registerLlmHandlers(win: BrowserWindow) {
  ipcMain.handle(IPC.LLM_GET_SETTINGS, (evt): LlmSettingsView | null =>
    isTrustedSender(evt, win, IPC.LLM_GET_SETTINGS) ? view() : null);

  ipcMain.handle(IPC.LLM_SAVE_SETTINGS, (evt, raw: unknown): LlmResult => {
    if (!isTrustedSender(evt, win, IPC.LLM_SAVE_SETTINGS)) return { ok: false, error: "Yêu cầu bị từ chối." };
    const st = getStore();
    const s = sanitizeSave(raw, st.settings);
    if (!s.ok) return { ok: false, error: s.error };
    try {
      const err = st.apply(s);
      if (err) return { ok: false, error: err };
    } catch (e) {
      logger.error("ipc:llm", "Không lưu được cài đặt AI", e);
      return { ok: false, error: "Không lưu được cài đặt." };
    }
    return { ok: true, settings: view() };
  });

  ipcMain.handle(IPC.LLM_TEST, async (evt): Promise<LlmResult> => {
    if (!isTrustedSender(evt, win, IPC.LLM_TEST)) return { ok: false, error: "Yêu cầu bị từ chối." };
    const rt = getLlmRuntime();
    if (!rt.ok) return { ok: false, error: rt.error };
    const r = await pingModel(rt.rt.cfg, { log: (m, x) => logger.info("llm:test", m, x) });
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  });
}
