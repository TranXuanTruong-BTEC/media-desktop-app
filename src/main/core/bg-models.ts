// src/main/core/bg-models.ts
// Danh mục mô hình tách nền (ONNX, từ dự án rembg) + tải về máy ở lần dùng đầu tiên.
// Mọi file tải về đều được kiểm SHA-256 ghim sẵn trong code (đã đối chiếu với md5 do rembg công bố) rồi mới dùng;
// chỉ tải từ GitHub. Không phụ thuộc electron.
import fs from "fs";
import path from "path";
import type { BgModelId } from "../../shared/ipc-types.js";
import { UserFacingError } from "./douyin.js";
import { downloadToFile } from "./http-download.js";
import { fileDigest, isAllowedHost, GITHUB_HOSTS } from "./security.js";

export interface BgModel {
  id: BgModelId;
  label: string;
  desc: string;
  file: string;
  sha256: string;
  sizeBytes: number;
  sizeMb: number;
  /** Cạnh ảnh đưa vào mô hình (vuông). */
  size: number;
  mean: [number, number, number];
  std: [number, number, number];
  kind: "u2" | "isnet";
}

const IMAGENET_MEAN: [number, number, number] = [0.485, 0.456, 0.406];
const IMAGENET_STD:  [number, number, number] = [0.229, 0.224, 0.225];

export const BG_RELEASE = "https://github.com/danielgatis/rembg/releases/download/v0.0.0";

export const BG_MODELS: Record<BgModelId, BgModel> = {
  fast: {
    id: "fast", label: "Nhanh", desc: "Rất nhẹ (4,6 MB), nhanh nhất. Chất lượng thấp hơn: có thể mất chi tiết mảnh như tay, chân, tóc; chỉ giữ vật thể chính. Hợp ảnh đơn giản.",
    file: "u2netp.onnx", sha256: "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8",
    sizeBytes: 4574861, sizeMb: 5, size: 320, mean: IMAGENET_MEAN, std: IMAGENET_STD, kind: "u2",
  },
  general: {
    id: "general", label: "Tổng quát (khuyên dùng)", desc: "Cân bằng chất lượng và tốc độ; giữ mọi đối tượng nổi bật (người, xe, đồ vật, động vật).",
    file: "isnet-general-use.onnx", sha256: "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a",
    sizeBytes: 178648008, sizeMb: 170, size: 1024, mean: [0.5, 0.5, 0.5], std: [1, 1, 1], kind: "isnet",
  },
  portrait: {
    id: "portrait", label: "Chân dung", desc: "Chỉ giữ NGƯỜI trong ảnh (bỏ xe, đồ vật xung quanh); nhanh hơn model tổng quát.",
    file: "u2net_human_seg.onnx", sha256: "01eb6a29a5c4d8edb30b56adad9bb3a2a0535338e480724a213e0acfd2d1c73c",
    sizeBytes: 175997641, sizeMb: 168, size: 320, mean: IMAGENET_MEAN, std: IMAGENET_STD, kind: "u2",
  },
};
export const BG_ORDER: readonly BgModelId[] = ["general", "fast", "portrait"];

export const isBgModelId = (v: unknown): v is BgModelId => typeof v === "string" && Object.prototype.hasOwnProperty.call(BG_MODELS, v);
export const bgModelUrl = (m: BgModel) => `${BG_RELEASE}/${m.file}`;

export const bgModelsDir = (baseDir: string) => path.join(baseDir, "models");
export const bgModelPath = (baseDir: string, id: BgModelId) => path.join(bgModelsDir(baseDir), BG_MODELS[id].file);

/** Đã tải đủ? (kích thước phải khớp đúng; mã kiểm tra đã được xác minh lúc tải) */
export function isBgModelInstalled(baseDir: string, id: BgModelId): boolean {
  try { const st = fs.statSync(bgModelPath(baseDir, id)); return st.isFile() && st.size === BG_MODELS[id].sizeBytes; } catch { return false; }
}

export interface BgInstallOptions { signal: AbortSignal; onProgress: (percent: number, message: string) => void; allowPrivate?: boolean; }
export interface BgModelOverrides { url?: string; sha256?: string; allowHost?: (h: string) => boolean; }

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; }
    catch (e) { if (i >= 4) throw e; await new Promise(r => setTimeout(r, 400)); }   // Windows: antivirus có thể đang quét file vừa tải
  }
}

/** Đảm bảo mô hình đã có trên máy; trả về đường dẫn tuyệt đối. */
export async function ensureBgModel(baseDir: string, id: BgModelId, o: BgInstallOptions, ov: BgModelOverrides = {}): Promise<string> {
  const dest = bgModelPath(baseDir, id);
  if (isBgModelInstalled(baseDir, id)) return dest;
  const m = BG_MODELS[id];
  const part = `${dest}.part`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;
  try {
    o.onProgress(0, `Đang tải mô hình "${m.label}" (~${m.sizeMb} MB, chỉ tải một lần)...`);
    await downloadToFile(ov.url ?? bgModelUrl(m), part, {
      headers: { "User-Agent": "MediaGet", Accept: "application/octet-stream" },
      signal: o.signal,
      allowPrivate: o.allowPrivate,
      allowHost: ov.allowHost ?? (h => isAllowedHost(h, GITHUB_HOSTS)),
      idleMs: 60_000,
      onProgress: (done, total) => o.onProgress(total ? (done / total) * 100 : 0, `Đang tải mô hình "${m.label}" (${mb(done)} / ${total ? mb(total) : `~${m.sizeMb} MB`})...`),
    });
    o.onProgress(100, "Đang kiểm tra mô hình vừa tải...");
    if ((await fileDigest(part, "sha256")) !== (ov.sha256 ?? m.sha256)) {
      throw new UserFacingError("Mô hình tải về bị hỏng hoặc không đúng bản (sai mã kiểm tra). Hãy thử tải lại.");
    }
    await renameWithRetry(part, dest);
  } finally {
    try { fs.rmSync(part, { force: true }); } catch { /* ignore */ }
  }
  return dest;
}
