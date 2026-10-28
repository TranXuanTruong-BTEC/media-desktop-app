import fs from "fs";
import path from "path";
import { app } from "electron";

const MAX_LOG_BYTES = 2 * 1024 * 1024;

function getLogPath(): string {
  const dir = path.join(app.getPath("userData"), "logs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "app.log");
}

function rotateIfNeeded(file: string) {
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
      fs.renameSync(file, file + ".old");
    }
  } catch {
  }
}

function write(level: "INFO" | "WARN" | "ERROR", scope: string, message: string, extra?: unknown) {
  try {
    const file = getLogPath();
    rotateIfNeeded(file);
    const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}` +
      (extra !== undefined ? " " + safeStringify(extra) : "") + "\n";
    fs.appendFileSync(file, line);
    if (!app.isPackaged) {
      (level === "ERROR" ? console.error : console.log)(line.trim());
    }
  } catch {
  }
}

function safeStringify(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack ?? ""}`;
  try { return JSON.stringify(v); } catch { return String(v); }
}

export const logger = {
  info:  (scope: string, message: string, extra?: unknown) => write("INFO", scope, message, extra),
  warn:  (scope: string, message: string, extra?: unknown) => write("WARN", scope, message, extra),
  error: (scope: string, message: string, extra?: unknown) => write("ERROR", scope, message, extra),
  getLogPath,
};
