/**
 * src/main/core/downloader.ts
 *
 * Core download engine — hoàn toàn độc lập với Electron IPC / BrowserWindow.
 * Retry tối đa 3 lần khi lỗi mạng, resume file dở nhờ --continue flag của yt-dlp.
 */

import { EventEmitter } from "events";
import { spawn, spawnSync, ChildProcess, execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import { app } from "electron";
import {
  DownloadRequest,
  DownloadProgress,
  DownloadComplete,
  DownloadError,
  DownloadRetrying,
  VideoQuality,
} from "../../shared/ipc-types.js";
import { logger } from "./logger.js";
import {
  isValidDownloadUrl, VALID_QUALITIES, escapeOutputTemplate, appendCapped, redactUrl,
} from "./security.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS      = 3;     // 1 lần đầu + 2 lần retry
const RETRY_BASE_MS     = 3000;  // 3s → 6s (exponential x2)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DownloadEvents {
  progress:  (p: DownloadProgress)  => void;
  complete:  (c: DownloadComplete)  => void;
  error:     (e: DownloadError)     => void;
  retrying:  (r: DownloadRetrying)  => void;
}

export interface Downloader extends EventEmitter {
  on<K extends keyof DownloadEvents>(event: K, listener: DownloadEvents[K]): this;
  emit<K extends keyof DownloadEvents>(event: K, ...args: Parameters<DownloadEvents[K]>): boolean;
}

// ─── Regex ───────────────────────────────────────────────────────────────────

const PROGRESS_RE =
  /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\S+)\s+at\s+(\S+)\s+ETA\s+(\S+)/;

// Lỗi mạng tạm thời → retry + resume
const NETWORK_PATTERNS = [
  /unable to connect/i,
  /connection reset/i,
  /connection refused/i,
  /network is unreachable/i,
  /timed? ?out/i,
  /temporary failure/i,
  /name or service not known/i,
  /remote end closed connection/i,
  /read error/i,
  /incomplete download/i,
  /http error 403/i,
  /http error 429/i,
  /http error 5\d\d/i,
  /got server http error/i,
  /fragment \d+ not found/i,
  /\[download\] Got error/i,
];

// Lỗi fatal → không retry (sai URL, video bị xóa, private...)
const FATAL_PATTERNS = [
  /video unavailable/i,
  /this video is private/i,
  /sign in to confirm your age/i,
  /copyright/i,
  /no video formats/i,
  /not a valid url/i,
  /unsupported url/i,
  /fresh cookies/i,
  /http error 404/i,
];

const ERROR_LINE_RE = /^\s*(ERROR|WARNING)\b|\[download\] Got error|HTTP Error/i;

function classifyError(stderr: string, stdout: string): "network" | "fatal" {
  const all = stderr + "\n" + stdout;
  const relevant = all.split(/\r?\n/).filter(l => ERROR_LINE_RE.test(l)).join("\n");
  const combined = relevant || all;
  if (FATAL_PATTERNS.some(r => r.test(combined))) return "fatal";
  if (NETWORK_PATTERNS.some(r => r.test(combined))) return "network";
  return "fatal"; // unknown → không retry vô ích
}

function summarizeError(stderr: string, stdout = ""): string {
  const combined = stderr + "\n" + stdout;
  const lines = combined.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.some(l => /fresh cookies/i.test(l))) {
    return "Trang này yêu cầu cookie mới. Vào Cài đặt → Cookies đăng nhập, dán nội dung cookies.txt " +
           "(định dạng Netscape, xuất từ trình duyệt đang đăng nhập bằng tiện ích \"Get cookies.txt LOCALLY\") rồi bấm tải lại.";
  }
  const hint = lines.find(l => /n challenge solving failed|no supported javascript runtime|requested format is not available|sign in to confirm/i.test(l));
  if (hint) return hint;
  return lines.find(l => /error|failed|unable/i.test(l)) ?? lines[lines.length - 1] ?? "Lỗi không xác định";
}

