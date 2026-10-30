// src/main/core/douyin-download.ts
// Tải video Douyin: dữ liệu video lấy từ cửa sổ trình duyệt của app (douyin-extract.ts), file tải bằng Node thuần.
// Không import electron/logger để có thể test độc lập.
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import type { Downloader } from "./downloader.js";
import type { DownloadRequest } from "../../shared/ipc-types.js";
import { DouyinMedia, UserFacingError, pickCandidate, safeFilename } from "./douyin.js";
import { downloadToFile, uniquePath } from "./http-download.js";

export { downloadToFile, uniquePath };   // giữ nguyên API cũ (test + nơi gọi hiện có)

const UA_FALLBACK =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// ─── Tiện ích ────────────────────────────────────────────────────────────────

const fmtBytes = (n: number) => `${(n / 1048576).toFixed(2)}MiB`;
const fmtEta = (sec: number) => {
  if (!Number.isFinite(sec) || sec < 0) return "Unknown";
  const s = Math.round(sec);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function convertAudio(ffmpeg: string, input: string, output: string, kind: "mp3" | "m4a", setChild: (c: ChildProcess | null) => void): Promise<void> {
  const codec = kind === "mp3" ? ["-c:a", "libmp3lame", "-q:a", "2"] : ["-c:a", "aac", "-b:a", "192k"];
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-vn", ...codec, output], { windowsHide: true });
    setChild(child);
    let err = "";
    child.stderr?.on("data", (d: Buffer) => { if (err.length < 2000) err += d.toString(); });
    child.on("error", (e) => { setChild(null); reject(e); });
    child.on("close", (code) => {
      setChild(null);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg lỗi (mã ${code}): ${err.trim().split("\n").pop() ?? ""}`));
    });
  });
}

// ─── Điều phối ───────────────────────────────────────────────────────────────

export interface DouyinDeps {
  extract(url: string): { promise: Promise<DouyinMedia>; cancel(): void };
  ffmpeg(): string | null;
  userAgent?: string;
  log?(message: string, extra?: unknown): void;
  allowPrivate?: boolean;   // test
}

export function startDouyinDownload(
  req: DownloadRequest,
  deps: DouyinDeps,
): { emitter: Downloader; cancel: (sync?: boolean) => void } {
  const emitter = new EventEmitter() as Downloader;
  const ac = new AbortController();
  let cancelled = false;
  let extraction: ReturnType<DouyinDeps["extract"]> | null = null;
  let child: ChildProcess | null = null;

  const cancel = () => {
    cancelled = true;
    ac.abort();
    extraction?.cancel();
    try { child?.kill(); } catch { /* ignore */ }
  };

  const status = (text: string, percent = 0) =>
    emitter.emit("progress", { id: req.id, percent, speed: "", eta: "", filename: text, size: "" });

  const isAudio = req.quality === "audio_mp3" || req.quality === "audio_m4a";

  void (async () => {
    let tmpDir: string | null = null;
    let partPath: string | null = null;
    try {
      await new Promise<void>(r => setImmediate(r));   // để nơi gọi kịp gắn listener trước sự kiện đầu tiên
      if (cancelled) return;
      status("Đang lấy thông tin video từ Douyin...");
      extraction = deps.extract(req.url);
      const media = await extraction.promise;
      if (cancelled) return;

      const cand = pickCandidate(media.candidates, req.quality);
      if (!cand) {
        throw new UserFacingError(
          media.isImagePost
            ? "Đây là bài đăng dạng ảnh, không có video để tải."
            : "Douyin không trả về link video nào cho bài này (video có thể bị ẩn hoặc giới hạn).");
      }
      deps.log?.("Đã chọn bản tải", { id: media.id, h: cand.height, w: cand.width, hevc: cand.hevc, links: cand.urls.length });

      const base = safeFilename(media.title, `douyin_${media.id}`);
      const ext = req.quality === "audio_mp3" ? ".mp3" : req.quality === "audio_m4a" ? ".m4a" : ".mp4";
      const finalPath = uniquePath(req.outputDir, base, ext);
      const finalName = path.basename(finalPath);

      if (isAudio) {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mediaget-"));
        partPath = path.join(tmpDir, "video.mp4");
      } else {
        partPath = finalPath + ".part";
      }

      const scale = isAudio ? 0.95 : 1;   // phần còn lại dành cho bước tách âm thanh
      const headers = { "User-Agent": deps.userAgent ?? UA_FALLBACK, Referer: "https://www.douyin.com/", Accept: "*/*" };

      let lastEmit = 0, lastBytes = 0, lastTime = Date.now(), speed = 0;
      const onProgress = (done: number, total: number) => {
        const now = Date.now();
        if (now - lastEmit < 250 && !(total && done >= total)) return;
        const dt = (now - lastTime) / 1000;
        if (dt > 0) speed = speed ? speed * 0.6 + ((done - lastBytes) / dt) * 0.4 : (done - lastBytes) / dt;
        lastEmit = now; lastTime = now; lastBytes = done;
        emitter.emit("progress", {
          id: req.id,
          percent: total ? Math.min(100, (done / total) * 100) * scale : 0,
          speed: `${fmtBytes(speed)}/s`,
          eta: total && speed > 0 ? fmtEta((total - done) / speed) : "Unknown",
          filename: finalName,
          size: total ? fmtBytes(total) : fmtBytes(done),
        });
      };

      let lastErr: Error | null = null;
      let ok = false;
      for (let pass = 1; pass <= 2 && !ok && !cancelled; pass++) {
        for (const url of cand.urls) {
          if (cancelled) break;
          try {
            await downloadToFile(url, partPath, { headers, signal: ac.signal, onProgress, allowPrivate: deps.allowPrivate });
            ok = true;
            break;
          } catch (e) {
            if (cancelled) return;
            lastErr = e as Error;
            deps.log?.("Link tải thất bại", { pass, err: lastErr.message });
          }
        }
      }
      if (cancelled) return;
      if (!ok) throw new Error(lastErr?.message ?? "không rõ nguyên nhân");

      if (isAudio) {
        const ffmpeg = deps.ffmpeg();
        if (!ffmpeg) throw new UserFacingError("Cần ffmpeg để tách âm thanh nhưng không tìm thấy ffmpeg.exe.");
        status(finalName, 95);
        await convertAudio(ffmpeg, partPath, finalPath, req.quality === "audio_mp3" ? "mp3" : "m4a", c => { child = c; });
      } else {
        fs.renameSync(partPath, finalPath);
        partPath = null;
      }
      if (cancelled) { try { fs.rmSync(finalPath, { force: true }); } catch { /* ignore */ } return; }

      emitter.emit("complete", {
        id: req.id,
        filepath: finalPath,
        filename: finalName,
        warning: !isAudio && cand.hevc
          ? "Video dùng mã hoá HEVC (H.265). Nếu máy không phát được, hãy cài codec HEVC hoặc chọn chất lượng thấp hơn."
          : undefined,
      });
    } catch (err) {
      if (cancelled) return;
      const e = err as Error;
      deps.log?.("Tải Douyin thất bại", { err: e.message });
      emitter.emit("error", {
        id: req.id,
        message: e instanceof UserFacingError ? e.message : `Không tải được video Douyin: ${e.message}`,
      });
    } finally {
      try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      try { if (partPath) fs.rmSync(partPath, { force: true }); } catch { /* ignore */ }
    }
  })();

  return { emitter, cancel };
}
