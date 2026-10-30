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

## Đóng góp

Pull request và issue luôn được chào đón.

1. Fork repo
2. Tạo branch: `git checkout -b feature/tentinhnang`
3. Commit: `git commit -m "feat: thêm tính năng X"`
4. Push: `git push origin feature/tentinhnang`
5. Mở Pull Request

---

## Tác giả

**TranXuanTruong-BTEC** — [GitHub](https://github.com/TranXuanTruong-BTEC)

---

## License

MIT © TranXuanTruong-BTEC
