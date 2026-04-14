/**
 * src/main/core/ytdlp-updater.ts
 *
 * Tự động kiểm tra và cập nhật yt-dlp.exe khi app khởi động.
 * Hoàn toàn độc lập với IPC / BrowserWindow — chỉ phát event qua EventEmitter.
 *
 * Flow:
 *   1. Đọc version yt-dlp đang có   (chạy `yt-dlp.exe --version`)
 *   2. Gọi GitHub API lấy tag mới nhất
 *   3. Nếu version cũ → tải yt-dlp.exe mới về tools/, thay thế file cũ
 *   4. Phát event "status" suốt quá trình để IPC/UI cập nhật
 */

import { EventEmitter } from "events";
import { execFileSync }  from "child_process";
import path              from "path";
import fs                from "fs";
import https             from "https";
import { app }           from "electron";
import { getToolsDir, getYtDlpPath } from "./downloader.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type YtdlpUpdatePhase =
  | { phase: "checking" }
  | { phase: "up-to-date";   version: string }
  | { phase: "update-found"; current: string; latest: string }
  | { phase: "downloading";  percent: number; latest: string }
  | { phase: "updated";      version: string }
  | { phase: "error";        message: string }
  | { phase: "not-found" };

export interface YtdlpUpdaterEvents {
  status: (s: YtdlpUpdatePhase) => void;
}

export interface YtdlpUpdaterEmitter extends EventEmitter {
  on<K extends keyof YtdlpUpdaterEvents>(event: K, listener: YtdlpUpdaterEvents[K]): this;
  emit<K extends keyof YtdlpUpdaterEvents>(event: K, ...args: Parameters<YtdlpUpdaterEvents[K]>): boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GITHUB_API_URL = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

const YTDLP_DOWNLOAD_URL = (tag: string) =>
  `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}/yt-dlp.exe`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Lấy version yt-dlp.exe đang có. Trả null nếu không tồn tại hoặc lỗi. */
function getCurrentVersion(ytDlpPath: string): string | null {
  if (!fs.existsSync(ytDlpPath)) return null;
  try {
    return execFileSync(ytDlpPath, ["--version"], {
      encoding: "utf8",
      timeout: 8000,
    }).trim();
  } catch {
    return null;
  }
}

/** Gọi GitHub API lấy tag release mới nhất (e.g. "2025.03.31"). */
function fetchLatestTag(): Promise<string> {
  return new Promise((resolve, reject) => {
    function get(url: string, depth = 0) {
      if (depth > 5) { reject(new Error("Quá nhiều redirect")); return; }

      https.get(url, { headers: { "User-Agent": "media-desktop-app" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          get(res.headers.location!, depth + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API trả về ${res.statusCode}`));
          res.resume();
          return;
        }
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            const tag: string = json.tag_name;
            if (!tag) throw new Error("Không tìm thấy tag_name trong response");
            resolve(tag.replace(/^v/, ""));
          } catch (e: any) {
            reject(new Error("Parse GitHub response thất bại: " + e.message));
          }
        });
      }).on("error", reject);
    }

    get(GITHUB_API_URL);
  });
}

/**
 * Tải file từ URL về destPath, hỗ trợ redirect.
 * Ghi vào .tmp trước, rename sau khi xong để tránh corrupt file cũ.
 */
function downloadFile(
  url: string,
  destPath: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    function get(currentUrl: string, depth = 0) {
      if (depth > 5) { reject(new Error("Quá nhiều redirect")); return; }

      https.get(currentUrl, { headers: { "User-Agent": "media-desktop-app" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          get(res.headers.location!, depth + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download trả về HTTP ${res.statusCode}`));
          res.resume();
          return;
        }

        const total    = parseInt(res.headers["content-length"] ?? "0", 10);
        let received   = 0;
        const tmpPath  = destPath + ".tmp";
        const out      = fs.createWriteStream(tmpPath);

        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (total > 0) onProgress(Math.round((received / total) * 100));
        });

        res.pipe(out);

        out.on("finish", () => {
          out.close(() => {
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
              fs.renameSync(tmpPath, destPath);
              resolve();
            } catch (e: any) {
              reject(e);
            }
          });
        });

        out.on("error", (e) => {
          fs.unlink(tmpPath, () => {});
          reject(e);
        });
      }).on("error", reject);
    }

    get(url);
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Kiểm tra và (nếu cần) tải bản yt-dlp mới nhất.
 *
 * @param force  Nếu true, tải lại kể cả khi version đã mới nhất
 * @returns      EventEmitter phát "status" liên tục đến khi kết thúc
 *
 * @example
 * const em = checkAndUpdateYtDlp();
 * em.on("status", s => {
 *   if (s.phase === "downloading") console.log(s.percent + "%");
 *   if (s.phase === "updated")     console.log("Updated to", s.version);
 * });
 */
export function checkAndUpdateYtDlp(force = false): YtdlpUpdaterEmitter {
  const emitter = new EventEmitter() as YtdlpUpdaterEmitter;

  (async () => {
    const ytDlpPath = getYtDlpPath();
    const toolsDir  = getToolsDir();

    // Đảm bảo thư mục tools/ tồn tại
    if (!fs.existsSync(toolsDir)) {
      fs.mkdirSync(toolsDir, { recursive: true });
    }

    emitter.emit("status", { phase: "checking" });

    const current = getCurrentVersion(ytDlpPath);

    // Dev mode và chưa có file → chỉ báo not-found, không tự tải
    if (current === null && !app.isPackaged) {
      emitter.emit("status", { phase: "not-found" });
      return;
    }

    // Lấy tag mới nhất từ GitHub
    let latest: string;
    try {
      latest = await fetchLatestTag();
    } catch (e: any) {
      emitter.emit("status", { phase: "error", message: "Không thể kiểm tra phiên bản mới: " + e.message });
      return;
    }

    const needsUpdate = force || current === null || current !== latest;

    if (!needsUpdate) {
      emitter.emit("status", { phase: "up-to-date", version: current! });
      return;
    }

    emitter.emit("status", { phase: "update-found", current: current ?? "(chưa có)", latest });

    if (!app.isPackaged) {
      console.log(`[ytdlp-updater] Đang tải ${YTDLP_DOWNLOAD_URL(latest)} → ${ytDlpPath}`);
    }

    try {
      await downloadFile(YTDLP_DOWNLOAD_URL(latest), ytDlpPath, (percent) => {
        emitter.emit("status", { phase: "downloading", percent, latest });
      });
    } catch (e: any) {
      emitter.emit("status", { phase: "error", message: "Tải yt-dlp thất bại: " + e.message });
      return;
    }

    const verified = getCurrentVersion(ytDlpPath);
    if (!app.isPackaged) {
      console.log(`[ytdlp-updater] Verified version sau update: ${verified}`);
    }

    emitter.emit("status", { phase: "updated", version: verified ?? latest });
  })();

  return emitter;
}
