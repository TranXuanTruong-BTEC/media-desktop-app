#!/usr/bin/env node
/**
 * scripts/security-selftest.js
 * Chạy:  npm run test:security   (tự build main rồi chạy file này)
 *
 * Kiểm thử các hàm thuần trong src/main/core/security.ts: validate đầu vào IPC,
 * allowlist redirect, parse/verify checksum, redact log...
 */
const assert = require("assert");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");
const sec    = require("../dist-electron/main/core/security.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ✓", name); }
  catch (e) { failed++; console.error("  ✗", name, "\n     ", e.message); }
}
async function atest(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { failed++; console.error("  ✗", name, "\n     ", e.message); }
}

(async () => {
console.log("isValidId");
test("chấp nhận id hợp lệ", () => {
  for (const id of ["a1b2c3d4", "abc_DEF-123", "0123456789abcdef01234567"]) assert.ok(sec.isValidId(id), id);
});
test("từ chối id xấu", () => {
  for (const id of ["", "a b", "../x", "a/b", "x".repeat(65), 123, null, undefined, {}, "id\n"]) assert.ok(!sec.isValidId(id), String(id));
});

console.log("isValidDownloadUrl");
test("chấp nhận http/https", () => {
  for (const u of ["https://www.youtube.com/watch?v=abc", "http://example.com/a.mp4", "https://vm.tiktok.com/ZM123/"]) assert.ok(sec.isValidDownloadUrl(u), u);
});
test("từ chối scheme lạ / định dạng xấu", () => {
  const bad = ["javascript:alert(1)", "file:///C:/Windows/win.ini", "ftp://x.com/a", "--exec=calc", "-o C:\\x",
    "http://", "https:// spaced.com", "https://a.com/\nfoo", "", "http", "https://" + "a".repeat(3000) + ".com", null, 5, {}];
  for (const u of bad) assert.ok(!sec.isValidDownloadUrl(u), String(u).slice(0, 40));
});

console.log("validateOutputDir (Windows)");
const w = path.win32;
test("thư mục thường được chấp nhận + chuẩn hoá", () => {
  assert.strictEqual(sec.validateOutputDir("C:\\Users\\a\\Downloads", new Set(), w), "C:\\Users\\a\\Downloads");
  assert.strictEqual(sec.validateOutputDir("C:\\Users\\a\\..\\b", new Set(), w), "C:\\Users\\b");
  assert.strictEqual(sec.validateOutputDir("D:\\Tải về\\Video 100%", new Set(), w), "D:\\Tải về\\Video 100%");
});
test("từ chối đường dẫn tương đối / rỗng / NUL / quá dài / sai kiểu", () => {
  for (const d of ["", "downloads", "..\\x", ".\\x", "C:rel", "C:\\a\0b", "C:\\" + "a".repeat(500), null, 7, {}])
    assert.strictEqual(sec.validateOutputDir(d, new Set(), w), null, String(d).slice(0, 30));
});
test("chặn UNC trừ khi người dùng đã chọn qua hộp thoại", () => {
  assert.strictEqual(sec.validateOutputDir("\\\\attacker\\share\\x", new Set(), w), null);
  assert.strictEqual(sec.validateOutputDir("//attacker/share/x", new Set(), w), null);
  const allowed = new Set([w.normalize("\\\\nas\\media")]);
  // win32.normalize thêm "\\" cuối cho UNC — vô hại với path.join
  assert.strictEqual(sec.validateOutputDir("\\\\nas\\media", allowed, w), w.normalize("\\\\nas\\media"));
  assert.strictEqual(sec.validateOutputDir("\\\\nas\\other", allowed, w), null);
});
test("chặn namespace thiết bị \\\\?\\ và \\\\.\\", () => {
  assert.strictEqual(sec.validateOutputDir("\\\\?\\C:\\x", new Set(["\\\\?\\C:\\x"]), w), null);
  assert.strictEqual(sec.validateOutputDir("\\\\.\\pipe\\evil", new Set(), w), null);
});
console.log("validateOutputDir (POSIX, môi trường dev)");
test("tuyệt đối OK, tương đối bị chặn", () => {
  assert.strictEqual(sec.validateOutputDir("/home/u/Downloads", new Set(), path.posix), "/home/u/Downloads");
  assert.strictEqual(sec.validateOutputDir("home/u", new Set(), path.posix), null);
});

console.log("escapeOutputTemplate");
test("escape % để không bị hiểu là template yt-dlp", () => {
  assert.strictEqual(sec.escapeOutputTemplate("C:\\Tai 100%"), "C:\\Tai 100%%");
  assert.strictEqual(sec.escapeOutputTemplate("C:\\x%(title)s"), "C:\\x%%(title)s");
  assert.strictEqual(sec.escapeOutputTemplate("C:\\plain"), "C:\\plain");
});

console.log("resolveSafeRedirect");
const base = "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe";
test("cho phép https tới GitHub + CDN", () => {
  for (const l of ["https://release-assets.githubusercontent.com/x?y=1", "https://objects.githubusercontent.com/a", "https://github.com/a/b", "/yt-dlp/other/path"])
    assert.ok(sec.resolveSafeRedirect(l, base), l);
});
test("chặn http, host lạ, host giả mạo, scheme lạ", () => {
  for (const l of ["http://github.com/a", "https://evil.com/a", "https://github.com.evil.com/a", "https://evilgithub.com/a",
    "https://githubusercontent.com.evil.io/", "ftp://github.com/a", "file:///etc/passwd", "javascript:alert(1)", "//evil.com/a", "https://evil.com\\@github.com/"])
    assert.strictEqual(sec.resolveSafeRedirect(l, base), null, l);
});

console.log("isValidYtdlpTag");
test("tag hợp lệ / không hợp lệ", () => {
  for (const t of ["2026.08.19", "2026.08.19.1", "2025.03.31"]) assert.ok(sec.isValidYtdlpTag(t), t);
  for (const t of ["", "latest", "2026.8.19", "../../x", "2026.08.19/../../evil", "2026.08.19\n", "v2026.08.19", null, 5]) assert.ok(!sec.isValidYtdlpTag(t), String(t));
});

console.log("parseSha256Sums");
const H = "66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a";
test("đọc hash đúng dòng (cả dạng '*name' và CRLF)", () => {
  const txt = `1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6  yt-dlp\r\n${H.toUpperCase()}  yt-dlp.exe\r\n072aad4f2a7604e92155f61a275a4752dc64046c8f6d90df3710525d94cd37c1 *yt-dlp.tar.gz\n`;
  assert.strictEqual(sec.parseSha256Sums(txt, "yt-dlp.exe"), H);
  assert.strictEqual(sec.parseSha256Sums(txt, "yt-dlp.tar.gz"), "072aad4f2a7604e92155f61a275a4752dc64046c8f6d90df3710525d94cd37c1");
  assert.strictEqual(sec.parseSha256Sums(txt, "yt-dlp"), "1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6");
});
test("không khớp tên → null (không match theo hậu tố)", () => {
  assert.strictEqual(sec.parseSha256Sums(`${H}  yt-dlp.exe`, "dlp.exe"), null);
  assert.strictEqual(sec.parseSha256Sums(`${H}  evil-yt-dlp.exe`, "yt-dlp.exe"), null);
  assert.strictEqual(sec.parseSha256Sums("rác", "yt-dlp.exe"), null);
  assert.strictEqual(sec.parseSha256Sums(`${H.slice(0, 60)}  yt-dlp.exe`, "yt-dlp.exe"), null);
});

console.log("sha256File / looksLikeWindowsExe");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sec-"));
const f1 = path.join(tmp, "abc.bin"), f2 = path.join(tmp, "pe.exe"), f3 = path.join(tmp, "html.exe");
fs.writeFileSync(f1, "abc");
fs.writeFileSync(f2, Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]));
fs.writeFileSync(f3, "<html>404</html>");
await atest("sha256('abc') đúng vector chuẩn", async () => {
  assert.strictEqual(await sec.sha256File(f1), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
await atest("file không tồn tại → reject", async () => {
  await assert.rejects(() => sec.sha256File(path.join(tmp, "nope")));
});
test("nhận diện PE bằng 'MZ'", () => {
  assert.ok(sec.looksLikeWindowsExe(f2));
  assert.ok(!sec.looksLikeWindowsExe(f3));
  assert.ok(!sec.looksLikeWindowsExe(path.join(tmp, "nope")));
});
fs.rmSync(tmp, { recursive: true, force: true });

console.log("redactUrl / appendCapped");
test("redactUrl bỏ query, hash, credentials", () => {
  const r = sec.redactUrl("https://user:pw@a.com/v?token=SECRET&sig=XYZ#frag");
  assert.ok(!/SECRET|XYZ|pw|frag|user/.test(r), r);
  assert.strictEqual(sec.redactUrl("https://a.com/path"), "https://a.com/path");
  assert.strictEqual(sec.redactUrl("not a url"), "[invalid-url]");
  assert.strictEqual(sec.redactUrl(null), "[non-string]");
});
test("appendCapped giữ phần đuôi, không vượt giới hạn", () => {
  assert.strictEqual(sec.appendCapped("abc", "def", 100), "abcdef");
  assert.strictEqual(sec.appendCapped("abcdef", "ghi", 4), "fghi");
  let b = ""; for (let i = 0; i < 1000; i++) b = sec.appendCapped(b, "x".repeat(1000), 5000);
  assert.strictEqual(b.length, 5000);
});


console.log("normalizeDownloadUrl (Douyin / link dán dính)");
const urlmod = require("../dist-electron/shared/url.js");
test("link dán dính đôi (đúng lỗi người dùng gặp) → lấy link đầu", () => {
  const d = "https://www.douyin.com/jingxuan?modal_id=7697621631518166282";
  assert.strictEqual(urlmod.normalizeDownloadUrl(d + d), "https://www.douyin.com/video/7697621631518166282");
});
test("Douyin modal_id ở mọi trang → /video/ID", () => {
  for (const u of ["https://www.douyin.com/jingxuan?modal_id=7697621631518166282", "https://www.douyin.com/discover?modal_id=7697621631518166282",
    "https://www.douyin.com/user/MS4wLjABAAAA?modal_id=7697621631518166282&from_tab_name=main", "https://douyin.com/search/abc?modal_id=7697621631518166282&type=general",
    "https://www.douyin.com/video/7697621631518166282?previous_page=app_code_link"])
    assert.strictEqual(urlmod.normalizeDownloadUrl(u), "https://www.douyin.com/video/7697621631518166282", u);
});
test("đoạn chia sẻ Douyin (có chữ Trung) → trích link", () => {
  const share = "7.43 复制打开抖音，看看【某某的作品】电影解说 https://v.douyin.com/AbCdEf1/ 12/05 abc:/ 【打开】";
  assert.strictEqual(urlmod.normalizeDownloadUrl(share), "https://v.douyin.com/AbCdEf1/");
});
test("link khác giữ nguyên; không có link → null; không đụng YouTube/TikTok", () => {
  assert.strictEqual(urlmod.normalizeDownloadUrl("https://www.youtube.com/watch?v=abc&t=5"), "https://www.youtube.com/watch?v=abc&t=5");
  assert.strictEqual(urlmod.normalizeDownloadUrl("https://www.tiktok.com/@a/video/123?lang=vi"), "https://www.tiktok.com/@a/video/123?lang=vi");
  assert.strictEqual(urlmod.normalizeDownloadUrl("không có link"), null);
  assert.strictEqual(urlmod.normalizeDownloadUrl("javascript:alert(1)"), null);
  assert.strictEqual(urlmod.normalizeDownloadUrl("https://v.douyin.com/x/https://v.douyin.com/y/"), "https://v.douyin.com/x/");
});


console.log("transcribe-utils (SRT / model / tiến độ)");
const tu = require("../dist-electron/main/core/transcribe-utils.js");
test("catalog model hợp lệ (sha1 40 hex, id/file duy nhất, có model mặc định)", () => {
  const ids = new Set(), files = new Set();
  for (const m of tu.WHISPER_MODELS) {
    assert.match(m.sha1, /^[0-9a-f]{40}$/); assert.match(m.file, /^ggml-[a-z0-9._-]+\.bin$/);
    ids.add(m.id); files.add(m.file); assert.ok(m.sizeMB > 100);
    assert.strictEqual(new URL(tu.modelUrl(m.file)).hostname, "huggingface.co");
  }
  assert.strictEqual(ids.size, tu.WHISPER_MODELS.length); assert.strictEqual(files.size, tu.WHISPER_MODELS.length);
  assert.strictEqual(tu.getModel("turbo").file, "ggml-large-v3-turbo-q5_0.bin");
  assert.strictEqual(tu.getModel("../../x"), null);
});
test("allowlist redirect của model: HF + CDN .hf.co được, host giả bị chặn", () => {
  const base = tu.modelUrl("ggml-small.bin");
  for (const l of ["https://cas-bridge.xethub.hf.co/a?sig=1", "https://cdn-lfs.huggingface.co/x", "/api/resolve-cache/x"])
    assert.ok(sec.resolveSafeRedirect(l, base, tu.MODEL_HOSTS), l);
  for (const l of ["http://huggingface.co/x", "https://huggingface.co.evil.com/x", "https://evilhf.co/x", "https://github.com/x"])
    assert.strictEqual(sec.resolveSafeRedirect(l, base, tu.MODEL_HOSTS), null, l);
});
test("isMediaFile chỉ nhận đuôi media", () => {
  for (const f of ["C:\\v\\a.MP4", "/x/测试.mkv", "D:\\a b\\c.m4a"]) assert.ok(tu.isMediaFile(f), f);
  for (const f of ["C:\\a.exe", "x.txt", "noext", "", null, 5, "a.mp4\0.exe"]) assert.ok(!tu.isMediaFile(f), String(f));
});
test("safeFolderName: bỏ ký tự cấm, tên thiết bị, dấu chấm cuối", () => {
  assert.strictEqual(tu.safeFolderName('a<b>:c"/d\\e|f?g*h'), "a b c d e f g h");
  assert.strictEqual(tu.safeFolderName("电影解说 第1集."), "电影解说 第1集");
  assert.strictEqual(tu.safeFolderName("CON"), "video"); assert.strictEqual(tu.safeFolderName("..."), "video");
  assert.strictEqual(tu.safeFolderName("x".repeat(200)).length, 80);
});
test("parse tiến độ ffmpeg / whisper", () => {
  assert.strictEqual(tu.parseFfmpegDuration("  Duration: 00:01:23.50, start"), 83.5);
  assert.strictEqual(tu.parseFfmpegTime("size=1kB time=00:00:05.00 bitrate\rsize=2kB time=00:00:12.50 x"), 12.5);
  assert.strictEqual(tu.parseWhisperProgress("progress =   5%\nprogress =  45%\n"), 45);
  assert.strictEqual(tu.parseWhisperProgress("progress = 601%"), 100);
  assert.strictEqual(tu.parseWhisperProgress("nope"), null);
});
test("SRT: parse → clean → format (lọc nhiễu, ảo giác, vòng lặp ≥3)", () => {
  const src = "\uFEFF1\r\n00:00:00,000 --> 00:00:02,000\r\n你好\r\n\r\n2\r\n00:00:02.000 --> 00:00:03.500\r\n[BLANK_AUDIO]\r\n\r\n" +
    "3\r\n00:00:03,500 --> 00:00:05,000\r\n字幕由Amara.org社区提供\r\n\r\n" + [6,7,8,9].map(i => `${i}\n00:00:0${i},000 --> 00:00:0${i},900\n好的。\n`).join("\n");
  const cues = tu.parseSrt(src);
  assert.strictEqual(cues.length, 7); assert.strictEqual(cues[1].start, "00:00:02,000");
  const { cues: out, dropped } = tu.cleanCues(cues);
  assert.deepStrictEqual(out.map(c => c.text), ["你好", "好的。", "好的。"]); assert.strictEqual(dropped, 4);
  assert.ok(tu.formatSrt(out).startsWith("1\n00:00:00,000 --> 00:00:02,000\n你好\n\n2\n"));
  assert.strictEqual(tu.parseSrt(tu.formatSrt(out)).length, 3);
  assert.deepStrictEqual(tu.cleanCues([{ start: "00:00:00,000", end: "00:00:01,000", text: "  ♪ ♪ " }]).cues, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})();
