/**
 * src/main/core/downloader.ts
 *
 * Core download engine — hoàn toàn độc lập với Electron IPC / BrowserWindow.
 * Retry tối đa 3 lần khi lỗi mạng, resume file dở nhờ --continue flag của yt-dlp.
 */

import { EventEmitter } from "events";
import { spawn, ChildProcess, execSync } from "child_process";
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
  /\[download\]\s+([\d.]+)%\s+of\s+([\d.]+\S+)\s+at\s+([\d.]+\S+\/s)\s+ETA\s+(\S+)/;

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
  /404/,
];

function classifyError(stderr: string, stdout: string): "network" | "fatal" {
  const combined = stderr + stdout;
  if (FATAL_PATTERNS.some(r => r.test(combined))) return "fatal";
  if (NETWORK_PATTERNS.some(r => r.test(combined))) return "network";
  return "fatal"; // unknown → không retry vô ích
}

function summarizeError(stderr: string): string {
  const lines = stderr.split("\n").map(l => l.trim()).filter(Boolean);
  return lines.find(l => /error|failed|unable/i.test(l)) ?? lines[lines.length - 1] ?? "Lỗi không xác định";
}

// ─── Tool paths ───────────────────────────────────────────────────────────────

export function getToolsDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "tools")
    : path.join(process.cwd(), "tools");
}

export function getYtDlpPath(): string {
  return path.join(getToolsDir(), "yt-dlp.exe");
}

export function findNodeExe(): string | null {
  const bundled = path.join(getToolsDir(), "node.exe");
  if (fs.existsSync(bundled)) return bundled;

  try {
    const out = execSync("where node", { encoding: "utf8", timeout: 3000 }).trim();
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim();
      if (p && fs.existsSync(p) && !p.toLowerCase().includes("electron")) return p;
    }
  } catch { /* ignore */ }

  for (const p of [
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Program Files (x86)\\nodejs\\node.exe",
    path.join(process.env["APPDATA"] ?? "", "..", "Local", "Programs", "nodejs", "node.exe"),
  ]) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

// ─── Format building ──────────────────────────────────────────────────────────

const QUALITY_FORMAT: Record<VideoQuality, string> = {
  "bestvideo+bestaudio": "bestvideo+bestaudio/best",
  "1080p":  "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
  "720p":   "bestvideo[height<=720]+bestaudio/best[height<=720]",
  "480p":   "bestvideo[height<=480]+bestaudio/best[height<=480]",
  "360p":   "bestvideo[height<=360]+bestaudio/best[height<=360]",
  "audio_mp3": "bestaudio/best",
  "audio_m4a": "bestaudio[ext=m4a]/bestaudio/best",
};

export function buildArgs(req: DownloadRequest): string[] {
  const nodeExe   = findNodeExe();
  const jsRuntime = nodeExe ? ["--js-runtimes", `node:${nodeExe}`] : [];
  const outputTpl = path.join(req.outputDir, "%(title)s.%(ext)s");

  if (!app.isPackaged) console.log("[ytdlp] node.exe:", nodeExe ?? "NOT FOUND");

  const isAudioMp3 = req.quality === "audio_mp3";
  const isAudio    = isAudioMp3 || req.quality === "audio_m4a";

  // --continue    : resume file tải dở (yt-dlp sẽ bỏ qua phần đã có)
  // --retries 1   : yt-dlp tự retry 1 lần ở tầng HTTP; ta quản lý retry ở tầng process
  // --fragment-retries 3 : retry fragment HLS/DASH bị lỗi
  const sharedFlags = [
    "--no-playlist",
    "--continue",
    "--retries", "1",
    "--fragment-retries", "3",
    "--file-access-retries", "3",
    ...jsRuntime,
    "--newline",
    "-o", outputTpl,
    req.url,
  ];

  if (isAudio) {
    return [
      "--no-playlist",
      "--continue",
      "--retries", "1",
      "--fragment-retries", "3",
      "--file-access-retries", "3",
      ...jsRuntime,
      "-f", QUALITY_FORMAT[req.quality],
      "--extract-audio",
      "--audio-format", isAudioMp3 ? "mp3" : "m4a",
      "--audio-quality", "0",
      "--newline",
      "-o", outputTpl,
      req.url,
    ];
  }

  return [
    "--no-playlist",
    "--continue",
    "--retries", "1",
    "--fragment-retries", "3",
    "--file-access-retries", "3",
    ...jsRuntime,
    "-f", QUALITY_FORMAT[req.quality] ?? "bestvideo+bestaudio/best",
    "--merge-output-format", "mp4",
    "--newline",
    "-o", outputTpl,
    req.url,
  ];
}

