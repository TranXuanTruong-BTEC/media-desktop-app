/**
 * src/main/core/logger.ts
 *
 * Logger tối giản, ghi log lỗi phía main process ra file trong userData.
 * Giải quyết mục "Thiếu cơ chế Logging" trong báo cáo QA:
 * trước đây không có nơi nào lưu lại lỗi để trace khi user báo cáo sự cố.
 *
 * Không dùng thư viện ngoài — chỉ append text, xoay vòng file khi quá lớn.
 */

import fs from "fs";
import path from "path";
import { app } from "electron";

const MAX_LOG_BYTES = 2 * 1024 * 1024; // 2MB, tránh log phình to vô hạn

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
    /* best-effort, không để lỗi log làm crash app */
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
      // Trong dev vẫn in ra console để tiện theo dõi
      (level === "ERROR" ? console.error : console.log)(line.trim());
    }
  } catch {
    /* Nếu ghi log thất bại (disk full, quyền truy cập...), không được làm crash app */
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
