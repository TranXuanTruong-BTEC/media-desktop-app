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
import { logger } from "./logger.js";

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

// Cache kết quả tìm node.exe: trước đây hàm này gọi execSync("where node")
// (blocking, tốn tới 3s timeout) MỖI LẦN buildArgs() chạy — tức là mỗi lần
// bắt đầu tải HOẶC mỗi lần retry, main process (và do đó toàn bộ UI, vì IPC
// đồng bộ với renderer) bị đứng khựng. Đây chính là nguyên nhân "giật/lag"
// nêu trong báo cáo QA (UI Blocking). Giờ chỉ dò tìm 1 lần rồi cache lại.
let cachedNodeExe: string | null | undefined;

export function findNodeExe(): string | null {
  if (cachedNodeExe !== undefined) return cachedNodeExe;

  const bundled = path.join(getToolsDir(), "node.exe");
  if (fs.existsSync(bundled)) return (cachedNodeExe = bundled);

  try {
    const out = execSync("where node", { encoding: "utf8", timeout: 3000 }).trim();
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

// Cache ffmpeg giống node.exe: dò 1 lần rồi dùng lại.
// Đây là NGUYÊN NHÂN CHÍNH của lỗi "sai định dạng / ra 2 file .webm" —
// app trước đây không hề dò hay truyền --ffmpeg-location cho yt-dlp. Với các
// video YouTube có luồng hình và tiếng tách riêng (gần như mọi video từ 720p
// trở lên, và nhiều video ở độ phân giải thấp hơn), yt-dlp BẮT BUỘC cần
// ffmpeg để ghép 2 luồng lại. Không có ffmpeg, yt-dlp vẫn thoát với exit
// code 0 (nên app báo "Hoàn thành" bình thường) nhưng để lại 2 file riêng
// dạng "<tên video>.f247.webm" (chỉ hình) và "<tên video>.f251.webm"
// (chỉ tiếng) — đúng như trường hợp bạn gặp.
let cachedFfmpeg: string | null | undefined;

export function findFfmpeg(): string | null {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;

  const bundled = path.join(getToolsDir(), "ffmpeg.exe");
  if (fs.existsSync(bundled)) return (cachedFfmpeg = bundled);

  try {
    const out = execSync("where ffmpeg", { encoding: "utf8", timeout: 3000 }).trim();
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

const QUALITY_FORMAT: Record<VideoQuality, string> = {
  "bestvideo+bestaudio": "bestvideo+bestaudio/best",
  "1080p":  "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
  "720p":   "bestvideo[height<=720]+bestaudio/best[height<=720]",
  "480p":   "bestvideo[height<=480]+bestaudio/best[height<=480]",
  "360p":   "bestvideo[height<=360]+bestaudio/best[height<=360]",
  "audio_mp3": "bestaudio/best",
  "audio_m4a": "bestaudio[ext=m4a]/bestaudio/best",
};

export interface BuiltArgs {
  args: string[];
  /** Có khi ffmpeg không sẵn có và phải hạ cấp cách tải để tránh ra file lỗi */
  warning?: string;
}

export function buildArgs(req: DownloadRequest): BuiltArgs {
  const nodeExe   = findNodeExe();
  const jsRuntime = nodeExe ? ["--js-runtimes", `node:${nodeExe}`] : [];
  const outputTpl = path.join(req.outputDir, "%(title)s.%(ext)s");
  const ffmpeg    = findFfmpeg();

  if (!app.isPackaged) {
    console.log("[ytdlp] node.exe:", nodeExe ?? "NOT FOUND");
    console.log("[ytdlp] ffmpeg:", ffmpeg ?? "NOT FOUND");
  }

  const isAudioMp3 = req.quality === "audio_mp3";
  const isAudio    = isAudioMp3 || req.quality === "audio_m4a";

  // --continue         : resume file tải dở (yt-dlp sẽ bỏ qua phần đã có)
  // --retries 1        : yt-dlp tự retry 1 lần ở tầng HTTP; ta quản lý retry ở tầng process
  // --fragment-retries : retry fragment HLS/DASH bị lỗi
  // --windows-filenames: ép tên file an toàn trên Windows (loại bỏ : * ? " < > | và các
  //                       ký tự điều khiển) — trước đây thiếu flag này khiến tiêu đề video
  //                       chứa ký tự đặc biệt tạo ra đường dẫn không hợp lệ
  //                       (Path Resolution Error nêu trong báo cáo QA). Tiếng Việt có dấu
  //                       vẫn được giữ nguyên vì đó là ký tự Unicode hợp lệ trên NTFS.
  // --trim-filenames   : giới hạn độ dài tên file, tránh lỗi "path too long" trên Windows.
  const sharedFlags = [
    "--no-playlist",
    "--continue",
    "--retries", "1",
    "--fragment-retries", "3",
    "--file-access-retries", "3",
    "--windows-filenames",
    "--trim-filenames", "150",
    ...jsRuntime,
    ...(ffmpeg ? ["--ffmpeg-location", ffmpeg] : []),
    "--newline",
    "-o", outputTpl,
  ];

  if (isAudio) {
    if (!ffmpeg) {
      // Trích xuất/đổi định dạng âm thanh (mp3/m4a) cần ffmpeg để encode.
      // Không có ffmpeg thì yt-dlp không thể convert — tải nguyên bản âm
      // thanh gốc (thường là .webm/.m4a tùy nguồn) thay vì báo lỗi mập mờ.
      return {
        args: [...sharedFlags, "-f", "bestaudio/best", req.url],
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
        req.url,
      ],
    };
  }

  if (!ffmpeg) {
    // Không có ffmpeg → KHÔNG được chọn bestvideo+bestaudio (2 luồng tách
    // rời cần ghép), nếu không sẽ tái diễn đúng lỗi "ra 2 file .webm" mà
    // người dùng gặp phải. Chỉ chọn các format đã ghép sẵn (progressive) từ
    // YouTube — đảm bảo luôn ra 1 file chơi được, dù chất lượng có thể thấp
    // hơn (YouTube thường giới hạn progressive ở mức 720p).
    const heightMatch = QUALITY_FORMAT[req.quality]?.match(/height<=(\d+)/);
    const height = heightMatch ? heightMatch[1] : null;
    const progressiveFormat = height
      ? `best[height<=${height}][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]`
      : `best[vcodec!=none][acodec!=none]`;

    return {
      args: [...sharedFlags, "-f", progressiveFormat, req.url],
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
      "-f", QUALITY_FORMAT[req.quality] ?? "bestvideo+bestaudio/best",
      "--merge-output-format", "mp4",
      // Nguồn YouTube thường tách luồng hình (VP9/AV1, webm) và luồng tiếng
      // (Opus, webm). Mặc định yt-dlp ghép bằng "-c copy" (giữ nguyên codec)
      // → track âm thanh Opus nằm trong container MP4. Rất nhiều trình phát
      // phổ biến (Windows Media Player, app "Phim & TV", nhiều app di động)
      // KHÔNG giải mã được Opus → video chạy nhưng câm tiếng, dù file không
      // lỗi gì (đây chính là lỗi "tải về không có âm thanh" người dùng gặp).
      // Ép encode lại audio sang AAC (chuẩn universal) lúc ghép để khắc phục
      // triệt để; video vẫn "copy" nguyên bản nên không mất chất lượng/thời gian.
      "--postprocessor-args", "Merger:-c:v copy -c:a aac -b:a 192k",
      req.url,
    ],
  };
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
    let proc: ChildProcess;
    try {
      proc = spawn(ytDlp, args);
    } catch (err) {
      // spawn() có thể throw đồng bộ (vd. thiếu quyền thực thi) — trước đây
      // lỗi này không được bắt, dễ làm main process crash.
      resolve({
        outcome: "fatal-error",
        lastFilename: "",
        errorSummary: err instanceof Error ? err.message : String(err),
        exitCode: null,
      });
      return;
    }

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
        resolve({ outcome: "complete", lastFilename, errorSummary: "", exitCode: 0, warning });
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
    logger.error("downloader", "Thiếu yt-dlp.exe", { ytDlp });
    setImmediate(() =>
      emitter.emit("error", { id: req.id, message: `Không tìm thấy yt-dlp.exe tại:\n${ytDlp}` })
    );
    return { emitter, cancel: () => {} };
  }

  // Kiểm tra thư mục lưu tồn tại & ghi được TRƯỚC khi spawn yt-dlp — trước đây
  // nếu người dùng chọn thư mục rồi xóa/rút ổ đĩa ngoài, lỗi ghi file chỉ hiện
  // ra dưới dạng exit code lạ, khó hiểu và không log lại được.
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
        if (result.warning) logger.warn("downloader", result.warning, { url: req.url });
        emitter.emit("complete", {
          id:       req.id,
          filepath: path.join(req.outputDir, result.lastFilename),
          filename: result.lastFilename,
          warning:  result.warning,
        });
        return;
      }

      if (result.outcome === "fatal-error") {
        logger.error("downloader", "fatal-error", { url: req.url, ...result });
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
