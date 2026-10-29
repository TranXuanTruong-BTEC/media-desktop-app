#!/usr/bin/env node
// scripts/check-whisper.js — đảm bảo tools/whisper-cli.exe có mặt trước khi đóng gói installer.
// Trên CI (biến CI=true) thiếu file là LỖI; khi build trên máy cá nhân chỉ cảnh báo.
const fs = require("fs");
const path = require("path");
const exe = path.join(__dirname, "..", "tools", "whisper-cli.exe");
if (fs.existsSync(exe)) { console.log("[whisper] OK:", exe); process.exit(0); }
const msg = "[whisper] Thiếu tools/whisper-cli.exe — tính năng \"Trích văn bản\" sẽ không chạy trong bản cài.\n" +
            "          Chạy:  npm run build:whisper   (cần Visual Studio Build Tools + CMake)";
if (process.env.CI) { console.error(msg); process.exit(1); }
console.warn(msg);
