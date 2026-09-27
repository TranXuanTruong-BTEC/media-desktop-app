#!/usr/bin/env node
/**
 * scripts/fetch-ffmpeg.js
 *
 * Tự động tải ffmpeg.exe (bản Windows tĩnh, LGPL) và đặt vào tools/ffmpeg.exe
 * để electron-builder đóng gói kèm app (xem "extraResources" trong package.json).
 * Nhờ vậy NGƯỜI DÙNG CUỐI KHÔNG CẦN TỰ CÀI FFMPEG — app tự mang theo.
 *
 * Dùng bản LGPL (không phải GPL) để tránh vướng nghĩa vụ cấp phép GPL khi
 * phân phối bản build — LGPL vẫn đủ codec cần cho remux/merge (-c copy) và
 * trích xuất mp3 (libmp3lame).
 *
 * Cách dùng:
 *   node scripts/fetch-ffmpeg.js            # best-effort, không fail nếu lỗi mạng
 *   node scripts/fetch-ffmpeg.js --required # bắt buộc phải có ffmpeg, lỗi thì exit 1
 *                                            # (dùng trước khi đóng gói bản release)
 *   FORCE_FFMPEG_DOWNLOAD=1 node scripts/fetch-ffmpeg.js   # tải lại dù đã có sẵn
 */

const https = require("https");
const fs    = require("fs");
const path  = require("path");
const os    = require("os");

const FFMPEG_ZIP_URL =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip";

const TOOLS_DIR = path.join(__dirname, "..", "tools");
const DEST      = path.join(TOOLS_DIR, "ffmpeg.exe");
const REQUIRED  = process.argv.includes("--required");

function log(msg)  { console.log(`[fetch-ffmpeg] ${msg}`); }
function fail(msg) {
  console.error(`[fetch-ffmpeg] ${msg}`);
  process.exit(REQUIRED ? 1 : 0); // best-effort: không chặn npm install nếu không bắt buộc
}

/** Tải 1 URL, tự follow redirect (GitHub release asset luôn redirect qua CDN). */
function download(url, destPath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const doRequest = (currentUrl, redirectsLeft) => {
      https.get(currentUrl, { headers: { "User-Agent": "media-desktop-app-ffmpeg-fetch" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (redirectsLeft <= 0) return reject(new Error("Quá nhiều redirect"));
          res.resume();
          doRequest(res.headers.location, redirectsLeft - 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} khi tải ${currentUrl}`));
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", reject);
      }).on("error", reject);
    };
    doRequest(url, maxRedirects);
  });
}

async function main() {
  if (fs.existsSync(DEST) && !process.env.FORCE_FFMPEG_DOWNLOAD) {
    log(`Đã có sẵn: ${DEST} — bỏ qua. (Đặt FORCE_FFMPEG_DOWNLOAD=1 để tải lại.)`);
    return;
  }

  fs.mkdirSync(TOOLS_DIR, { recursive: true });

  let AdmZip;
  try {
    AdmZip = require("adm-zip");
  } catch {
    fail(
      "Thiếu package 'adm-zip' để giải nén. Chạy `npm install` trước, " +
      "hoặc `npm install --save-dev adm-zip` rồi thử lại."
    );
    return;
  }

  const tmpZip = path.join(os.tmpdir(), `ffmpeg-download-${Date.now()}.zip`);

  try {
    log("Đang tải ffmpeg (bản Windows LGPL, ~140MB, có thể mất vài phút)...");
    await download(FFMPEG_ZIP_URL, tmpZip);

    log("Đang giải nén ffmpeg.exe từ file zip...");
    const zip     = new AdmZip(tmpZip);
    const entries = zip.getEntries();
    const entry   = entries.find(e =>
      /\/bin\/ffmpeg\.exe$/i.test(e.entryName.replace(/\\/g, "/"))
    );

    if (!entry) {
      throw new Error("Không tìm thấy ffmpeg.exe bên trong file zip đã tải — có thể cấu trúc release đã đổi.");
    }

    fs.writeFileSync(DEST, entry.getData());

    const sizeMb = (fs.statSync(DEST).size / (1024 * 1024)).toFixed(1);
    log(`✓ Đã lưu ffmpeg.exe (${sizeMb} MB) vào ${DEST}`);
  } catch (err) {
    fail(
      `Không thể tải/giải nén ffmpeg tự động: ${err.message}\n` +
      "  → App vẫn chạy được, nhưng nếu thiếu tools/ffmpeg.exe thì khi tải video " +
      "sẽ tự hạ chất lượng (xem cảnh báo trong app) thay vì lỗi.\n" +
      "  → Bạn có thể tự tải ffmpeg.exe và đặt thủ công vào: " + DEST
    );
  } finally {
    fs.rm(tmpZip, { force: true }, () => {});
  }
}

main();
