// src/main/ipc/download.ts
import { ipcMain, BrowserWindow, dialog, app } from "electron";
import { spawn, ChildProcess, execSync } from "child_process";
import path from "path";
import fs from "fs";
import {
  IPC,
  DownloadRequest,
  DownloadProgress,
  DownloadComplete,
  DownloadError,
  VideoQuality,
} from "../../shared/ipc-types.js";

const activeProcesses = new Map<string, ChildProcess>();

const PROGRESS_RE = /\[download\]\s+([\d.]+)%\s+of\s+([\d.]+\S+)\s+at\s+([\d.]+\S+\/s)\s+ETA\s+(\S+)/;

// ─── Paths ───────────────────────────────────────────────────────────────────

function getToolsDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "tools")
    : path.join(process.cwd(), "tools");
}

function getYtDlpPath(): string {
  return path.join(getToolsDir(), "yt-dlp.exe");
}

/**
 * Tìm node.exe thật (không phải electron.exe):
 * 1. tools/node.exe  — bundled, ưu tiên cao nhất
 * 2. node.exe trong PATH hệ thống
 * 3. Đường dẫn cài đặt Windows phổ biến
 */
function findNodeExe(): string | null {
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

function buildArgs(req: DownloadRequest): string[] {
  const nodeExe = findNodeExe();
  const jsRuntime = nodeExe ? ["--js-runtimes", `node:${nodeExe}`] : [];
  const outputTpl = path.join(req.outputDir, "%(title)s.%(ext)s");

  if (!app.isPackaged) {
    console.log("[ytdlp] node.exe:", nodeExe ?? "NOT FOUND");
  }

  const isAudioMp3 = req.quality === "audio_mp3";
  const isAudio    = isAudioMp3 || req.quality === "audio_m4a";

  if (isAudio) {
    return [
      "--no-playlist",
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
    ...jsRuntime,
    "-f", QUALITY_FORMAT[req.quality] ?? "bestvideo+bestaudio/best",
    "--merge-output-format", "mp4",
    "--newline",
    "-o", outputTpl,
    req.url,
  ];
}

// ─── IPC senders ─────────────────────────────────────────────────────────────

const send = {
  progress: (win: BrowserWindow, p: DownloadProgress) =>
    !win.isDestroyed() && win.webContents.send(IPC.DOWNLOAD_PROGRESS, p),
  complete: (win: BrowserWindow, c: DownloadComplete) =>
    !win.isDestroyed() && win.webContents.send(IPC.DOWNLOAD_COMPLETE, c),
  error: (win: BrowserWindow, e: DownloadError) =>
    !win.isDestroyed() && win.webContents.send(IPC.DOWNLOAD_ERROR, e),
};

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerDownloadHandlers(win: BrowserWindow) {
  // Select output folder
  ipcMain.handle(IPC.SELECT_DIR, async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });

  // Start download
  ipcMain.on(IPC.DOWNLOAD_START, (_evt: unknown, req: DownloadRequest) => {
    const ytDlp = getYtDlpPath();
    if (!fs.existsSync(ytDlp)) {
      send.error(win, { id: req.id, message: `Không tìm thấy yt-dlp.exe tại:\n${ytDlp}` });
      return;
    }

    const args = buildArgs(req);
    if (!app.isPackaged) console.log("[ytdlp]", ytDlp, args.join(" "));

    const proc = spawn(ytDlp, args);
    activeProcesses.set(req.id, proc);
    let lastFilename = "";

    proc.stdout.on("data", (buf: Buffer) => {
      for (const line of buf.toString().split("\n")) {
        if (line.startsWith("[download] Destination:"))
          lastFilename = path.basename(line.replace("[download] Destination:", "").trim());

        if (line.startsWith("[Merger] Merging formats into")) {
          const m = line.match(/"([^"]+)"/);
          if (m) lastFilename = path.basename(m[1]);
        }

        const m = PROGRESS_RE.exec(line);
        if (m) {
          send.progress(win, {
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

    proc.stderr.on("data", (buf: Buffer) => {
      if (!app.isPackaged) console.error("[ytdlp stderr]", buf.toString());
    });

    proc.on("close", (code: number | null) => {
      activeProcesses.delete(req.id);
      if (code === 0) {
        send.complete(win, {
          id: req.id,
          filepath: path.join(req.outputDir, lastFilename),
          filename: lastFilename,
        });
      } else if (code !== null) {
        send.error(win, { id: req.id, message: `Tải thất bại (code ${code})` });
      }
    });

    proc.on("error", (err: Error) => {
      activeProcesses.delete(req.id);
      send.error(win, { id: req.id, message: err.message });
    });
  });

  // Cancel
  ipcMain.on(IPC.DOWNLOAD_CANCEL, (_evt: unknown, id: string) => {
    const proc = activeProcesses.get(id);
    if (proc) { proc.kill(); activeProcesses.delete(id); }
  });
}
