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

const https  = require("https");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");
const crypto = require("crypto");

const FFMPEG_ZIP_NAME = "ffmpeg-master-latest-win64-lgpl.zip";
const BASE_URL        = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest";
const FFMPEG_ZIP_URL  = `${BASE_URL}/${FFMPEG_ZIP_NAME}`;
const CHECKSUMS_URL   = `${BASE_URL}/checksums.sha256`;

// Bảo mật: chỉ theo redirect https tới GitHub / CDN của GitHub; luôn xác minh SHA-256.
const ALLOWED_HOSTS = ["github.com", "githubusercontent.com"];
const MAX_ZIP_BYTES = 400 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;

const TOOLS_DIR = path.join(__dirname, "..", "tools");
const DEST      = path.join(TOOLS_DIR, "ffmpeg.exe");
const REQUIRED  = process.argv.includes("--required");

function log(msg)  { console.log(`[fetch-ffmpeg] ${msg}`); }
function fail(msg) {
  console.error(`[fetch-ffmpeg] ${msg}`);
  process.exit(REQUIRED ? 1 : 0); // best-effort: không chặn npm install nếu không bắt buộc
}

function isAllowedHost(h) {
  h = String(h).toLowerCase();
  return ALLOWED_HOSTS.some(a => h === a || h.endsWith("." + a));
}

/** Mở GET https, tự follow redirect nhưng CHỈ khi đích là https + host GitHub. */
function open(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error("URL không hợp lệ")); }
    if (u.protocol !== "https:" || !isAllowedHost(u.hostname)) {
      return reject(new Error(`Từ chối URL không nằm trong allowlist: ${u.protocol}//${u.host}`));
    }
    https.get(u, { headers: { "User-Agent": "media-desktop-app-ffmpeg-fetch" }, timeout: 30000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error("Quá nhiều redirect"));
        return resolve(open(new URL(res.headers.location, u).toString(), redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} khi tải ${u.origin}${u.pathname}`));
      }
      resolve(res);
    }).on("timeout", function () { this.destroy(new Error("Hết thời gian chờ")); })
      .on("error", reject);
  });
}

async function fetchText(url) {
  const res = await open(url);
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    res.on("data", c => {
      size += c.length;
      if (size > MAX_TEXT_BYTES) return res.destroy(new Error("Phản hồi quá lớn"));
      chunks.push(c);
    });
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    res.on("error", reject);
  });
}

async function download(url, destPath) {
  const res = await open(url);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const hash = crypto.createHash("sha256");
    let size = 0;
    res.on("data", c => {
      size += c.length;
      if (size > MAX_ZIP_BYTES) return res.destroy(new Error("File vượt quá kích thước cho phép"));
      hash.update(c);
    });
    res.on("error", e => { file.destroy(); reject(e); });
    res.on("close", () => { if (!res.complete) { file.destroy(); reject(new Error("Kết nối bị ngắt giữa chừng")); } });
    file.on("error", reject);
    file.on("close", () => { if (res.complete) resolve(hash.digest("hex")); });
    res.pipe(file);
  });
}

function expectedSha256(checksumsText, filename) {
  for (const line of checksumsText.split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m && m[2].trim() === filename) return m[1].toLowerCase();
  }
  return null;
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
    log("Đang lấy checksum chính thức (checksums.sha256)...");
    const expected = expectedSha256(await fetchText(CHECKSUMS_URL), FFMPEG_ZIP_NAME);
    if (!expected) throw new Error(`Không tìm thấy checksum của ${FFMPEG_ZIP_NAME} — không thể xác minh, từ chối tiếp tục.`);

    log("Đang tải ffmpeg (bản Windows LGPL, ~140MB, có thể mất vài phút)...");
    const actual = await download(FFMPEG_ZIP_URL, tmpZip);
    if (actual !== expected) {
      throw new Error(`SHA-256 không khớp (mong đợi ${expected}, nhận ${actual}) — file bị từ chối.`);
    }
    log("✓ Checksum SHA-256 khớp.");

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
