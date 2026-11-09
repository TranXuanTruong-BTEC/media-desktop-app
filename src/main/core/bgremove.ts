// src/main/core/bgremove.ts
// Tách nền ảnh bằng mô hình AI chạy trên máy (ONNX). Không phụ thuộc electron; ffmpeg và phiên chạy mô hình được truyền vào.
//
//   ffmpeg → ảnh gốc RGBA (BMP qua pipe)  +  ảnh thu nhỏ RGB đưa vào mô hình
//   mô hình → mặt nạ (S×S) → phóng to bilinear lên kích thước ảnh gốc → (làm sạch viền) → ghép nền → PNG bằng ffmpeg
// Dùng ffmpeg sẵn có của app để đọc/ghi mọi định dạng ảnh (PNG, JPG, WebP, BMP, GIF...) và tự xoay theo EXIF.
import fs from "fs";
import path from "path";
import { spawn as nodeSpawn, ChildProcess, SpawnOptions } from "child_process";
import type { BgBackground } from "../../shared/ipc-types.js";
import { UserFacingError } from "./douyin.js";
import type { BgModel } from "./bg-models.js";

export type SpawnFn = (cmd: string, args: readonly string[], opts: SpawnOptions) => ChildProcess;

/** Phiên chạy mô hình: nhận tensor NCHW float32 [1,3,S,S], trả về mặt nạ thô S×S. */
export interface MaskSession { run(input: Float32Array, size: number): Promise<ArrayLike<number>>; }

export interface Rgba { width: number; height: number; data: Uint8Array; }   // data: RGBA, dài w*h*4

// ─── Kiểm tra đầu vào ────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "jfif", "jpe", "webp", "bmp", "gif", "tif", "tiff", "avif"]);
export const IMAGE_EXT_LIST: string[] = [...IMAGE_EXTS];
export const MAX_IMAGE_FILE_BYTES = 120 * 1024 * 1024;
export const MAX_PIXELS = 100_000_000;               // ~100 megapixel

export function isImageFile(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0 || p.length > 1024 || p.includes("\0")) return false;
  return IMAGE_EXTS.has(path.extname(p).slice(1).toLowerCase());
}

export function parseHexColor(s: unknown): [number, number, number] | null {
  if (typeof s !== "string") return null;
  const m = /^#([0-9a-fA-F]{6})$/.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function validateBackground(b: unknown): BgBackground | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  if (o.type === "transparent") return { type: "transparent" };
  if (o.type === "mask") return { type: "mask" };
  if (o.type === "color" && parseHexColor(o.color)) return { type: "color", color: (o.color as string).trim().toLowerCase() };
  return null;
}

// ─── Thuần hàm xử lý ảnh / mặt nạ ────────────────────────────────────────────

/** BMP 24/32-bit không nén (đúng định dạng ffmpeg xuất ra) → RGBA. */
export function parseBmp(buf: Buffer): Rgba {
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) throw new UserFacingError("Không đọc được ảnh này.");
  const off = buf.readUInt32LE(10);
  const w = buf.readInt32LE(18);
  const hRaw = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const comp = buf.readUInt32LE(30);
  const h = Math.abs(hRaw), topDown = hRaw < 0;
  if (w <= 0 || h === 0 || (bpp !== 32 && bpp !== 24) || (comp !== 0 && comp !== 3)) throw new UserFacingError("Định dạng ảnh không được hỗ trợ.");
  if (w * h > MAX_PIXELS) throw new UserFacingError(`Ảnh quá lớn (${w}×${h}). Giới hạn khoảng 100 megapixel.`);
  const bytes = bpp / 8, stride = Math.ceil((w * bpp) / 32) * 4;
  if (buf.length < off + stride * h - (stride - w * bytes)) throw new UserFacingError("File ảnh bị cắt dở.");
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    let src = off + (topDown ? y : h - 1 - y) * stride, dst = y * w * 4;
    for (let x = 0; x < w; x++, src += bytes, dst += 4) {
      data[dst] = buf[src + 2]; data[dst + 1] = buf[src + 1]; data[dst + 2] = buf[src];     // BGR → RGB
      data[dst + 3] = bytes === 4 ? buf[src + 3] : 255;
    }
  }
  return { width: w, height: h, data };
}

