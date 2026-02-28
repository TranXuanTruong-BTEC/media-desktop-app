# Media Desktop App

Ứng dụng desktop tải video (YouTube, v.v.) bằng [yt-dlp](https://github.com/yt-dlp/yt-dlp), xây trên Electron + React + TypeScript + Vite.

## Yêu cầu

- **Node.js** (khuyến nghị 18+)
- **yt-dlp** — bắt buộc, cài và thêm vào PATH:
  - Windows: `winget install yt-dlp` hoặc tải từ [releases](https://github.com/yt-dlp/yt-dlp/releases)
  - macOS: `brew install yt-dlp`

## Cài đặt

```bash
npm install
```

## Chạy chế độ phát triển

Mở **hai** terminal:

**Terminal 1 — Vite (giao diện):**
```bash
npm run dev
```

**Terminal 2 — Electron (sau khi Vite đã chạy):**
```bash
npm run build:main
npx electron .
```

Hoặc build main một lần rồi chạy electron nhiều lần:
```bash
npm run build:main
npx electron .
```

## Build bản production

```bash
npm run build
```

Sau đó chạy:
```bash
npx electron .
```

(Trong môi trường production đóng gói, `app.isPackaged` sẽ là `true` và app sẽ load file từ `dist/renderer` thay vì localhost.)

## Chức năng

- Dán link video (YouTube, v.v.) và tải xuống
- Chọn định dạng/chất lượng: MP4, tốt nhất, video+audio tốt nhất, hoặc chất lượng thấp
- Chọn thư mục lưu file (mặc định: thư mục Tải xuống của hệ điều hành)
- Hiển thị trạng thái và thông báo lỗi (kể cả khi chưa cài yt-dlp)

## Cấu trúc thư mục

- `src/main/` — process chính Electron (cửa sổ, IPC, gọi yt-dlp)
- `src/renderer/` — giao diện React (Vite)
- `dist/` — output build (main + renderer)

## Tải app cho người dùng (GitHub Releases)

User có thể tải file `.exe` từ [GitHub Releases](https://github.com/TranXuanTruong-BTEC/media-desktop-app/releases/latest).

**Để tạo bản Release mới:**

1. Cập nhật `version` trong `package.json` (ví dụ: `1.0.1`)
2. Commit và push code
3. Tạo tag và push:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```
4. GitHub Actions sẽ tự build và publish lên Releases (kèm yt-dlp + ffmpeg)

Hoặc vào **Actions → Release → Run workflow** để build thủ công.

## Scripts

| Script | Mô tả |
|--------|--------|
| `npm run dev` | Chạy Vite dev server |
| `npm run build:main` | Build process chính Electron |
| `npm run build:renderer` | Build giao diện (Vite) |
| `npm run build` | Build cả main và renderer |
| `npm run dist` | Build full + tạo file .exe (cần có thư mục `tools/` với yt-dlp.exe, ffmpeg.exe) |
| `npx electron .` | Chạy app Electron (sau khi build main hoặc build full) |
