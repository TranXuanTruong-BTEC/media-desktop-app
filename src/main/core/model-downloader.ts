/**
 * src/main/core/model-downloader.ts
 * Tải model whisper (ggml) từ Hugging Face về userData/models, có kiểm tra SHA-1 ghim sẵn.
 *
 * Bảo mật: chỉ https tới huggingface.co / *.hf.co (kể cả khi redirect), giới hạn kích thước,
 * timeout khi im lặng, ghi vào file .part rồi mới đổi tên sau khi SHA-1 khớp.
 */

import fs from "fs";
import path from "path";
import https from "https";
import crypto from "crypto";
import { IncomingMessage } from "http";
import { app } from "electron";
import { resolveSafeRedirect } from "./security.js";
import { WhisperModel, MODEL_HOSTS, modelUrl } from "./transcribe-utils.js";

export function getModelsDir(): string {
  return path.join(app.getPath("userData"), "models");
}

export function modelPath(m: WhisperModel): string {
  return path.join(getModelsDir(), m.file);
}

/** Đã tải đủ? (kiểm tra kích thước — hash đã được xác minh lúc tải về) */
export function isModelInstalled(m: WhisperModel): boolean {
  try {
    const st = fs.statSync(modelPath(m));
    return st.isFile() && st.size >= m.sizeMB * 1024 * 1024 * 0.9;
  } catch {
    return false;
  }
}

function open(url: string, depth = 0): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (depth > 6) { reject(new Error("Quá nhiều redirect")); return; }
    const req = https.get(url, { headers: { "User-Agent": "media-desktop-app" }, timeout: 30_000 }, (res) => {
      const code = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(code)) {
        res.resume();
        const next = res.headers.location ? resolveSafeRedirect(res.headers.location, url, MODEL_HOSTS) : null;
        if (!next) { reject(new Error("Redirect không an toàn — đã chặn")); return; }
        open(next.toString(), depth + 1).then(resolve, reject);
        return;
      }
      if (code !== 200) { res.resume(); reject(new Error(`HTTP ${code}`)); return; }
      resolve(res);
    });
    req.on("timeout", () => req.destroy(new Error("Hết thời gian chờ phản hồi")));
    req.on("error", reject);
  });
}

export interface ModelDownloadHandle {
  promise: Promise<void>;
  cancel: () => void;
}

export function downloadModel(
  m: WhisperModel,
  onProgress: (percent: number, receivedMB: number, totalMB: number) => void,
): ModelDownloadHandle {
  let cancelled = false;
  let current: IncomingMessage | null = null;
  const dest = modelPath(m);
  const tmp  = `${dest}.part`;
  const maxBytes = Math.ceil(m.sizeMB * 1024 * 1024 * 1.2);

  const promise = (async () => {
    fs.mkdirSync(getModelsDir(), { recursive: true });
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }

    const res = await open(modelUrl(m.file));
    current = res;
    if (cancelled) { res.destroy(); throw new Error("Đã huỷ"); }

    const total = parseInt(res.headers["content-length"] ?? "0", 10) || m.sizeMB * 1024 * 1024;
    if (total > maxBytes) { res.destroy(); throw new Error("Kích thước file không như mong đợi"); }

    const sha1 = crypto.createHash("sha1");
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      let received = 0, lastPct = -1, failed = false;
      const fail = (e: Error) => { if (failed) return; failed = true; res.destroy(); out.destroy(); reject(e); };

      res.on("data", (c: Buffer) => {
        received += c.length;
        if (received > maxBytes) { fail(new Error("File vượt quá kích thước cho phép")); return; }
        sha1.update(c);
        const pct = Math.min(100, Math.floor((received / total) * 100));
        if (pct !== lastPct) { lastPct = pct; onProgress(pct, received / 1048576, total / 1048576); }
      });
      res.on("error", fail);
      res.on("close", () => { if (!res.complete) fail(new Error(cancelled ? "Đã huỷ" : "Kết nối bị ngắt giữa chừng")); });
      out.on("error", fail);
      out.on("close", () => { if (!failed && res.complete) resolve(); });
      res.pipe(out);
    }).catch((e) => { try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ } throw e; });

    if (sha1.digest("hex") !== m.sha1) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      throw new Error("SHA-1 của model không khớp — file tải về đã bị từ chối");
    }
    fs.renameSync(tmp, dest);
  })();

  return {
    promise,
    cancel: () => { cancelled = true; try { current?.destroy(); } catch { /* ignore */ } },
  };
}
