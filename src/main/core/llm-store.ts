// src/main/core/llm-store.ts
// Lưu cài đặt AI dịch + API key. Key được mã hoá bằng hệ điều hành (Electron safeStorage → DPAPI trên Windows)
// và KHÔNG bao giờ được trả về giao diện. Không import electron: bộ mã hoá được truyền vào để test.
import fs from "fs";
import path from "path";
import type { LlmProvider, LlmSettings, LlmSettingsSave } from "../../shared/ipc-types.js";
import { DEFAULT_MODEL, isValidModelName, validateBaseUrl } from "./llm.js";

export interface SecretCrypto { available(): boolean; encrypt(plain: string): Buffer; decrypt(data: Buffer): string; }

export const DEFAULT_SETTINGS: LlmSettings = { provider: "anthropic", model: DEFAULT_MODEL.anthropic, baseUrl: "", review: true };

const PROVIDERS: readonly LlmProvider[] = ["anthropic", "openai"];
export const isProvider = (p: unknown): p is LlmProvider => PROVIDERS.includes(p as LlmProvider);

export type SanitizeResult = { ok: true; settings: Partial<LlmSettings>; apiKey?: string; clearKey: boolean } | { ok: false; error: string };

/** Kiểm tra dữ liệu cài đặt từ giao diện (không tin renderer). */
export function sanitizeSave(raw: unknown, current: LlmSettings): SanitizeResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Dữ liệu không hợp lệ." };
  const r = raw as LlmSettingsSave;
  const out: Partial<LlmSettings> = {};
  const provider = r.provider === undefined ? current.provider : r.provider;
  if (!isProvider(provider)) return { ok: false, error: "Nhà cung cấp không hợp lệ." };
  if (r.provider !== undefined) out.provider = provider;
  if (r.model !== undefined) {
    if (!isValidModelName(r.model)) return { ok: false, error: "Tên model không hợp lệ (chỉ chữ, số, . _ : / -)." };
    out.model = r.model;
  }
  if (r.baseUrl !== undefined) {
    const v = r.baseUrl === "" ? "" : validateBaseUrl(r.baseUrl, provider);
    if (v === null) return { ok: false, error: "Địa chỉ API không hợp lệ (phải là https://..., hoặc http://localhost cho máy bạn)." };
    out.baseUrl = r.baseUrl === "" ? "" : v;
  }
  if (r.review !== undefined) { if (typeof r.review !== "boolean") return { ok: false, error: "Dữ liệu không hợp lệ." }; out.review = r.review; }
  let apiKey: string | undefined;
  if (r.apiKey !== undefined) {
    // eslint-disable-next-line no-control-regex
    if (typeof r.apiKey !== "string" || r.apiKey.trim().length < 8 || r.apiKey.length > 400 || /[\s\u0000-\u001f]/.test(r.apiKey.trim())) {
      return { ok: false, error: "API key không hợp lệ (không chứa khoảng trắng, dài 8–400 ký tự)." };
    }
    apiKey = r.apiKey.trim();
  }
  return { ok: true, settings: out, apiKey, clearKey: r.clearKey === true };
}

interface FileShape { settings: LlmSettings; keys: Partial<Record<LlmProvider, string>>; }

export class LlmStore {
  private data: FileShape = { settings: { ...DEFAULT_SETTINGS }, keys: {} };
  constructor(private file: string, private crypto: SecretCrypto) { this.load(); }

  private load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, "utf8"));
      const s = j?.settings ?? {};
      const provider: LlmProvider = isProvider(s.provider) ? s.provider : DEFAULT_SETTINGS.provider;
      this.data.settings = {
        provider,
        model: isValidModelName(s.model) ? s.model : DEFAULT_MODEL[provider],
        baseUrl: s.baseUrl === "" || validateBaseUrl(s.baseUrl, provider) ? (s.baseUrl ?? "") : "",
        review: typeof s.review === "boolean" ? s.review : DEFAULT_SETTINGS.review,
      };
      for (const p of PROVIDERS) if (typeof j?.keys?.[p] === "string") this.data.keys[p] = j.keys[p];
    } catch { /* chưa có file / hỏng → dùng mặc định */ }
  }

  private persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get settings(): LlmSettings { return { ...this.data.settings }; }
  get encryptionAvailable(): boolean { return this.crypto.available(); }
  hasKey(p: LlmProvider = this.data.settings.provider): boolean { return !!this.data.keys[p]; }

  getKey(p: LlmProvider = this.data.settings.provider): string | null {
    const enc = this.data.keys[p];
    if (!enc || !this.crypto.available()) return null;
    try { return this.crypto.decrypt(Buffer.from(enc, "base64")); } catch { return null; }   // máy/tài khoản khác → không giải mã được
  }

  /** Trả về lỗi (tiếng Việt) hoặc null nếu thành công. */
  apply(s: Extract<SanitizeResult, { ok: true }>): string | null {
    const provider = s.settings.provider ?? this.data.settings.provider;
    if (s.apiKey !== undefined && !this.crypto.available()) return "Máy này không hỗ trợ mã hoá để lưu API key an toàn.";
    this.data.settings = { ...this.data.settings, ...s.settings };
    if (s.apiKey !== undefined) this.data.keys[provider] = this.crypto.encrypt(s.apiKey).toString("base64");
    if (s.clearKey) delete this.data.keys[provider];
    this.persist();
    return null;
  }
}
