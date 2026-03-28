# MediaGet v2.0

> Ứng dụng tải video/audio chuyên nghiệp — Electron + React + yt-dlp

[![Build & Release](https://github.com/TranXuanTruong-BTEC/media-desktop-app/actions/workflows/build.yml/badge.svg)](https://github.com/TranXuanTruong-BTEC/media-desktop-app/actions/workflows/build.yml)
[![Latest Release](https://img.shields.io/github/v/release/TranXuanTruong-BTEC/media-desktop-app)](https://github.com/TranXuanTruong-BTEC/media-desktop-app/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/TranXuanTruong-BTEC/media-desktop-app/total)](https://github.com/TranXuanTruong-BTEC/media-desktop-app/releases)

## ⬇️ Tải về

**[→ Download MediaGet-Setup.exe (Windows)](https://github.com/TranXuanTruong-BTEC/media-desktop-app/releases/latest/download/MediaGet-Setup.exe)**

## ✨ Tính năng

- 🎵 Tải MP3 chất lượng cao (320kbps)
- 🎬 Tải MP4 lên đến 1080p Full HD
- 📋 Hỗ trợ YouTube, TikTok, Facebook, Instagram, Twitter và 1000+ trang
- ⚡ Tải nhiều video cùng lúc với hàng đợi thông minh
- 📊 Thanh tiến trình realtime: %, tốc độ, ETA
- ❌ Hủy download bất kỳ lúc nào
- 🚀 Không quảng cáo, không cài thêm phần mềm rác

## 💻 Yêu cầu

- Windows 10/11 (64-bit)

---

## 🛠️ Phát triển

```bash
git clone https://github.com/TranXuanTruong-BTEC/media-desktop-app.git
cd media-desktop-app
npm install
```

### Chuẩn bị tools/

| File | Link tải |
|------|----------|
| `yt-dlp.exe` | [yt-dlp/releases](https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe) |
| `node.exe` | [nodejs.org](https://nodejs.org/dist/latest/win-x64/node.exe) |

```bash
npm run dev      # Chạy dev
npm run dist     # Build .exe
```

## 🚀 Tạo release mới

```bash
git tag v2.0.1
git push origin v2.0.1
# GitHub Actions tự build và upload MediaGet-Setup.exe
```
