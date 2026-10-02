/**
 * src/main/core/ytdlp-updater.ts
 *
 * Tự động kiểm tra và cập nhật yt-dlp.exe khi app khởi động.
 * Hoàn toàn độc lập với IPC / BrowserWindow — chỉ phát event qua EventEmitter.
 *
 * Flow:
 *   1. Đọc version yt-dlp đang có   (chạy `yt-dlp.exe --version`, bất đồng bộ)
 *   2. Gọi GitHub API lấy tag mới nhất (và kiểm tra định dạng tag)
 *   3. Tải SHA2-256SUMS của đúng release đó
 *   4. Tải yt-dlp.exe vào file tạm → kiểm tra kích thước, chữ ký "MZ", SHA-256
 *      TRƯỚC KHI thay thế file đang dùng và TRƯỚC KHI chạy thử.
 *   5. Phát event "status" suốt quá trình để IPC/UI cập nhật
 *
 * Bảo mật (so với bản cũ):
 *   - Trước đây file .exe tải về được thay thế rồi CHẠY NGAY mà không kiểm tra gì.
 *   - Redirect giờ chỉ được theo nếu là https và thuộc github.com / *.githubusercontent.com.
 *   - Có giới hạn kích thước + timeout; chỉ một lượt cập nhật chạy tại một thời điểm.
 *
 * Giới hạn đã biết: SHA2-256SUMS nằm cùng release nên chống được file hỏng / bị can thiệp
 * trên đường truyền hoặc CDN, nhưng không chống được việc chính release bị chiếm quyền.
 * (yt-dlp có ký GPG SHA2-256SUMS.sig — có thể bổ sung kiểm tra chữ ký sau.)
 */

import { EventEmitter } from "events";
import { execFile }     from "child_process";
import path             from "path";
import fs               from "fs";
import https            from "https";
import { IncomingMessage } from "http";
import { app }          from "electron";
import { getUserToolsDir, getYtDlpPath } from "./downloader.js";
import {
  resolveSafeRedirect, isValidYtdlpTag, parseSha256Sums, sha256File, looksLikeWindowsExe,
} from "./security.js";
import { logger } from "./logger.js";

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

const RELEASE_BASE = (tag: string) =>
  `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}`;

const MAX_REDIRECTS      = 5;
const REQUEST_TIMEOUT_MS = 30_000;              // timeout khi socket im lặng
const MAX_TEXT_BYTES     = 1 * 1024 * 1024;     // JSON / SHA2-256SUMS
const MAX_EXE_BYTES      = 120 * 1024 * 1024;   // yt-dlp.exe thật ~18MB
const MIN_EXE_BYTES      = 5 * 1024 * 1024;

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

/** GET https với redirect được kiểm soát (chỉ https + host GitHub). */
function openStream(url: string, depth = 0): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (depth > MAX_REDIRECTS) { reject(new Error("Quá nhiều redirect")); return; }

    const req = https.get(
      url,
      { headers: { "User-Agent": "media-desktop-app" }, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        const code = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(code)) {
          res.resume();
          const loc  = res.headers.location;
          const next = loc ? resolveSafeRedirect(loc, url) : null;
          if (!next) { reject(new Error("Redirect không an toàn (không phải https/GitHub) — đã chặn")); return; }
          openStream(next.toString(), depth + 1).then(resolve, reject);
          return;
        }
        if (code !== 200) { res.resume(); reject(new Error(`HTTP ${code}`)); return; }
        resolve(res);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Hết thời gian chờ phản hồi")));
    req.on("error", reject);
  });
}

async function fetchText(url: string, maxBytes = MAX_TEXT_BYTES): Promise<string> {
  const res = await openStream(url);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) { res.destroy(new Error("Phản hồi quá lớn")); return; }
      chunks.push(c);
    });
    res.on("end",   () => resolve(Buffer.concat(chunks).toString("utf8")));
    res.on("error", reject);
    res.on("close", () => { if (!res.complete) reject(new Error("Kết nối bị ngắt giữa chừng")); });
  });
}