// ─── Cookies do người dùng cung cấp ───────────────────────────────────────────

/**
 * File cookies.txt (Netscape) người dùng dán/chọn trong Cài đặt. Một số trang (Douyin, TikTok, nội dung
 * cần đăng nhập...) bắt buộc có cookie. yt-dlp chỉ gửi cookie khớp tên miền của link đang tải.
 */
export function getCookiesPath(): string {
  return path.join(app.getPath("userData"), "cookies.txt");
}

// ─── Tool paths ───────────────────────────────────────────────────────────────

export function getBundledToolsDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "tools")
    : path.join(process.cwd(), "tools");
}

/** Thư mục ghi được (userData) — dùng để cập nhật yt-dlp, vì Program Files thường không ghi được. */
export function getUserToolsDir(): string {
  return path.join(app.getPath("userData"), "tools");
}

export function getToolsDir(): string {
  return getBundledToolsDir();
}

function toolCandidate(name: string): string[] {
  return [
    path.join(getUserToolsDir(), name),
    path.join(getBundledToolsDir(), name),
  ];
}

export function getYtDlpPath(): string {
  for (const p of toolCandidate("yt-dlp.exe")) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(getBundledToolsDir(), "yt-dlp.exe");
}

let cachedNodeExe: string | null | undefined;

function whereExe(name: string): string {
  return execFileSync("where.exe", [name], {
    encoding: "utf8",
    timeout: 3000,
    windowsHide: true,
    cwd: process.env["SystemRoot"] ?? "C:\\Windows",
  }).trim();
}

export function findNodeExe(): string | null {
  if (cachedNodeExe !== undefined) return cachedNodeExe;

  const bundled = path.join(getBundledToolsDir(), "node.exe");
  const userNode = path.join(getUserToolsDir(), "node.exe");
  if (fs.existsSync(bundled)) return (cachedNodeExe = bundled);
  if (fs.existsSync(userNode)) return (cachedNodeExe = userNode);

  try {
    const out = whereExe("node");
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim();
      if (p && fs.existsSync(p) && !p.toLowerCase().includes("electron")) {
        return (cachedNodeExe = p);
      }
    }
  } catch { /* ignore */ }

  for (const p of [
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Program Files (x86)\\nodejs\\node.exe",
    path.join(process.env["APPDATA"] ?? "", "..", "Local", "Programs", "nodejs", "node.exe"),
  ]) {
    if (fs.existsSync(p)) return (cachedNodeExe = p);
  }

  return (cachedNodeExe = null);
}

let cachedFfmpeg: string | null | undefined;

export function findFfmpeg(): string | null {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;

  const userFfmpeg = path.join(getUserToolsDir(), "ffmpeg.exe");
  if (fs.existsSync(userFfmpeg)) return (cachedFfmpeg = userFfmpeg);
  const bundled = path.join(getBundledToolsDir(), "ffmpeg.exe");
  if (fs.existsSync(bundled)) return (cachedFfmpeg = bundled);

  try {
    const out = whereExe("ffmpeg");
    const first = out.split(/\r?\n/)[0]?.trim();
    if (first && fs.existsSync(first)) return (cachedFfmpeg = first);
  } catch { /* ignore */ }

  for (const p of [
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
  ]) {
    if (fs.existsSync(p)) return (cachedFfmpeg = p);
  }

  return (cachedFfmpeg = null);
}

// ─── Format building ──────────────────────────────────────────────────────────

/** Audio khi ghép video: bỏ MP3 nhạc nền (TikTok/Reels hay để track này là “bestaudio”). */
const MERGE_AUDIO = "bestaudio[ext!=mp3][acodec!=none]/bestaudio[ext!=mp3]/bestaudio";