/**
 * Chuẩn hoá giống rembg: chia cho giá trị lớn nhất của cả ảnh, trừ mean, chia std; sắp theo kênh (NCHW).
 * rgb: S*S*3 byte (đã thu nhỏ về S×S).
 */
export function preprocessRgb(rgb: Uint8Array, size: number, mean: readonly number[], std: readonly number[]): Float32Array {
  const n = size * size;
  if (rgb.length !== n * 3) throw new Error(`ảnh thu nhỏ sai kích thước: ${rgb.length} ≠ ${n * 3}`);
  let max = 0;
  for (let i = 0; i < rgb.length; i++) if (rgb[i] > max) max = rgb[i];
  const inv = 1 / Math.max(max, 1e-6);
  const out = new Float32Array(n * 3);
  for (let c = 0; c < 3; c++) {
    const m = mean[c], s = std[c], base = c * n;
    for (let i = 0; i < n; i++) out[base + i] = (rgb[i * 3 + c] * inv - m) / s;
  }
  return out;
}

/** Đầu ra thô → mặt nạ 0..1 (co giãn min–max như rembg). */
export function postprocessMask(raw: ArrayLike<number>, size: number): Float32Array {
  const n = size * size;
  if (raw.length < n) throw new Error(`đầu ra mô hình quá ngắn: ${raw.length} < ${n}`);
  const out = new Float32Array(n);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    out[i] = v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const range = mx - mn;
  if (!(range > 1e-6)) { out.fill(1); return out; }      // ảnh phẳng, mô hình không phân biệt được → giữ nguyên toàn bộ
  const inv = 1 / range;
  for (let i = 0; i < n; i++) out[i] = (out[i] - mn) * inv;
  return out;
}

/** Phóng mặt nạ S×S lên w×h bằng nội suy bilinear → alpha 0..255. */
export function upscaleMask(mask: Float32Array, s: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const x0 = new Int32Array(w), x1 = new Int32Array(w), xw = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const f = ((x + 0.5) * s) / w - 0.5, i = Math.floor(f);
    xw[x] = f - i; x0[x] = Math.min(s - 1, Math.max(0, i)); x1[x] = Math.min(s - 1, Math.max(0, i + 1));
  }
  for (let y = 0; y < h; y++) {
    const f = ((y + 0.5) * s) / h - 0.5, i = Math.floor(f), wy = f - i;
    const r0 = Math.min(s - 1, Math.max(0, i)) * s, r1 = Math.min(s - 1, Math.max(0, i + 1)) * s;
    let o = y * w;
    for (let x = 0; x < w; x++, o++) {
      const a = mask[r0 + x0[x]] * (1 - xw[x]) + mask[r0 + x1[x]] * xw[x];
      const b = mask[r1 + x0[x]] * (1 - xw[x]) + mask[r1 + x1[x]] * xw[x];
      const v = (a * (1 - wy) + b * wy) * 255;
      out[o] = v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0;
    }
  }
  return out;
}

/** Làm sạch viền: kéo các giá trị gần 0/1 về hẳn 0/1 để bớt quầng mờ nhưng vẫn giữ độ mềm ở giữa. */
export function refineAlpha(alpha: Uint8Array, lo = 0.06, hi = 0.94): void {
  const a = lo * 255, k = 255 / ((hi - lo) * 255);
  for (let i = 0; i < alpha.length; i++) {
    const v = (alpha[i] - a) * k;
    alpha[i] = v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0;
  }
}

export interface Composited { width: number; height: number; channels: 3 | 4; data: Uint8Array; }