/** Tải về file tạm; không bao giờ đụng tới file đích. */
async function downloadToFile(
  url: string,
  tmpPath: string,
  maxBytes: number,
  onProgress: (percent: number) => void,
): Promise<void> {
  const res   = await openStream(url);
  const total = parseInt(res.headers["content-length"] ?? "0", 10);
  if (total > maxBytes) { res.destroy(); throw new Error("File vượt quá kích thước cho phép"); }

  return new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmpPath);
    let received = 0;
    let lastPct  = -1;
    let failed   = false;

    const fail = (e: Error) => {
      if (failed) return;
      failed = true;
      res.destroy();
      out.destroy();
      fs.unlink(tmpPath, () => {});
      reject(e);
    };

    res.on("data", (c: Buffer) => {
      received += c.length;
      if (received > maxBytes) { fail(new Error("File vượt quá kích thước cho phép")); return; }
      if (total > 0) {
        const pct = Math.round((received / total) * 100);
        if (pct !== lastPct) { lastPct = pct; onProgress(pct); }
      }
    });
    res.on("error", fail);
    res.on("close", () => { if (!res.complete) fail(new Error("Kết nối bị ngắt giữa chừng")); });
    out.on("error", fail);
    // Đợi "close" (handle đã đóng) rồi mới resolve — cần để rename được trên Windows.
    out.on("close", () => { if (!failed && res.complete) resolve(); });

    res.pipe(out);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Lấy version yt-dlp.exe đang có (bất đồng bộ, không chặn UI). Null nếu không có/lỗi. */
function getCurrentVersion(ytDlpPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!fs.existsSync(ytDlpPath)) { resolve(null); return; }
    execFile(
      ytDlpPath, ["--version"],
      { encoding: "utf8", timeout: 8000, windowsHide: true },
      (err, stdout) => resolve(err ? null : (String(stdout).trim() || null)),
    );
  });
}

/** Cách 1: GitHub API (giới hạn 60 request/giờ/IP khi không xác thực → có thể trả 403). */
async function tagFromApi(): Promise<string> {
  const body = await fetchText(GITHUB_API_URL);
  let json: { tag_name?: unknown };
  try { json = JSON.parse(body); }
  catch (e: any) { throw new Error("Parse GitHub response thất bại: " + e.message); }
  if (typeof json.tag_name !== "string") throw new Error("Không tìm thấy tag_name trong response");
  return json.tag_name;
}

/** Cách 2 (dự phòng, không tính vào hạn mức API): đọc tag từ redirect của /releases/latest. */
function tagFromRedirect(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      "https://github.com/yt-dlp/yt-dlp/releases/latest",
      { headers: { "User-Agent": "media-desktop-app" }, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        res.resume();
        const loc  = res.headers.location;
        const code = res.statusCode ?? 0;
        if (code < 300 || code >= 400 || !loc) { reject(new Error(`HTTP ${code}`)); return; }
        try {
          const u = new URL(loc, "https://github.com/");
          const m = u.hostname === "github.com" ? u.pathname.match(/\/releases\/tag\/([^/]+)$/) : null;
          if (!m) throw new Error("redirect không chứa tag");
          resolve(decodeURIComponent(m[1]));
        } catch (e: any) {
          reject(new Error("Không đọc được tag từ redirect: " + e.message));
        }
      },
    );
    req.on("timeout", () => req.destroy(new Error("Hết thời gian chờ phản hồi")));
    req.on("error", reject);
  });
}

/** Lấy tag release mới nhất (e.g. "2026.08.19"), luôn kiểm tra định dạng trước khi dùng vào URL. */
async function fetchLatestTag(): Promise<string> {
  let raw: string;
  try {
    raw = await tagFromApi();
  } catch (apiErr: any) {
    logger.warn("ytdlp-updater", "GitHub API lỗi, thử đường dự phòng (redirect)", { message: apiErr?.message });
    try {
      raw = await tagFromRedirect();
    } catch (redirErr: any) {
      throw new Error(`${apiErr?.message ?? apiErr}; dự phòng cũng lỗi: ${redirErr?.message ?? redirErr}`);
    }
  }
  const tag = raw.replace(/^v/, "");
  if (!isValidYtdlpTag(tag)) throw new Error(`Tag phiên bản không hợp lệ: ${tag.slice(0, 40)}`);
  return tag;
}

