// src/main/core/llm.ts
// Gọi mô hình ngôn ngữ (Claude qua Messages API, hoặc API tương thích OpenAI: OpenAI, Gemini, Ollama...).
// Không import electron; fetch/sleep được truyền vào nên test được bằng máy chủ giả.
import type { LlmProvider } from "../../shared/ipc-types.js";
import { UserFacingError } from "./douyin.js";

export interface ProviderConfig { provider: LlmProvider; apiKey: string; model: string; baseUrl: string; }
export interface Usage { inTokens: number; outTokens: number; }
export interface HttpDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  /** Thời gian chờ tối đa cho MỘT yêu cầu (mặc định 180 giây). Quá hạn được coi là lỗi tạm thời và thử lại. */
  timeoutMs?: number;
  log?: (message: string, extra?: unknown) => void;
}

export const DEFAULT_BASE: Record<LlmProvider, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
};
export const DEFAULT_MODEL: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-5-5",
  openai: "gemini-3.1-pro-preview",
};
export const GEMINI_OPENAI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Chỉ https (hoặc http tới máy chính mình, vd. Ollama). Không user:pass/query. Trả về URL chuẩn hoá (không "/" cuối). */
export function validateBaseUrl(raw: unknown, provider: LlmProvider): string | null {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_BASE[provider];
  if (typeof raw !== "string" || raw.length > 200) return null;
  try {
    const u = new URL(raw.trim());
    if (u.username || u.password || u.search || u.hash) return null;
    const ok = u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.has(u.hostname));
    if (!ok) return null;
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch { return null; }
}

export function isValidModelName(m: unknown): m is string {
  return typeof m === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(m);
}

export function endpointFor(cfg: Pick<ProviderConfig, "provider" | "baseUrl">): string {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  return cfg.provider === "anthropic" ? `${base.replace(/\/v1$/, "")}/v1/messages` : `${base}/chat/completions`;
}

class RetryableError extends Error { constructor(m: string, readonly retryAfterMs?: number) { super(m); } }

export const realSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new UserFacingError("Đã huỷ."));
  const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(new UserFacingError("Đã huỷ.")); };
  signal?.addEventListener("abort", onAbort, { once: true });
});

export interface ModelRequest { system: string; userText: string; maxTokens: number; }
export interface ModelReply { text: string; usage: Usage; }

function buildBody(cfg: ProviderConfig, req: ModelRequest): unknown {
  if (cfg.provider === "anthropic") {
    return { model: cfg.model, max_tokens: req.maxTokens, system: req.system, messages: [{ role: "user", content: req.userText }] };
  }
  return { model: cfg.model, messages: [{ role: "system", content: req.system }, { role: "user", content: req.userText }] };
}

function headersFor(cfg: ProviderConfig): Record<string, string> {
  return cfg.provider === "anthropic"
    ? { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" }
    : { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` };
}

function apiMessage(bodyText: string): string {
  try { const j = JSON.parse(bodyText); const e = Array.isArray(j) ? j[0] : j; return String(e?.error?.message ?? e?.message ?? e?.error ?? "").slice(0, 300); } catch { return bodyText.slice(0, 200); }
}

async function callOnce(cfg: ProviderConfig, req: ModelRequest, deps: HttpDeps): Promise<ModelReply> {
  const f = deps.fetch ?? fetch;
  const timeout = AbortSignal.timeout(deps.timeoutMs ?? 180_000);
  const signal = deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout;
  let res: Response, body: string;
  try {
    res = await f(endpointFor(cfg), { method: "POST", headers: headersFor(cfg), body: JSON.stringify(buildBody(cfg, req)), signal });
    body = await res.text();                                    // đọc thân phản hồi cũng nằm trong thời hạn
  } catch (e: any) {
    if (deps.signal?.aborted) throw new UserFacingError("Đã huỷ.");
    if (timeout.aborted) throw new RetryableError("máy chủ AI không phản hồi kịp");
    throw new RetryableError(`không kết nối được: ${e?.cause?.code ?? e?.message ?? e}`);
  }
  if (res.status === 200) {
    let j: any;
    try { j = JSON.parse(body); } catch { throw new RetryableError("phản hồi không phải JSON"); }
    if (cfg.provider === "anthropic") {
      const text = (Array.isArray(j.content) ? j.content : []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
      return { text, usage: { inTokens: j.usage?.input_tokens ?? 0, outTokens: j.usage?.output_tokens ?? 0 } };
    }
    const text = j?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new RetryableError("phản hồi thiếu nội dung");
    return { text, usage: { inTokens: j.usage?.prompt_tokens ?? 0, outTokens: j.usage?.completion_tokens ?? 0 } };
  }

  const msg = apiMessage(body);
  const ra = parseFloat(res.headers.get("retry-after") ?? "");
  if (res.status === 429 || res.status === 529 || res.status >= 500) {
    if (/credit|billing|quota exceeded|insufficient/i.test(msg) && res.status !== 529) throw new UserFacingError(`Tài khoản API hết hạn mức/credit: ${msg}`);
    throw new RetryableError(`HTTP ${res.status} ${msg}`, Number.isFinite(ra) ? Math.min(60, ra) * 1000 : undefined);
  }
  if (res.status === 401 || res.status === 403) throw new UserFacingError("API key không hợp lệ hoặc không có quyền dùng model này. Hãy kiểm tra lại key trong phần cài đặt AI.");
  if (res.status === 404) throw new UserFacingError(`Không tìm thấy model "${cfg.model}" (hoặc địa chỉ API sai). ${msg}`.trim());
  throw new UserFacingError(`API từ chối yêu cầu (HTTP ${res.status}): ${msg}`);
}

/** Gọi có retry/backoff cho lỗi tạm thời (429, 5xx, 529, mạng). */
export async function callModel(cfg: ProviderConfig, req: ModelRequest, deps: HttpDeps, maxAttempts = 5): Promise<ModelReply> {
  const sleep = deps.sleep ?? realSleep;
  let last = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callOnce(cfg, req, deps);
    } catch (e) {
      if (!(e instanceof RetryableError)) throw e;
      last = e.message;
      deps.log?.("API lỗi tạm thời, sẽ thử lại", { attempt, err: last });
      if (attempt === maxAttempts) break;
      await sleep(e.retryAfterMs ?? Math.min(20000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400), deps.signal);
    }
  }
  throw new UserFacingError(`Không gọi được dịch vụ AI sau nhiều lần thử (${last}).`);
}

/** Kiểm tra key/model/địa chỉ bằng một yêu cầu rất nhỏ. */
export async function pingModel(cfg: ProviderConfig, deps: HttpDeps): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await callModel(cfg, { system: "Trả lời ngắn gọn.", userText: "Chỉ trả lời đúng một từ: OK", maxTokens: 16 }, deps, 2);
    return { ok: true, message: r.text.trim() ? "Kết nối thành công." : "Kết nối thành công (phản hồi rỗng)." };
  } catch (e: any) {
    return { ok: false, message: e instanceof UserFacingError ? e.message : `Lỗi: ${e?.message ?? e}` };
  }
}