/** Ghép alpha vào ảnh gốc theo kiểu nền. Alpha sẵn có của ảnh gốc (PNG trong suốt) được nhân vào. */
export function composite(img: Rgba, alpha: Uint8Array, bg: BgBackground): Composited {
  const n = img.width * img.height, src = img.data;
  if (alpha.length !== n) throw new Error("alpha sai kích thước");
  if (bg.type === "transparent") {
    const out = new Uint8Array(n * 4);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      out[p] = src[p]; out[p + 1] = src[p + 1]; out[p + 2] = src[p + 2];
      out[p + 3] = src[p + 3] === 255 ? alpha[i] : Math.round((alpha[i] * src[p + 3]) / 255);
    }
    return { width: img.width, height: img.height, channels: 4, data: out };
  }
  const out = new Uint8Array(n * 3);
  if (bg.type === "mask") {
    for (let i = 0, p = 0; i < n; i++, p += 3) { const v = src[i * 4 + 3] === 255 ? alpha[i] : Math.round((alpha[i] * src[i * 4 + 3]) / 255); out[p] = out[p + 1] = out[p + 2] = v; }
    return { width: img.width, height: img.height, channels: 3, data: out };
  }
  const [br, bgc, bb] = parseHexColor(bg.color)!;
  for (let i = 0, p = 0, q = 0; i < n; i++, p += 3, q += 4) {
    const a = src[q + 3] === 255 ? alpha[i] : Math.round((alpha[i] * src[q + 3]) / 255), ia = 255 - a;
    out[p]     = (src[q]     * a + br  * ia + 127) / 255 | 0;
    out[p + 1] = (src[q + 1] * a + bgc * ia + 127) / 255 | 0;
    out[p + 2] = (src[q + 2] * a + bb  * ia + 127) / 255 | 0;
  }
  return { width: img.width, height: img.height, channels: 3, data: out };
}

// ─── ffmpeg ──────────────────────────────────────────────────────────────────

export interface FfDeps { ffmpeg: string; spawn?: SpawnFn; env?: NodeJS.ProcessEnv; signal?: AbortSignal; }

function runFfmpeg(args: string[], deps: FfDeps, stdin?: Uint8Array, maxStdout = 700 * 1024 * 1024): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (deps.signal?.aborted) return reject(new UserFacingError("Đã huỷ."));
    const doSpawn: SpawnFn = deps.spawn ?? ((c, a, o) => nodeSpawn(c, a as string[], o));
    const c = doSpawn(deps.ffmpeg, args, { windowsHide: true, env: deps.env, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0, err = "", tooBig = false;
    const onAbort = () => { try { c.kill(); } catch { /* ignore */ } };
    deps.signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => deps.signal?.removeEventListener("abort", onAbort);

    c.stdout?.on("data", (b: Buffer) => { size += b.length; if (size > maxStdout) { tooBig = true; try { c.kill(); } catch { /* ignore */ } } else chunks.push(b); });
    c.stderr?.setEncoding("utf8");
    c.stderr?.on("data", (d: string) => { err = (err + d).slice(-4000); });
    c.stdin?.on("error", () => { /* ffmpeg đóng stdin sớm (lỗi) → lỗi thật sẽ báo qua mã thoát */ });
    c.on("error", (e) => { done(); reject(new UserFacingError(`Không chạy được ffmpeg: ${e.message}`)); });
    c.on("close", (code) => {
      done();
      if (deps.signal?.aborted) return reject(new UserFacingError("Đã huỷ."));
      if (tooBig) return reject(new UserFacingError("Ảnh quá lớn để xử lý."));
      if (code !== 0) {
        const last = err.split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop() ?? "";
        return reject(new UserFacingError(`Không đọc/ghi được ảnh (ffmpeg): ${last || `mã ${code}`}`));
      }
      resolve({ stdout: Buffer.concat(chunks), stderr: err });
    });
    if (stdin) c.stdin?.end(Buffer.from(stdin.buffer, stdin.byteOffset, stdin.byteLength)); else c.stdin?.end();
  });
}

const base = ["-hide_banner", "-nostdin", "-loglevel", "error", "-protocol_whitelist", "file,pipe"];

export async function decodeImage(input: string, deps: FfDeps): Promise<Rgba> {
  const r = await runFfmpeg([...base, "-i", input, "-frames:v", "1", "-an", "-sn", "-pix_fmt", "bgra", "-f", "image2pipe", "-c:v", "bmp", "-"], deps);
  return parseBmp(r.stdout);
}