function friendlyFsError(e: any): string {
  if (e && (e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES")) {
    return "yt-dlp.exe đang được sử dụng. Hãy đợi các lượt tải kết thúc rồi thử lại.";
  }
  return e?.message ?? String(e);
}

// ─── Main export ──────────────────────────────────────────────────────────────

/** Chỉ một lượt cập nhật tại một thời điểm (tránh 2 luồng cùng ghi 1 file tạm). */
let activeRun: YtdlpUpdaterEmitter | null = null;

async function run(emit: (s: YtdlpUpdatePhase) => void, force: boolean): Promise<void> {
  const toolsDir  = getUserToolsDir();
  const destPath  = path.join(toolsDir, "yt-dlp.exe");
  const ytDlpPath = fs.existsSync(destPath) ? destPath : getYtDlpPath();

  fs.mkdirSync(toolsDir, { recursive: true });

  emit({ phase: "checking" });

  const current = await getCurrentVersion(ytDlpPath);

  // Dev mode và chưa có file → chỉ báo not-found, không tự tải
  if (current === null && !app.isPackaged) {
    emit({ phase: "not-found" });
    return;
  }

  let latest: string;
  try {
    latest = await fetchLatestTag();
  } catch (e: any) {
    emit({ phase: "error", message: "Không thể kiểm tra phiên bản mới: " + e.message });
    return;
  }

  const needsUpdate = force || current === null || current !== latest;
  if (!needsUpdate) {
    emit({ phase: "up-to-date", version: current! });
    return;
  }

  emit({ phase: "update-found", current: current ?? "(chưa có)", latest });

  const base = RELEASE_BASE(latest);

  // 1) Lấy checksum chính thức của release
  let expected: string;
  try {
    const sums = await fetchText(`${base}/SHA2-256SUMS`);
    const h = parseSha256Sums(sums, "yt-dlp.exe");
    if (!h) throw new Error("không có dòng checksum cho yt-dlp.exe");
    expected = h;
  } catch (e: any) {
    emit({ phase: "error", message: "Không lấy được checksum để xác minh yt-dlp: " + e.message });
    return;
  }

  // 2) Tải → kiểm tra → mới thay thế
  const tmpPath = `${destPath}.${process.pid}.download`;
  try {
    await downloadToFile(`${base}/yt-dlp.exe`, tmpPath, MAX_EXE_BYTES, (percent) => {
      emit({ phase: "downloading", percent, latest });
    });

    const size = fs.statSync(tmpPath).size;
    if (size < MIN_EXE_BYTES)            throw new Error("File tải về nhỏ bất thường");
    if (!looksLikeWindowsExe(tmpPath))   throw new Error("File tải về không phải file thực thi Windows");

    const actual = await sha256File(tmpPath);
    if (actual !== expected) {
      throw new Error("Checksum SHA-256 không khớp — file tải về đã bị từ chối");
    }

    fs.renameSync(tmpPath, destPath);   // thay thế nguyên tử, chỉ sau khi đã xác minh
  } catch (e: any) {
    try { fs.rmSync(tmpPath, { force: true }); } catch { /* ignore */ }
    logger.error("ytdlp-updater", "Cập nhật yt-dlp thất bại", e);
    emit({ phase: "error", message: "Tải yt-dlp thất bại: " + friendlyFsError(e) });
    return;
  }

  // 3) Giờ file đã được xác minh mới chạy thử để đọc version
  const verified = await getCurrentVersion(destPath);
  logger.info("ytdlp-updater", `Đã cập nhật yt-dlp → ${verified ?? latest}`);
  emit({ phase: "updated", version: verified ?? latest });
}

/**
 * Kiểm tra và (nếu cần) tải bản yt-dlp mới nhất.
 *
 * @param force  Nếu true, tải lại kể cả khi version đã mới nhất
 * @returns      EventEmitter phát "status" liên tục đến khi kết thúc.
 *               Nếu đang có một lượt chạy, trả lại chính emitter của lượt đó.
 */
export function checkAndUpdateYtDlp(force = false): YtdlpUpdaterEmitter {
  if (activeRun) return activeRun;

  const emitter = new EventEmitter() as YtdlpUpdaterEmitter;
  activeRun = emitter;

  // setImmediate: để người gọi kịp gắn listener trước khi phát event đầu tiên
  // (bản cũ phát "checking" đồng bộ nên UI không bao giờ nhận được).
  setImmediate(async () => {
    try {
      await run((s) => emitter.emit("status", s), force);
    } catch (e: any) {
      logger.error("ytdlp-updater", "Lỗi không mong muốn", e);
      emitter.emit("status", { phase: "error", message: e?.message ?? String(e) });
    } finally {
      activeRun = null;
    }
  });

  return emitter;
}