const QUALITY_FORMAT: Record<VideoQuality, string> = {
  "bestvideo+bestaudio": `bestvideo*+${MERGE_AUDIO}/best[vcodec!=none]`,
  "1080p":  `bestvideo*[height<=1080]+${MERGE_AUDIO}/best[height<=1080][vcodec!=none]`,
  "720p":   `bestvideo*[height<=720]+${MERGE_AUDIO}/best[height<=720][vcodec!=none]`,
  "480p":   `bestvideo*[height<=480]+${MERGE_AUDIO}/best[height<=480][vcodec!=none]`,
  "360p":   `bestvideo*[height<=360]+${MERGE_AUDIO}/best[height<=360][vcodec!=none]`,
  "audio_mp3": "bestaudio/best",
  "audio_m4a": "bestaudio[ext=m4a]/bestaudio/best",
};

function isTikTokUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return host === "tiktok.com" || host.endsWith(".tiktok.com") || host === "douyin.com" || host.endsWith(".douyin.com");
  } catch {
    return /tiktok\.com|douyin\.com/i.test(url);
  }
}
function muxedVideoFormat(height?: string): string {
  const h = height ? `[height<=${height}]` : "";
  return [
    `best${h}[ext=mp4][vcodec!=none]`,
    `best${h}[vcodec!=none][acodec!=none]`,
    `bestvideo*${h}[vcodec!=none]+${MERGE_AUDIO}`,
    `best${h}[vcodec!=none]`,
  ].join("/");
}

export function formatSelector(quality: VideoQuality, url: string): string {
  if (quality === "audio_mp3" || quality === "audio_m4a") {
    return QUALITY_FORMAT[quality];
  }
  if (isTikTokUrl(url)) {
    const height = quality === "bestvideo+bestaudio" ? undefined : quality.replace(/p$/, "");
    return /^\d+$/.test(height ?? "") ? muxedVideoFormat(height) : muxedVideoFormat();
  }
  return QUALITY_FORMAT[quality] ?? `bestvideo*+${MERGE_AUDIO}/best[vcodec!=none]`;
}

const AUDIO_ONLY_EXT = new Set([".mp3", ".m4a", ".opus", ".ogg", ".wav", ".aac", ".weba"]);

function isAudioOnlyFilename(name: string): boolean {
  return AUDIO_ONLY_EXT.has(path.extname(name).toLowerCase());
}

export interface BuiltArgs {
  args: string[];
  warning?: string;
}