/** Ảnh thu nhỏ về size×size RGB (Lanczos) đúng như rembg đưa vào mô hình. */
export async function decodeResizedRgb(input: string, size: number, deps: FfDeps): Promise<Uint8Array> {
  const r = await runFfmpeg([...base, "-i", input, "-frames:v", "1", "-an", "-sn", "-vf", `scale=${size}:${size}:flags=lanczos,format=rgb24`, "-f", "rawvideo", "-"], deps, undefined, size * size * 3 + 1024);
  if (r.stdout.length !== size * size * 3) throw new UserFacingError("Không thu nhỏ được ảnh để phân tích.");
  return new Uint8Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length);
}

export async function encodePng(img: Composited, outPath: string, deps: FfDeps): Promise<void> {
  const tmp = `${outPath}.${process.pid}.tmp.png`;
  try {
    await runFfmpeg([...base, "-y", "-f", "rawvideo", "-pixel_format", img.channels === 4 ? "rgba" : "rgb24", "-video_size", `${img.width}x${img.height}`,
      "-i", "pipe:0", "-frames:v", "1", "-update", "1", tmp], deps, img.data, 1024 * 1024);
    fs.renameSync(tmp, outPath);
  } finally { try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ } }
}

/** PNG nhỏ (cạnh dài ≤ maxSide) từ một file ảnh bất kỳ — dùng làm ảnh xem trước (giữ độ trong suốt). */
export async function makePreviewPng(input: string, maxSide: number, deps: FfDeps): Promise<Buffer> {
  const vf = `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))':flags=area`;
  const r = await runFfmpeg([...base, "-i", input, "-frames:v", "1", "-an", "-sn", "-vf", vf, "-f", "image2pipe", "-c:v", "png", "-"], deps, undefined, 64 * 1024 * 1024);
  if (r.stdout.length < 50) throw new UserFacingError("Không tạo được ảnh xem trước.");
  return r.stdout;
}

// ─── Quy trình đầy đủ ────────────────────────────────────────────────────────

export interface RemoveOptions { model: BgModel; background: BgBackground; refine: boolean; }
export interface RemoveDeps extends FfDeps {
  session: MaskSession;
  onStage?: (stage: "decode" | "analyze" | "compose" | "save", percent: number) => void;
}
export interface RemoveResult { width: number; height: number; hasAlpha: boolean; }

const tick = () => new Promise<void>(r => setImmediate(r));       // nhường vòng lặp sự kiện giữa các bước nặng để giao diện không đơ

export async function removeBackground(input: string, outPng: string, opt: RemoveOptions, deps: RemoveDeps): Promise<RemoveResult> {
  const check = () => { if (deps.signal?.aborted) throw new UserFacingError("Đã huỷ."); };
  const st = fs.statSync(input);
  if (!st.isFile()) throw new UserFacingError("Không đọc được file ảnh.");
  if (st.size > MAX_IMAGE_FILE_BYTES) throw new UserFacingError("File ảnh quá lớn (tối đa 120 MB).");

  deps.onStage?.("decode", 0);
  const img = await decodeImage(input, deps); check();
  const small = await decodeResizedRgb(input, opt.model.size, deps); check();
  deps.onStage?.("analyze", 0);
  await tick();
  const tensor = preprocessRgb(small, opt.model.size, opt.model.mean, opt.model.std);
  const raw = await deps.session.run(tensor, opt.model.size); check();
  deps.onStage?.("compose", 0);
  await tick();
  const mask = postprocessMask(raw, opt.model.size);
  const alpha = upscaleMask(mask, opt.model.size, img.width, img.height);
  if (opt.refine) refineAlpha(alpha);
  await tick(); check();
  const out = composite(img, alpha, opt.background);
  deps.onStage?.("save", 0);
  await encodePng(out, outPng, deps);
  return { width: img.width, height: img.height, hasAlpha: out.channels === 4 };
}
