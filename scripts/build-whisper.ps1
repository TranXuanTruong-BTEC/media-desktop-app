<#
  scripts/build-whisper.ps1
  Build whisper-cli.exe (whisper.cpp) từ MÃ NGUỒN đã ghim phiên bản + SHA-256 → tools\whisper-cli.exe

  - whisper.cpp v1.9.5 không còn kèm file .exe dựng sẵn trong Release, nên tự build.
  - Build TĨNH: CRT tĩnh (/MT), tắt OpenMP (vcomp140.dll) → exe chạy độc lập, không cần cài VC++ Redistributable.
  - CPU: AVX/AVX2/FMA/F16C bật, AVX512 tắt (chạy được trên hầu hết CPU x64 từ ~2013 trở lại; không dùng -march=native
    để bản build trên máy CI không "dính" lệnh CPU mà máy người dùng không có).

  Yêu cầu: Windows + Visual Studio Build Tools (C++) + CMake (có sẵn trên runner windows-latest của GitHub Actions).
  Chạy:    powershell -ExecutionPolicy Bypass -File scripts\build-whisper.ps1
#>
param(
  [string]$Tag    = "v1.9.5",
  [string]$Sha256 = "ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720",   # whisper.cpp-1.9.5.tar.gz
  [string]$OutDir = "tools"
)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$out  = Join-Path $root $OutDir
$work = Join-Path ([IO.Path]::GetTempPath()) ("whisper-build-" + $Tag)
$src  = Join-Path $work "src"
$bld  = Join-Path $work "build"
$tgz  = Join-Path $work "source.tar.gz"

if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Force -Path $work, $src, $out | Out-Null

Write-Host "==> Tải mã nguồn whisper.cpp $Tag"
Invoke-WebRequest -Uri "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/$Tag.tar.gz" -OutFile $tgz

$actual = (Get-FileHash $tgz -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $Sha256.ToLower()) { throw "SHA-256 của mã nguồn không khớp: mong đợi $Sha256, nhận $actual" }
Write-Host "OK: SHA-256 mã nguồn khớp ($actual)"

tar -xzf $tgz -C $src --strip-components=1
if ($LASTEXITCODE -ne 0) { throw "Giải nén mã nguồn thất bại" }

Write-Host "==> Cấu hình CMake"
cmake -S $src -B $bld -A x64 `
  -DCMAKE_BUILD_TYPE=Release `
  -DCMAKE_POLICY_DEFAULT_CMP0091=NEW -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded `
  -DBUILD_SHARED_LIBS=OFF `
  -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_AVX512=OFF `
  -DGGML_OPENMP=OFF `
  -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF
if ($LASTEXITCODE -ne 0) { throw "cmake configure thất bại" }

Write-Host "==> Build whisper-cli (Release)"
cmake --build $bld --config Release --target whisper-cli --parallel
if ($LASTEXITCODE -ne 0) { throw "cmake build thất bại" }

$exe = Join-Path $bld "bin\Release\whisper-cli.exe"
if (-not (Test-Path $exe)) { throw "Không thấy $exe sau khi build" }

Copy-Item $exe (Join-Path $out "whisper-cli.exe") -Force
$dest = Join-Path $out "whisper-cli.exe"

# Kiểm tra nhanh: exe phải khởi động được (không thiếu DLL) và in được phần trợ giúp.
$help = & $dest --help 2>&1 | Out-String
if ($help -notmatch "--output-srt") { throw "whisper-cli.exe chạy không đúng (không thấy --output-srt trong --help)" }
Write-Host ("OK: {0} ({1:N1} MB)" -f $dest, ((Get-Item $dest).Length / 1MB))