export function buildArgs(req: DownloadRequest): BuiltArgs {
  const nodeExe   = findNodeExe();
  const jsRuntime = nodeExe ? ["--js-runtimes", `node:${nodeExe}`] : [];
  const outputTpl = path.join(escapeOutputTemplate(req.outputDir), "%(title)s.%(ext)s");
  const ffmpeg    = findFfmpeg();

  if (!app.isPackaged) {
    console.log("[ytdlp] node.exe:", nodeExe ?? "NOT FOUND");
    console.log("[ytdlp] ffmpeg:", ffmpeg ?? "NOT FOUND");
  }

  const isAudioMp3 = req.quality === "audio_mp3";
  const isAudio    = isAudioMp3 || req.quality === "audio_m4a";
  const sharedFlags = [
    "--no-playlist",
    "--continue",
    "--retries", "1",
    "--fragment-retries", "3",
    "--file-access-retries", "3",
    "--windows-filenames",
    "--trim-filenames", "150",
    ...jsRuntime,
    ...(process.env["MEDIAGET_REMOTE_COMPONENTS"] === "1" ? ["--remote-components", "ejs:github"] : []),
    ...(ffmpeg ? ["--ffmpeg-location", ffmpeg] : []),
    ...(fs.existsSync(getCookiesPath()) ? ["--cookies", getCookiesPath()] : []),
    "--newline",
    "-o", outputTpl,
  ];

  if (isAudio) {
    if (!ffmpeg) {
      return {
        args: [...sharedFlags, "-f", "bestaudio/best", "--", req.url],
        warning:
          "Không tìm thấy ffmpeg trên máy nên không thể chuyển sang " +
          (isAudioMp3 ? "MP3" : "M4A") +
          " — đã lưu file âm thanh ở định dạng gốc. Cài ffmpeg và thử lại để có đúng định dạng yêu cầu.",
      };
    }
    return {
      args: [
        ...sharedFlags,
        "-f", QUALITY_FORMAT[req.quality],
        "--extract-audio",
        "--audio-format", isAudioMp3 ? "mp3" : "m4a",
        "--audio-quality", "0",
        "--", req.url,
      ],
    };
  }

  if (!ffmpeg) {
    const heightMatch = formatSelector(req.quality, req.url)?.match(/height<=(\d+)/);
    const height = heightMatch ? heightMatch[1] : null;
    const progressiveFormat = height
      ? `best[height<=${height}][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]`
      : `best[vcodec!=none][acodec!=none]`;

    return {
      args: [...sharedFlags, "-f", progressiveFormat, "--", req.url],
      warning:
        "Không tìm thấy ffmpeg trên máy nên đã tự động tải ở chất lượng thấp hơn " +
        "(tối đa thường là 720p) để tránh lỗi tách file hình/tiếng riêng. " +
        "Cài ffmpeg (và thêm vào PATH, hoặc đặt ffmpeg.exe vào thư mục tools/ của app) " +
        "để tải được chất lượng cao với hình và tiếng đã ghép sẵn.",
    };
  }

  return {
    args: [
      ...sharedFlags,
      "--format-sort", "hasvid,res,vcodec:h264,ext:mp4:m4a",
      "-f", formatSelector(req.quality, req.url),
      "--merge-output-format", "mp4",
      "--postprocessor-args", "Merger:-c:v copy -c:a aac -b:a 192k",
      "--", req.url,
    ],
  };
}

// ─── Single attempt
function killTree(proc: ChildProcess, sync = false): void {
  const pid = proc.pid;
  if (process.platform === "win32" && pid) {
    const args = ["/pid", String(pid), "/T", "/F"];
    try {
      if (sync) {
        spawnSync("taskkill", args, { windowsHide: true, timeout: 3000 });
      } else {
        spawn("taskkill", args, { windowsHide: true, stdio: "ignore" })
          .on("error", () => { try { proc.kill(); } catch { /* ignore */ } });
      }
      return;
    } catch { }
  }
  try { proc.kill(); } catch { /* ignore */ }
}

interface CancelToken {
  cancelled: boolean;
  kill?: (sync?: boolean) => void;
  delayTimer?: ReturnType<typeof setTimeout>;
}

interface AttemptResult {
  outcome:      "complete" | "network-error" | "fatal-error" | "cancelled";
  lastFilename: string;
  errorSummary: string;
  exitCode:     number | null;
  warning?:     string;
}

