# Báo cáo kiểm tra bảo mật & bản fix — MediaGet 2.5.18

Cách kiểm chứng: `npm ci` → `npm run build` → `npm run test:security` (20 test hàm thuần).
Đã chạy thêm test end-to-end trên Electron thật (32 kiểm tra tấn công): bản gốc 20/32, bản fix 32/32.

## Lỗi đã sửa

| Mức | Vấn đề (bản gốc) | Cách sửa |
|---|---|---|
| Cao | `ytdlp-updater`: tải `yt-dlp.exe` rồi **chạy ngay** (`--version`) mà không xác minh gì; redirect không giới hạn host/giao thức | Tải vào file tạm → kiểm kích thước, chữ ký `MZ`, **SHA-256 theo SHA2-256SUMS chính thức** → mới thay thế; redirect chỉ https + github.com / *.githubusercontent.com; kiểm tag, giới hạn size, timeout, khóa chạy song song |
| Cao | `window.open`/điều hướng ra ngoài mở cửa sổ con **kế thừa preload `window.api`** (đã chứng minh gọi được IPC) | `setWindowOpenHandler` deny, chặn `will-navigate`/`will-redirect`; https mở bằng trình duyệt hệ thống |
| Cao | Dependency: electron 30 (hết hỗ trợ, nhiều CVE), electron-updater/builder-util-runtime (rò rỉ credential khi redirect), js-yaml DoS | electron `^44.5.1`, electron-updater `^6.8.9`, `npm audit fix` → **0 lỗ hổng ở dependencies chạy thực tế** |
| Trung bình | Không có CSP; renderer không sandbox | CSP chặt (chèn khi build): chặn inline script/eval/fetch ra ngoài; `sandbox: true`, từ chối mọi permission, chặn `<webview>` |
| Trung bình | IPC tin mọi nguồn; `quality`/`outputDir`/`id` không kiểm tra | `isTrustedSender` cho mọi kênh; whitelist `quality`; `outputDir` phải tuyệt đối, chặn `\\?\`, `\\.\`, UNC (trừ khi chọn qua hộp thoại); `id` regex; giới hạn số tải |
| Trung bình | CI/`fetch-ffmpeg` tải yt-dlp, node, ffmpeg **không checksum** rồi đóng gói vào installer | Xác minh SHA-256 (SHA2-256SUMS, SHASUMS256.txt, checksums.sha256); allowlist redirect |
| Trung bình | `--remote-components ejs:github` luôn bật: yt-dlp tải JS từ GitHub rồi chạy bằng node | Mặc định tắt; bật lại bằng biến môi trường `MEDIAGET_REMOTE_COMPONENTS=1` nếu YouTube báo "n challenge" |
| Thấp | URL không có `--` trước đối số; thư mục có `%` làm hỏng template `-o` (bug thật) | Thêm `--`; escape `%`→`%%` |
| Thấp | `where node/ffmpeg` qua shell, tìm trong cwd | `where.exe` không qua shell, chạy từ `%SystemRoot%` |
| Thấp | Log chứa URL kèm token; buffer stdout/stderr tăng vô hạn; ID bằng `Math.random` | Redact query/credentials; giới hạn 256KB; `crypto.getRandomValues` |
| Lỗi chức năng | Updater phát "checking" trước khi UI gắn listener; `execFileSync` chặn UI; GitHub API 403 (rate limit) làm hỏng cập nhật | Phát bằng `setImmediate`; chạy bất đồng bộ; fallback đọc tag qua redirect `/releases/latest` |

## Chưa xử lý được (cần bạn quyết định)

1. **Installer chưa ký mã (code signing)** — Windows SmartScreen cảnh báo, và auto-update chỉ dựa vào sha512 trong `latest.yml` cùng release. Nên mua/dùng chứng chỉ (hoặc Azure Trusted Signing) và đặt `win.signtoolOptions`.
2. **GitHub Actions** dùng tag (`@v4`) chứ chưa ghim SHA commit — nên ghim.
3. `electron-builder` 25 còn 3 cảnh báo **chỉ ở build-time** (`app-builder-lib`, `tar`, `esbuild`); sửa cần `electron-builder` ≥ 26 (thay đổi lớn, nên test riêng). Không nằm trong app người dùng cài.
4. SHA2-256SUMS cùng release nên không chống được việc chính repo yt-dlp bị chiếm; có thể bổ sung kiểm tra chữ ký GPG `SHA2-256SUMS.sig`.
5. `tools/node.exe` bundle "latest-v22.x" — nên ghim phiên bản cụ thể để build tái lập được.
6. Chưa thể chạy thử trên Windows thật (`yt-dlp.exe`, NSIS installer) — mới kiểm bằng Electron/Linux + typecheck + build. Hãy `npm run dist` và thử tải 1 video trước khi phát hành.
7. `NoNodeWarning.tsx` không được dùng ở đâu (code chết) — có thể xóa.