// ─── Single attempt ───────────────────────────────────────────────────────────

interface CancelToken {
  cancelled: boolean;
  kill?: () => void;
  delayTimer?: ReturnType<typeof setTimeout>;
}

interface AttemptResult {
  outcome:      "complete" | "network-error" | "fatal-error" | "cancelled";
  lastFilename: string;
  errorSummary: string;
  exitCode:     number | null;
}

function runAttempt(
  req:         DownloadRequest,
  ytDlp:       string,
  onProgress:  (p: DownloadProgress) => void,
  cancelToken: CancelToken,
): Promise<AttemptResult> {
  return new Promise((resolve) => {
    const args          = buildArgs(req);
    const proc: ChildProcess = spawn(ytDlp, args);

    // Expose kill cho cancel()
    cancelToken.kill = () => proc.kill();

    let lastFilename = "";
    let stdoutBuf    = "";
    let stderrBuf    = "";

    proc.stdout?.on("data", (buf: Buffer) => {
      const text = buf.toString();
      stdoutBuf += text;

      for (const line of text.split("\n")) {
        if (line.startsWith("[download] Destination:"))
          lastFilename = path.basename(line.replace("[download] Destination:", "").trim());

        if (line.startsWith("[Merger] Merging formats into")) {
          const m = line.match(/"([^"]+)"/);
          if (m) lastFilename = path.basename(m[1]);
        }

        const m = PROGRESS_RE.exec(line);
        if (m) {
          onProgress({
            id: req.id,
            percent:  parseFloat(m[1]),
            size:     m[2],
            speed:    m[3],
            eta:      m[4],
            filename: lastFilename,
          });
        }
      }
    });

    proc.stderr?.on("data", (buf: Buffer) => {
      stderrBuf += buf.toString();
      if (!app.isPackaged) process.stderr.write("[ytdlp stderr] " + buf.toString());
    });

    proc.on("close", (code) => {
      cancelToken.kill = undefined;

      if (cancelToken.cancelled) {
        resolve({ outcome: "cancelled", lastFilename, errorSummary: "", exitCode: code });
        return;
      }
      if (code === 0) {
        resolve({ outcome: "complete", lastFilename, errorSummary: "", exitCode: 0 });
        return;
      }

      const kind = classifyError(stderrBuf, stdoutBuf);
      resolve({
        outcome:      kind === "network" ? "network-error" : "fatal-error",
        lastFilename,
        errorSummary: summarizeError(stderrBuf),
        exitCode:     code,
      });
    });

    proc.on("error", (err) => {
      cancelToken.kill = undefined;
      resolve({ outcome: "fatal-error", lastFilename, errorSummary: err.message, exitCode: null });
    });
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Bắt đầu tải một video với retry + resume tự động.
 *
 * - Retry tối đa MAX_ATTEMPTS lần khi gặp lỗi mạng
 * - `--continue` để yt-dlp resume phần đã tải
 * - Exponential backoff giữa các lần retry (3s, 6s)
 * - Lỗi fatal → không retry
 *
 * Events: "progress" | "complete" | "error" | "retrying"
 */
export function startDownload(req: DownloadRequest): {
  emitter: Downloader;
  cancel:  () => void;
} {
  const emitter = new EventEmitter() as Downloader;

  const ytDlp = getYtDlpPath();
  if (!fs.existsSync(ytDlp)) {
    setImmediate(() =>
      emitter.emit("error", { id: req.id, message: `Không tìm thấy yt-dlp.exe tại:\n${ytDlp}` })
    );
    return { emitter, cancel: () => {} };
  }

  const cancelToken: CancelToken = { cancelled: false };

  const cancel = () => {
    cancelToken.cancelled = true;
    cancelToken.kill?.();
    if (cancelToken.delayTimer) clearTimeout(cancelToken.delayTimer);
  };

  (async () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (cancelToken.cancelled) break;

      const result = await runAttempt(req, ytDlp, p => emitter.emit("progress", p), cancelToken);

      if (cancelToken.cancelled || result.outcome === "cancelled") break;

      if (result.outcome === "complete") {
        emitter.emit("complete", {
          id:       req.id,
          filepath: path.join(req.outputDir, result.lastFilename),
          filename: result.lastFilename,
        });
        return;
      }

      if (result.outcome === "fatal-error") {
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