function runAttempt(
  req:         DownloadRequest,
  ytDlp:       string,
  onProgress:  (p: DownloadProgress) => void,
  cancelToken: CancelToken,
): Promise<AttemptResult> {
  return new Promise((resolve) => {
    const { args, warning } = buildArgs(req);
    const toolsDir = path.dirname(ytDlp);
    const nodeExe = findNodeExe();
    const extraPath = [toolsDir, nodeExe ? path.dirname(nodeExe) : "", getBundledToolsDir()]
      .filter(Boolean)
      .join(path.delimiter);
    let proc: ChildProcess;
    try {
      proc = spawn(ytDlp, args, {
        windowsHide: true,
        cwd: toolsDir,
        env: {
          ...process.env,
          PATH: extraPath + path.delimiter + (process.env.PATH ?? ""),
        },
      });
    } catch (err) {
      resolve({
        outcome: "fatal-error",
        lastFilename: "",
        errorSummary: err instanceof Error ? err.message : String(err),
        exitCode: null,
      });
      return;
    }

    // Expose kill cho cancel()
    cancelToken.kill = (sync?: boolean) => killTree(proc, sync);

    let lastFilename = "";
    let lastVideoFilename = "";
    let stdoutBuf    = "";
    let stderrBuf    = "";
    let totalStreams = 1;
    let streamIdx    = 0;

    const rememberFilename = (name: string) => {
      const base = path.basename(name);
      lastFilename = base;
      if (!isAudioOnlyFilename(base)) lastVideoFilename = base;
    };

    const consume = (text: string) => {
      for (const line of text.split(/\r?\n/)) {
        const fmt = line.match(/Downloading \d+ format\(s\):\s*(\S+)/);
        if (fmt) totalStreams = Math.max(1, fmt[1].split("+").length);

        if (line.includes("[download] Destination:")) {
          streamIdx++;
          rememberFilename(line.replace(/^.*\[download\] Destination:/, "").trim());
        }

        const already = line.match(/^\[download\]\s+(.+?)\s+has already been downloaded/);
        if (already) {
          streamIdx++;
          rememberFilename(already[1]);
        }

        const extract = line.match(/^\[ExtractAudio\] Destination:\s*(.+)$/);
        if (extract) rememberFilename(extract[1].trim());
        const notConv = line.match(/^\[ExtractAudio\] Not converting audio (.+?); file is already in target format/);
        if (notConv) rememberFilename(notConv[1].trim());

        if (line.includes("[Merger] Merging formats into")) {
          const mm = line.match(/"([^"]+)"/);
          if (mm) rememberFilename(mm[1]);
        }

        const m = PROGRESS_RE.exec(line);
        if (m) {
          const pct = parseFloat(m[1]);
          const idx = Math.min(Math.max(streamIdx, 1), totalStreams);
          const overall = totalStreams > 1 ? ((idx - 1 + pct / 100) / totalStreams) * 100 : pct;
          onProgress({
            id: req.id,
            percent:  overall,
            size:     m[2],
            speed:    m[3],
            eta:      m[4],
            filename: lastFilename,
            stage:    totalStreams > 1 ? `${idx}/${totalStreams}` : undefined,
          });
        }
      }
    };

    proc.stdout?.on("data", (buf: Buffer) => {
      const text = buf.toString();
      stdoutBuf = appendCapped(stdoutBuf, text); 
      consume(text);
    });

    proc.stderr?.on("data", (buf: Buffer) => {
      const text = buf.toString();
      stderrBuf = appendCapped(stderrBuf, text);
      consume(text);
      if (!app.isPackaged) process.stderr.write("[ytdlp stderr] " + text);
    });

    proc.on("close", (code) => {
      cancelToken.kill = undefined;

      if (cancelToken.cancelled) {
        resolve({ outcome: "cancelled", lastFilename, errorSummary: "", exitCode: code });
        return;
      }
      if (code === 0) {
        resolve({
          outcome: "complete",
          lastFilename: lastVideoFilename || lastFilename,
          errorSummary: "",
          exitCode: 0,
          warning,
        });
        return;
      }

      const kind = classifyError(stderrBuf, stdoutBuf);
      resolve({
        outcome:      kind === "network" ? "network-error" : "fatal-error",
        lastFilename,
        errorSummary: summarizeError(stderrBuf, stdoutBuf),
        exitCode:     code,
      });
    });

    proc.on("error", (err) => {
      cancelToken.kill = undefined;
      resolve({ outcome: "fatal-error", lastFilename, errorSummary: err.message, exitCode: null });
    });
  });
}

// ─── Main export 

