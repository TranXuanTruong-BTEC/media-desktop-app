// src/main/core/whisper-install.ts
// Cài công cụ nhận diện (whisper-cli) và mô hình về máy ở lần dùng đầu tiên. Mọi file tải về đều được kiểm checksum
// đã ghim trong code rồi mới dùng; chỉ tải từ GitHub (công cụ) và Hugging Face (mô hình). Không phụ thuộc electron.
import fs from "fs";
import path from "path";
import type { WhisperModelId } from "../../shared/ipc-types.js";
import { UserFacingError } from "./douyin.js";
import { downloadToFile } from "./http-download.js";
import { extractZip } from "./archive.js";
import { fileDigest, isAllowedHost, GITHUB_HOSTS, looksLikeWindowsExe } from "./security.js";
import { WHISPER_MODELS, WHISPER_TAG, WHISPER_ZIP, WHISPER_EXE_REL, HF_HOSTS, modelUrl } from "./whisper.js";

export interface InstallOptions {
  signal: AbortSignal;
  onProgress: (percent: number, message: string) => void;
  allowPrivate?: boolean;   // chỉ test
}

const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;

export function whisperToolDir(baseDir: string): string { return path.join(baseDir, "bin", WHISPER_TAG); }
export function whisperExePath(baseDir: string): string { return path.join(whisperToolDir(baseDir), ...WHISPER_EXE_REL.split("/")); }
export function modelFilePath(baseDir: string, id: WhisperModelId): string { return path.join(baseDir, "models", WHISPER_MODELS[id].file); }
/** Đường dẫn tương đối (dấu /) so với baseDir — dùng khi chạy whisper-cli với cwd = baseDir. */
export function modelRelPath(id: WhisperModelId): string { return `models/${WHISPER_MODELS[id].file}`; }

export function isToolInstalled(baseDir: string): boolean {
  const exe = whisperExePath(baseDir);
  try { return fs.statSync(exe).isFile() && looksLikeWindowsExe(exe); } catch { return false; }
}
export function isModelInstalled(baseDir: string, id: WhisperModelId): boolean {
  try { return fs.statSync(modelFilePath(baseDir, id)).isFile(); } catch { return false; }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; }
    catch (e) {
      if (i >= 4) throw e;
      await new Promise(r => setTimeout(r, 400));   // Windows: antivirus có thể đang quét thư mục vừa giải nén
    }
  }
}

export interface ToolOverrides { zipUrl?: string; zipSha256?: string; allowHost?: (h: string) => boolean; }

/** Đảm bảo whisper-cli đã được cài; trả về đường dẫn tuyệt đối tới whisper-cli.exe. */
export async function ensureWhisperTool(baseDir: string, o: InstallOptions, ov: ToolOverrides = {}): Promise<string> {
  const exe = whisperExePath(baseDir);
  if (isToolInstalled(baseDir)) return exe;

  const dir = whisperToolDir(baseDir);
  const binRoot = path.dirname(dir);
  const tmpDir = `${dir}.tmp`;
  const zip = path.join(binRoot, `whisper-${WHISPER_TAG}.zip.part`);
  fs.mkdirSync(binRoot, { recursive: true });

  try {
    o.onProgress(0, "Đang tải công cụ nhận diện giọng nói (lần đầu)...");
    await downloadToFile(ov.zipUrl ?? WHISPER_ZIP.url, zip, {
      headers: { "User-Agent": "MediaGet", Accept: "application/octet-stream" },
      signal: o.signal,
      allowPrivate: o.allowPrivate,
      allowHost: ov.allowHost ?? (h => isAllowedHost(h, GITHUB_HOSTS)),
      onProgress: (done, total) => o.onProgress(total ? (done / total) * 100 : 0, `Đang tải công cụ nhận diện (${mb(done)}${total ? ` / ${mb(total)}` : ""})...`),
    });

    o.onProgress(100, "Đang kiểm tra công cụ vừa tải...");
    const digest = await fileDigest(zip, "sha256");
    if (digest !== (ov.zipSha256 ?? WHISPER_ZIP.sha256)) {
      throw new UserFacingError("Công cụ nhận diện tải về bị sai mã kiểm tra (SHA-256) nên không được dùng. Hãy thử lại; nếu vẫn lỗi, kiểm tra mạng/phần mềm diệt virus.");
    }

    o.onProgress(100, "Đang giải nén công cụ...");
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    await extractZip(zip, tmpDir);

    const extractedExe = path.join(tmpDir, ...WHISPER_EXE_REL.split("/"));
    if (!fs.existsSync(extractedExe) || !looksLikeWindowsExe(extractedExe)) {
      throw new UserFacingError("Gói công cụ nhận diện không có whisper-cli.exe hợp lệ.");
    }
    fs.rmSync(dir, { recursive: true, force: true });
    await renameWithRetry(tmpDir, dir);
  } finally {
    try { fs.rmSync(zip, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  return exe;
}

export interface ModelOverrides { url?: string; sha1?: string; allowHost?: (h: string) => boolean; }

/** Đảm bảo mô hình đã được tải; trả về đường dẫn tuyệt đối. */
export async function ensureModel(baseDir: string, id: WhisperModelId, o: InstallOptions, ov: ModelOverrides = {}): Promise<string> {
  const dest = modelFilePath(baseDir, id);
  if (isModelInstalled(baseDir, id)) return dest;

  const info = WHISPER_MODELS[id];
  const part = `${dest}.part`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  try {
    o.onProgress(0, `Đang tải mô hình "${info.label}" (~${info.sizeMb} MB, chỉ tải một lần)...`);
    await downloadToFile(ov.url ?? modelUrl(id), part, {
      headers: { "User-Agent": "MediaGet", Accept: "application/octet-stream" },
      signal: o.signal,
      allowPrivate: o.allowPrivate,
      allowHost: ov.allowHost ?? (h => isAllowedHost(h, HF_HOSTS)),
      idleMs: 60_000,
      onProgress: (done, total) => o.onProgress(
        total ? (done / total) * 100 : 0,
        `Đang tải mô hình "${info.label}" (${mb(done)} / ${total ? mb(total) : `~${info.sizeMb} MB`})...`,
      ),
    });

    o.onProgress(100, "Đang kiểm tra mô hình vừa tải...");
    const digest = await fileDigest(part, "sha1");
    if (digest !== (ov.sha1 ?? info.sha1)) {
      throw new UserFacingError("Mô hình tải về bị hỏng hoặc không đúng bản (sai mã kiểm tra). Hãy thử tải lại.");
    }
    await renameWithRetry(part, dest);
  } finally {
    try { fs.rmSync(part, { force: true }); } catch { /* ignore */ }
  }
  return dest;
}
