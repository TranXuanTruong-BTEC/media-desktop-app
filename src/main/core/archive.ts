// src/main/core/archive.ts
// Giải nén .zip bằng công cụ có sẵn của hệ điều hành (Windows 10+: tar.exe/bsdtar; còn lại: unzip).
// bsdtar/unzip mặc định từ chối đường dẫn tuyệt đối và ".." (chống zip-slip); file zip cũng đã được kiểm SHA-256 trước đó.
import { spawn } from "child_process";
import path from "path";

export function extractZip(zipPath: string, destDir: string): Promise<void> {
  const isWin = process.platform === "win32";
  const cmd = isWin
    ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
    : "unzip";
  const args = isWin ? ["-xf", zipPath, "-C", destDir] : ["-q", "-o", zipPath, "-d", destDir];

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let err = "";
    child.stderr?.on("data", (d: Buffer) => { if (err.length < 2000) err += d.toString(); });
    child.on("error", (e) => reject(new Error(`Không chạy được công cụ giải nén (${cmd}): ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Giải nén thất bại (mã ${code}): ${err.trim().split("\n").pop() ?? ""}`));
    });
  });
}