export function startDownload(req: DownloadRequest): {
  emitter: Downloader;
  cancel:  (sync?: boolean) => void;
} {
  const emitter = new EventEmitter() as Downloader;

  // Phòng thủ nhiều lớp: IPC đã kiểm tra, nhưng core cũng không tin đầu vào.
  if (!isValidDownloadUrl(req.url) || !VALID_QUALITIES.has(req.quality)) {
    logger.warn("downloader", "Request không hợp lệ bị chặn ở core", { url: redactUrl(req.url) });
    setImmediate(() =>
      emitter.emit("error", { id: req.id, message: "Yêu cầu tải không hợp lệ (URL hoặc chất lượng)." })
    );
    return { emitter, cancel: () => {} };
  }

  const ytDlp = getYtDlpPath();
  if (!fs.existsSync(ytDlp)) {
    logger.error("downloader", "Thiếu yt-dlp.exe", { ytDlp });
    setImmediate(() =>
      emitter.emit("error", { id: req.id, message: `Không tìm thấy yt-dlp.exe tại:\n${ytDlp}` })
    );
    return { emitter, cancel: () => {} };
  }

  try {
    fs.mkdirSync(req.outputDir, { recursive: true });
    fs.accessSync(req.outputDir, fs.constants.W_OK);
  } catch (err) {
    const message = `Không thể ghi vào thư mục đã chọn:\n${req.outputDir}`;
    logger.error("downloader", message, err);
    setImmediate(() => emitter.emit("error", { id: req.id, message }));
    return { emitter, cancel: () => {} };
  }

  const cancelToken: CancelToken = { cancelled: false };

  const cancel = (sync = false) => {
    cancelToken.cancelled = true;
    cancelToken.kill?.(sync);
    if (cancelToken.delayTimer) clearTimeout(cancelToken.delayTimer);
  };
  let maxPercent = 0;
  const emitProgress = (p: DownloadProgress) => {
    if (p.percent < maxPercent) p = { ...p, percent: maxPercent };
    else maxPercent = p.percent;
    emitter.emit("progress", p);
  };

  (async () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (cancelToken.cancelled) break;

      const result = await runAttempt(req, ytDlp, emitProgress, cancelToken);

      if (cancelToken.cancelled || result.outcome === "cancelled") break;

      if (result.outcome === "complete") {
        const wantedVideo = req.quality !== "audio_mp3" && req.quality !== "audio_m4a";
        if (wantedVideo && result.lastFilename && isAudioOnlyFilename(result.lastFilename)) {
          const message =
            "Không tải được video — nguồn chỉ trả về file âm thanh (MP3/M4A). " +
            "Thường gặp với TikTok dạng ảnh/slideshow, hoặc khi luồng hình bị chặn. " +
            "Chọn “Chỉ âm thanh” nếu bạn muốn giữ file nhạc.";
          logger.warn("downloader", message, { url: redactUrl(req.url), file: result.lastFilename });
          emitter.emit("error", { id: req.id, message });
          return;
        }
        if (result.warning) logger.warn("downloader", result.warning, { url: redactUrl(req.url) });
        emitter.emit("complete", {
          id:       req.id,
          filepath: path.join(req.outputDir, result.lastFilename),
          filename: result.lastFilename,
          warning:  result.warning,
        });
        return;
      }

      if (result.outcome === "fatal-error") {
        logger.error("downloader", "fatal-error", { ...result, url: redactUrl(req.url) });
        emitter.emit("error", {
          id:      req.id,
          message: result.errorSummary || `Tải thất bại (code ${result.exitCode})`,
        });
        return;
      }

      // network-error — retry nếu còn lượt
      if (attempt < MAX_ATTEMPTS) {
        const delayMs = RETRY_BASE_MS * Math.pow(2, attempt - 1); // 3000, 6000

        emitter.emit("retrying", {
          id:          req.id,
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          reason:      result.errorSummary,
          delayMs,
        });

        if (!app.isPackaged)
          console.log(`[ytdlp] Retry ${attempt}/${MAX_ATTEMPTS - 1} sau ${delayMs}ms`);

        await new Promise<void>(res => {
          cancelToken.delayTimer = setTimeout(res, delayMs);
        });
        cancelToken.delayTimer = undefined;
      } else {
        emitter.emit("error", {
          id:      req.id,
          message: `Tải thất bại sau ${MAX_ATTEMPTS} lần thử. ${result.errorSummary}`,
        });
      }
    }
  })();

  return { emitter, cancel };
}
