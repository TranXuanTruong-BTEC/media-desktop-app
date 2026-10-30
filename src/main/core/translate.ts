// src/main/core/translate.ts
// Dịch khối lời thoại Trung → Việt (gửi văn bản, không gửi file). Thuần logic + HTTP, không import electron.
import https from "https";
import http from "http";
import { UserFacingError } from "./douyin.js";
import { isAllowedHost } from "./security.js";

export const TRANSLATE_HOSTS: readonly string[] = ["translate.googleapis.com", "api.mymemory.translated.net"];

export type GetJsonFn = (url: string, signal: AbortSignal) => Promise<unknown>;

const MAX_Q = 1600;

export function packNumbered(lines: readonly string[]): string {
  return lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
}

/** Gỡ bản dịch đánh số 1. / 1) / 1、 — null nếu không khớp đủ số dòng. */
export function unpackNumbered(text: string, expected: number): string[] | null {
  if (expected <= 0) return [];
  const map = new Map<number, string>();
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const m = /^\s*(\d{1,3})\s*[.)、:]\s*(.*)$/.exec(raw);
    if (!m) continue;
    const n = Number(m[1]);
    if (n >= 1 && n <= expected) map.set(n, m[2].trim());
  }
  if (map.size !== expected) return null;
  const out: string[] = [];
  for (let i = 1; i <= expected; i++) {
    const t = map.get(i);
    if (t == null || t === "") return null;
    out.push(t);
  }
  return out;
}

export function splitAligned(text: string, expected: number): string[] | null {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length !== expected) return null;
  return lines;
}

export function parseGtxResponse(data: unknown): string {
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new UserFacingError("Máy chủ dịch trả về dữ liệu không hợp lệ.");
  }
  let out = "";
  for (const part of data[0]) {
    if (Array.isArray(part) && typeof part[0] === "string") out += part[0];
  }
  return out.trim();
}

export function parseMyMemoryResponse(data: unknown): string {
  const obj = data && typeof data === "object" ? data as Record<string, unknown> : null;
  const rd = obj?.responseData && typeof obj.responseData === "object" ? obj.responseData as Record<string, unknown> : null;
  const t = rd && typeof rd.translatedText === "string" ? rd.translatedText.trim() : "";
  const status = obj && typeof obj.responseStatus === "number" ? obj.responseStatus : 0;
  if (!t || (status !== 0 && status !== 200)) {
    throw new UserFacingError("Máy chủ dịch phụ không trả về bản dịch.");
  }
  return t;
}

function gtxUrl(q: string): string {
  const u = new URL("https://translate.googleapis.com/translate_a/single");
  u.searchParams.set("client", "gtx");
  u.searchParams.set("sl", "zh-CN");
  u.searchParams.set("tl", "vi");
  u.searchParams.set("dt", "t");
  u.searchParams.set("ie", "UTF-8");
  u.searchParams.set("oe", "UTF-8");
  u.searchParams.set("q", q);
  return u.toString();
}

function myMemoryUrl(q: string): string {
  const u = new URL("https://api.mymemory.translated.net/get");
  u.searchParams.set("langpair", "zh-CN|vi");
  u.searchParams.set("q", q);
  return u.toString();
}

export function httpsGetJson(url: string, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { return reject(new UserFacingError("Địa chỉ máy chủ dịch không hợp lệ.")); }
    if (!isAllowedHost(host, TRANSLATE_HOSTS)) {
      return reject(new UserFacingError("Máy chủ dịch không nằm trong danh sách cho phép."));
    }
    const lib = url.startsWith("https:") ? https : http;
    const fail = (e: Error) => reject(e);
    const req = lib.get(url, {
      headers: { "User-Agent": "MediaGet/2 (translate)", Accept: "application/json,text/plain;q=0.9,*/*;q=0.8" },
      timeout: 20_000,
    }, (res) => {
      const code = res.statusCode ?? 0;
      if (code !== 200) {
        res.resume();
        return fail(new UserFacingError(`Máy chủ dịch trả về HTTP ${code}.`));
      }
      const chunks: Buffer[] = [];
      let n = 0;
      res.on("data", (b: Buffer) => {
        n += b.length;
        if (n > 1_000_000) { res.destroy(); return fail(new UserFacingError("Phản hồi dịch quá lớn.")); }
        chunks.push(b);
      });
      res.on("error", fail);
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try { resolve(JSON.parse(raw) as unknown); }
        catch { fail(new UserFacingError("Máy chủ dịch trả về dữ liệu không phải JSON.")); }
      });
    });
    req.on("timeout", () => { req.destroy(); fail(new UserFacingError("Hết thời gian chờ máy chủ dịch.")); });
    req.on("error", (e) => fail(new UserFacingError(`Không kết nối được máy chủ dịch: ${e.message}`)));
    const onAbort = () => { req.destroy(); fail(new UserFacingError("cancelled")); };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    req.on("close", () => signal.removeEventListener("abort", onAbort));
  });
}

function looksTranslated(src: string[], out: string[]): boolean {
  if (src.length !== out.length) return false;
  let changed = 0;
  for (let i = 0; i < src.length; i++) {
    if (out[i] && out[i] !== src[i]) changed++;
  }
  return changed > 0 || src.every(s => s.length === 0);
}

async function translatePacked(packed: string, signal: AbortSignal, getJson: GetJsonFn): Promise<string> {
  try {
    return parseGtxResponse(await getJson(gtxUrl(packed), signal));
  } catch (e) {
    if (signal.aborted) throw e;
    return parseMyMemoryResponse(await getJson(myMemoryUrl(packed), signal));
  }
}

export async function translateZhToVi(
  lines: readonly string[],
  signal: AbortSignal,
  getJson: GetJsonFn = httpsGetJson,
): Promise<string[]> {
  const src = lines.map(l => l.replace(/\s+/g, " ").trim());
  if (src.length === 0) return [];
  if (src.every(s => s === "")) return [...src];

  const packed = packNumbered(src);
  if (packed.length <= MAX_Q) {
    const raw = await translatePacked(packed, signal, getJson);
    const numbered = unpackNumbered(raw, src.length);
    if (numbered && looksTranslated(src, numbered)) return numbered;
    const aligned = splitAligned(raw, src.length);
    if (aligned && looksTranslated(src, aligned)) return aligned;
  }

  const out: string[] = [];
  for (const line of src) {
    if (signal.aborted) throw new UserFacingError("cancelled");
    if (!line) { out.push(line); continue; }
    const raw = await translatePacked(line, signal, getJson);
    out.push(raw || line);
  }
  return out;
}
