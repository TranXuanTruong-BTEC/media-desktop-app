[README.md](https://github.com/user-attachments/files/26334994/README.md)
# MediaGet

> Tải video và audio từ YouTube, TikTok, Facebook, Twitter, Instagram và 1000+ trang web — nhanh, gọn, không quảng cáo.

![Platform](https://img.shields.io/badge/platform-Windows-blue?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-30-47848F?style=flat-square&logo=electron)
![Version](https://img.shields.io/github/v/release/TranXuanTruong-BTEC/media-desktop-app?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)

---

## Tính năng

- **Tải video & audio** từ YouTube, TikTok, Facebook, Twitter, Instagram và hơn 1000 trang
- **Nhiều chất lượng**: Best, 1080p, 720p, 480p, 360p, MP3, M4A
- **Tải nhiều cùng lúc** với hàng đợi trực quan
- **Tự động cập nhật** — thông báo khi có phiên bản mới, cài đặt chỉ 1 click
- **Giao diện tối** native, không Chrome frame, điều khiển cửa sổ tuỳ chỉnh
- **Không cần cài Node.js** — đã bundle sẵn yt-dlp + node portable

---

## Cài đặt

### Tải bản cài đặt (khuyến nghị)

1. Vào trang [**Releases**](https://github.com/TranXuanTruong-BTEC/media-desktop-app/releases/latest)
2. Tải file `MediaGet-Setup.exe`
3. Chạy installer và làm theo hướng dẫn

### Build từ source

**Yêu cầu:** Node.js 20+, npm

```bash
# Clone repo
git clone https://github.com/TranXuanTruong-BTEC/media-desktop-app.git
cd media-desktop-app

# Cài dependencies
npm install

# Tải yt-dlp.exe vào thư mục tools/
mkdir tools
# Windows (PowerShell):
Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile "tools/yt-dlp.exe"

# Chạy dev mode
npm run dev

# Build installer
npm run dist
```

---

## Sử dụng

1. Dán link video vào ô nhập liệu
2. Chọn chất lượng (mặc định: tốt nhất tự động)
3. Chọn thư mục lưu (mặc định: Downloads)
4. Bấm **Tải xuống**

Có thể tải nhiều video cùng lúc — mỗi video hiện tiến trình, tốc độ và thời gian còn lại riêng.

---

## Tự động cập nhật

Khi có phiên bản mới, app sẽ **tự động kiểm tra** lúc khởi động và hiển thị dialog thông báo:

- **"Cập nhật ngay"** — tải bản mới ngầm, không gián đoạn việc tải
- **"Để sau"** — bỏ qua, nhắc lại lần sau
- Sau khi tải xong → bấm **"Cài & khởi động lại"** để áp dụng

---

## Phát hành phiên bản mới

```bash
# 1. Tăng version trong package.json
#    "version": "2.1.0"

# 2. Commit + tag + push
git add .
git commit -m "release: v2.1.0"
git tag v2.1.0
git push origin main --tags
```

GitHub Actions sẽ tự động build và upload `MediaGet-Setup.exe` + `latest.yml` lên Releases (~5–10 phút).

> **Lưu ý:** Cần có secret `GH_TOKEN` trong repository Settings → Secrets → Actions.

---

## Cấu trúc dự án

```
media-desktop-app/
├── src/
│   ├── main/                  # Electron main process
│   │   ├── main.ts            # Entry point, tạo cửa sổ
│   │   ├── preload.ts         # Bridge main ↔ renderer
│   │   └── ipc/
│   │       ├── download.ts    # Xử lý tải video (yt-dlp)
│   │       └── updater.ts     # Auto-updater (electron-updater)
│   ├── renderer/              # React UI
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── components/
│   │       │   ├── Titlebar.tsx
│   │       │   ├── DownloadForm.tsx
│   │       │   ├── DownloadItem.tsx
│   │       │   ├── StatusBar.tsx
│   │       │   ├── UpdateDialog.tsx  # Dialog cập nhật
│   │       │   └── NoNodeWarning.tsx
│   │       └── hooks/
│   │           ├── useDownload.ts
│   │           └── useUpdater.ts     # Hook quản lý update state
│   └── shared/
│       └── ipc-types.ts       # Types dùng chung
├── tools/                     # yt-dlp.exe, node.exe (không commit)
├── build/                     # Icon, resources
├── .github/workflows/
│   └── build.yml              # CI/CD tự động build + release
├── package.json
└── vite.config.ts
```

---

## Công nghệ sử dụng

| Thành phần | Công nghệ |
|---|---|
| Desktop framework | Electron 30 |
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS 3 |
| Bundler | Vite |
| Video downloader | yt-dlp |
| Auto-updater | electron-updater |
| CI/CD | GitHub Actions |
| Installer | NSIS (electron-builder) |

---

## Yêu cầu hệ thống

- **OS:** Windows 10 / 11 (64-bit)
- **RAM:** 150 MB trở lên
- **Dung lượng:** ~120 MB (đã bao gồm runtime)
- Không cần cài Node.js hay Python

---

## Đóng góp

Pull request và issue luôn được chào đón.

1. Fork repo
2. Tạo branch: `git checkout -b feature/ten-tinh-nang`
3. Commit: `git commit -m "feat: thêm tính năng X"`
4. Push: `git push origin feature/ten-tinh-nang`
5. Mở Pull Request

---

## Tác giả

**TranXuanTruong-BTEC** — [GitHub](https://github.com/TranXuanTruong-BTEC)

---

## License

MIT © TranXuanTruong-BTEC
