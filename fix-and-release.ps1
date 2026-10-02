# ============================================================
# Sua workflow build.yml, nang version, xoa tag/release v2.5.10
# hong, tao tag v2.5.11 moi de kich hoat Actions build lai dung.
# Chay script nay tu thu muc goc cua du an (noi co file package.json).
# ============================================================

$ErrorActionPreference = "Stop"

Write-Host "1) Dong bo voi remote..." -ForegroundColor Cyan
git pull origin main

Write-Host "2) Ghi workflow da sua vao .github/workflows/build.yml..." -ForegroundColor Cyan
$workflowContent = @'
name: Build & Release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      version:
        description: 'Version (e.g. 2.0.1)'
        required: true
        default: '2.0.0'

permissions:
  contents: write

jobs:
  build-windows:
    runs-on: windows-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Download yt-dlp.exe
        shell: powershell
        run: |
          New-Item -ItemType Directory -Force -Path tools
          Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile "tools/yt-dlp.exe"

      - name: Download node.exe (portable)
        shell: powershell
        run: |
          Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.11.1/win-x64/node.exe" -OutFile "tools/node.exe"

      - name: Build app
        run: npm run build

      # CI là NƠI DUY NHẤT phát hành. electron-builder chỉ build (không tự upload)
      # để tránh 2 nguồn cùng ghi đè lên release -> exe và latest.yml lệch nhau.
      - name: Build installer (.exe)
        run: npm run dist -- --publish never

      # KHÔNG dựa vào electron-builder tự sinh latest.yml nữa (đã gặp trường hợp
      # nó không sinh ra hoặc sinh lệch mà không rõ lý do trên máy CI thật).
      # Tự tính sha512 + size từ CHÍNH file .exe vừa build ra và tự viết
      # latest.yml — đảm bảo 2 file này KHÔNG THỂ lệch nhau, vì cùng lấy dữ liệu
      # từ một nguồn duy nhất tại đây.
      - name: Generate latest.yml from the built installer
        shell: powershell
        run: |
          $exe = Get-Item release/MediaGet-Setup.exe
          $hash = (Get-FileHash -Algorithm SHA512 -Path $exe.FullName).Hash
          $bytes = [byte[]] -split ($hash -replace '..', '0x$& ')
          $sha512 = [Convert]::ToBase64String($bytes)
          $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
          $date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
          @"
          version: $version
          files:
            - url: $($exe.Name)
              sha512: $sha512
              size: $($exe.Length)
          path: $($exe.Name)
          sha512: $sha512
          releaseDate: '$date'
          "@ | Set-Content -Encoding utf8 release/latest.yml
          Write-Host "Da tao release/latest.yml cho $($exe.Name) ($($exe.Length) bytes)"
          Get-Content release/latest.yml

      # Kiểm tra lại cho chắc: parse lại latest.yml vừa tạo và so sánh với file thật
      - name: Verify update metadata matches installer
        shell: powershell
        run: |
          $exe = Get-Item release/MediaGet-Setup.exe
          $yml = Get-Content release/latest.yml -Raw
          if ($yml -notmatch "size:\s*(\d+)") { throw "latest.yml khong co size" }
          if ([int64]$Matches[1] -ne $exe.Length) { throw "latest.yml size ($($Matches[1])) khac exe ($($exe.Length))" }
          Write-Host "OK: latest.yml khop installer ($($exe.Length) bytes)"

      - name: Upload artifact
        if: success()
        uses: actions/upload-artifact@v4
        with:
          name: MediaGet-Windows
          path: |
            release/*.exe
            release/latest.yml
          retention-days: 30

      # if: PHẢI có success() ở đầu — nếu không, bước này vẫn chạy dù bước
      # trước lỗi (đây chính là lỗi khiến release v2.5.9 chỉ có .exe, thiếu
      # latest.yml: bước kiểm tra lỗi nhưng bước tạo release vẫn cứ chạy).
      - name: Create GitHub Release
        if: success() && startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
        with:
          # Chỉ upload .exe + latest.yml tự tạo ở trên (đã đảm bảo khớp nhau).
          # Bỏ .blockmap: có nó thì electron-updater tải phần chênh lệch, dễ vỡ
          # nếu bản trước bị lỗi; không có thì tải nguyên file .exe, chậm hơn
          # một chút nhưng chắc chắn không tái diễn lỗi checksum mismatch.
          files: |
            release/*.exe
            release/latest.yml
          fail_on_unmatched_files: true
          generate_release_notes: true
          token: ${{ secrets.GITHUB_TOKEN }}
'@
New-Item -ItemType Directory -Force -Path ".github/workflows" | Out-Null
Set-Content -Path ".github/workflows/build.yml" -Value $workflowContent -Encoding utf8 -NoNewline

Write-Host "3) Nang version len 2.5.11 trong package.json..." -ForegroundColor Cyan
$pkg = Get-Content package.json -Raw
$pkg = $pkg -replace '"version":\s*"[^"]+"', '"version": "2.5.11"'
Set-Content -Path package.json -Value $pkg -Encoding utf8 -NoNewline

Write-Host "4) Commit va push len main..." -ForegroundColor Cyan
git add .github/workflows/build.yml package.json
git commit -m "ci: tu sinh latest.yml tu file exe that, sua if thieu success(); bump 2.5.11"
git push origin main

Write-Host "5) Xoa tag v2.5.10 hong tren remote (bo qua neu khong ton tai)..." -ForegroundColor Cyan
git push origin --delete v2.5.10 2>$null
if (Test-Path .git) { git tag -d v2.5.10 2>$null | Out-Null }

Write-Host "6) Tao tag v2.5.11 va day len de kich hoat Actions..." -ForegroundColor Cyan
git tag v2.5.11
git push origin v2.5.11

Write-Host ""
Write-Host "XONG. Mo https://github.com/TranXuanTruong-BTEC/media-desktop-app/actions de theo doi build." -ForegroundColor Green
Write-Host "Luu y: vao GitHub > Releases > v2.5.10 > Delete de xoa release hong cu (khong bat buoc, chi de don dep)." -ForegroundColor Yellow
