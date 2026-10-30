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

console.log("cookies (parse + trình duyệt)");
const ck = require("../dist-electron/main/core/cookies.js");
test("parse cookies Netscape: giữ cookie hợp lệ, bỏ chú thích/dòng rác", () => {
  const r = ck.parseCookiesText("# c\n.a.com\tTRUE\t/\tTRUE\t1793673935\tsid\tv1\n#HttpOnly_.b.com\tTRUE\t/\tTRUE\t0\tx\ty\nrác\n");
  assert.ok(r.ok); assert.strictEqual(r.summary.count, 2); assert.deepStrictEqual(r.summary.domains, ["a.com", "b.com"]);
  assert.ok(r.text.startsWith("# Netscape HTTP Cookie File\n"));
});
test("parse cookies: chịu được BOM, CRLF, tab bị đổi thành dấu cách; cho phép tên rỗng", () => {
  assert.ok(ck.parseCookiesText("\uFEFF.a.com TRUE / TRUE 1793673935 sid abc\r\n").ok);
  assert.ok(ck.parseCookiesText("www.a.com\tFALSE\t/\tFALSE\t0\t\tvalue").ok);
});
test("parse cookies: từ chối JSON, rỗng, rác, quá lớn, không phải string", () => {
  for (const bad of ['[{"name":"a"}]', "   ", "hello world", "a".repeat(2 * 1024 * 1024 + 1), 123, null, "a\0b"]) assert.ok(!ck.parseCookiesText(bad).ok, String(bad).slice(0, 20));
});
test("isCookieBrowser: chỉ nhận whitelist", () => {
  for (const b of ["none", "firefox", "edge", "chrome", "brave"]) assert.ok(ck.isCookieBrowser(b), b);
  for (const b of ["", "safari", "firefox --evil", "../x", null, 1, undefined, "FIREFOX"]) assert.ok(!ck.isCookieBrowser(b), String(b));
});
test("usesBrowserCookies: chỉ Douyin/TikTok (kể cả subdomain), không khớp hậu tố giả", () => {
  for (const u of ["https://www.douyin.com/video/1", "https://v.douyin.com/AbC/", "https://www.iesdouyin.com/share/video/1", "https://www.tiktok.com/@a/video/1", "https://vm.tiktok.com/Z/"])
    assert.ok(ck.usesBrowserCookies(u), u);
  for (const u of ["https://www.youtube.com/watch?v=a", "https://evildouyin.com/x", "https://douyin.com.evil.io/x", "https://facebook.com/x", "không phải url"])
    assert.ok(!ck.usesBrowserCookies(u), u);
});

console.log("cookies (tự lấy qua cửa sổ đăng nhập)");
const NOW = 1_800_000_000;
const sample = [
  { name: "sessionid", value: "abc", domain: ".douyin.com", hostOnly: false, path: "/", secure: true, httpOnly: true, session: false, expirationDate: NOW + 1000 },
  { name: "s_v_web_id", value: "v1", domain: "www.douyin.com", hostOnly: true, path: "/", secure: false, httpOnly: false, session: true },
  { name: "old", value: "x", domain: ".douyin.com", hostOnly: false, path: "/", secure: false, httpOnly: false, session: false, expirationDate: NOW - 5 },
  { name: "track", value: "t", domain: ".google.com", hostOnly: false, path: "/", secure: true, httpOnly: false, session: false, expirationDate: NOW + 99 },
  { name: "evil", value: "a\tb", domain: ".douyin.com", hostOnly: false, path: "/", secure: false, httpOnly: false, session: true },
];
test("isCookieSite: chỉ douyin / tiktok", () => {
  assert.ok(ck.isCookieSite("douyin") && ck.isCookieSite("tiktok"));
  for (const v of ["youtube", "", "__proto__", "constructor", null, 1]) assert.ok(!ck.isCookieSite(v), String(v));
});
test("domainMatches: khớp subdomain, không khớp hậu tố giả / tên miền khác", () => {
  const d = ["douyin.com"];
  for (const x of [".douyin.com", "www.douyin.com", "#HttpOnly_.douyin.com", "douyin.com"]) assert.ok(ck.domainMatches(x, d), x);
  for (const x of ["evildouyin.com", "douyin.com.evil.io", ".google.com", ""]) assert.ok(!ck.domainMatches(x, d), x);
});
test("isLoggedIn: cần cookie sessionid không rỗng đúng tên miền", () => {
  assert.ok(ck.isLoggedIn(sample, ["douyin.com"]));
  assert.ok(!ck.isLoggedIn(sample, ["tiktok.com"]));
  assert.ok(!ck.isLoggedIn([{ name: "sessionid", value: "", domain: ".douyin.com" }], ["douyin.com"]));
});
test("toNetscapeLines: đúng 7 cột, HttpOnly, session=0, bỏ hết hạn / tên miền khác / ký tự lạ", () => {
  const lines = ck.toNetscapeLines(sample, ["douyin.com"], NOW);
  assert.strictEqual(lines.length, 2);
  assert.deepStrictEqual(lines[0].split("\t"), ["#HttpOnly_.douyin.com", "TRUE", "/", "TRUE", String(NOW + 1000), "sessionid", "abc"]);
  assert.deepStrictEqual(lines[1].split("\t"), ["www.douyin.com", "FALSE", "/", "FALSE", "0", "s_v_web_id", "v1"]);
  const parsed = ck.parseCookiesText(lines.join("\n"));
  assert.ok(parsed.ok && parsed.summary.count === 2);   // chạy lại qua bộ parse của app vẫn hợp lệ
});
test("mergeCookieText: thay cookie của trang, giữ cookie trang khác, bỏ chú thích cũ", () => {
  const existing = "# Netscape HTTP Cookie File\n.douyin.com\tTRUE\t/\tTRUE\t99\told\t1\n.youtube.com\tTRUE\t/\tTRUE\t99\tyt\t2\n";
  const merged = ck.mergeCookieText(existing, ck.toNetscapeLines(sample, ["douyin.com"], NOW), ["douyin.com"]);
  assert.ok(merged.startsWith("# Netscape HTTP Cookie File\n"));
  assert.ok(merged.includes("\tyt\t2") && !merged.includes("\told\t1") && merged.includes("\tsessionid\tabc"));
  assert.strictEqual(ck.mergeCookieText(null, ["a.com\tFALSE\t/\tFALSE\t0\tn\tv"], ["douyin.com"]).split("\n").length, 3);
});
test("isSafeUserAgent: nhận UA Chrome, từ chối rỗng / xuống dòng / quá dài / không phải string", () => {
  assert.ok(ck.isSafeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"));
  for (const v of ["", "short", "Mozilla/5.0\nX-Evil: 1 aaaaaaaa", "a".repeat(301), "Mozilla/5.0 (Windows) tiếng Việt", null, 5]) assert.ok(!ck.isSafeUserAgent(v), String(v).slice(0, 20));
});

console.log("douyin (phân tích dữ liệu / chọn bản / tên file / link an toàn)");
const dy = require("../dist-electron/main/core/douyin.js");
const dd = require("../dist-electron/main/core/douyin-download.js");
const http = require("http");

// Dạng phản hồi API aweme/v1/web/aweme/detail (snake_case) — theo cấu trúc yt-dlp đọc
const apiResp = { aweme_detail: {
  aweme_id: "7699825880927022265", desc: "Clip: vui/lắm?", author: { nickname: "Tác giả" },
  video: {
    width: 1080, height: 1920,
    play_addr: { url_list: ["https://aweme.snssdk.com/aweme/v1/play/?video_id=x", "//v3.douyinvod.com/a/video.mp4?x=1"], width: 720, height: 1280, url_key: "v0_h264_720p" },
    download_addr: { url_list: ["https://wm.example.com/wm.mp4"], width: 720 },
    has_watermark: true,
    bit_rate: [
      { gear_name: "h264_1080", bit_rate: 2500000, is_bytevc1: 0, play_addr: { url_list: ["https://v26.douyinvod.com/h264_1080.mp4"], width: 1080, height: 1920 } },
      { gear_name: "h265_1080", bit_rate: 1800000, is_bytevc1: 1, play_addr: { url_list: ["https://v26.douyinvod.com/h265_1080.mp4"], width: 1080, height: 1920 } },
      { gear_name: "h264_540",  bit_rate: 900000,  is_bytevc1: 0, play_addr: { url_list: ["https://v26.douyinvod.com/h264_540.mp4"],  width: 540,  height: 960 } },
      { gear_name: "vvc",       bit_rate: 700000,  is_bytevc1: 0, play_addr: { url_list: ["https://v26.douyinvod.com/vvc.mp4"], url_key: "x_bytevc2_540p", width: 540, height: 960 } },
    ],
  },
} };
test("parseAwemeDetail (API): id, tiêu đề, tác giả, bỏ bản bytevc2, link CDN trước link API", () => {
  const m = dy.parseAwemeDetail(apiResp, "7699825880927022265");
  assert.strictEqual(m.id, "7699825880927022265"); assert.strictEqual(m.author, "Tác giả"); assert.strictEqual(m.isImagePost, false);
  assert.ok(!m.candidates.some(c => c.urls[0].includes("vvc.mp4")));
  const pa = m.candidates[0];
  assert.strictEqual(pa.urls[0], "https://v3.douyinvod.com/a/video.mp4?x=1");        // "//" → https, CDN trước
  assert.ok(pa.urls[1].includes("/aweme/v1/play/"));
  assert.ok(!m.candidates.some(c => c.urls[0].includes("wm.example.com")));           // watermark bị bỏ khi còn bản khác
});
test("parseAwemeDetail: sai ID mong muốn → null; thiếu video → null; rác → null", () => {
  assert.strictEqual(dy.parseAwemeDetail(apiResp, "1234567890123"), null);
  assert.strictEqual(dy.parseAwemeDetail({ aweme_detail: { aweme_id: "7699825880927022265" } }), null);
  for (const v of [null, 5, "x", [], {}]) assert.strictEqual(dy.parseAwemeDetail(v), null);
});
test("parseAwemeDetail (RENDER_DATA kiểu camelCase, lồng sâu): tìm đúng video theo ID", () => {
  const rd = { app: { x: 1 }, "abc": { aweme: { detail: {
    awemeId: "7699825880927022265", desc: "x", authorInfo: { nickname: "N" },
    video: { width: 720, height: 1280, playAddr: [{ src: "//p.douyinvod.com/v.mp4" }], bitRateList: [
      { bitRate: 1000, isBytevc1: 0, width: 720, height: 1280, playAddr: [{ src: "https://p.douyinvod.com/r1.mp4" }] } ] } } },
    other: { awemeId: "999999999999", video: { playAddr: [{ src: "https://o.com/o.mp4" }] } } } };
  const m = dy.parseAwemeDetail(rd, "7699825880927022265");
  assert.strictEqual(m.id, "7699825880927022265"); assert.strictEqual(m.author, "N");
  assert.deepStrictEqual(m.candidates.map(c => c.urls[0]), ["https://p.douyinvod.com/v.mp4", "https://p.douyinvod.com/r1.mp4"]);
});
test("parseAwemeDetail: bài ảnh → isImagePost, không có candidate", () => {
  const m = dy.parseAwemeDetail({ aweme_detail: { aweme_id: "7699825880927022265", images: [{}], video: { play_addr: { url_list: [] } } } });
  assert.ok(m.isImagePost); assert.strictEqual(m.candidates.length, 0);
});
test("pickCandidate: tốt nhất ưu tiên độ phân giải rồi H.264; giới hạn 720p/360p; âm thanh lấy bản nhỏ nhất", () => {
  const c = dy.parseAwemeDetail(apiResp).candidates;
  assert.ok(dy.pickCandidate(c, "best").urls[0].endsWith("h264_1080.mp4"));
  assert.ok(dy.pickCandidate(c, "bestvideo+bestaudio").urls[0].endsWith("h264_1080.mp4"));
  assert.ok(dy.pickCandidate(c, "1080p").urls[0].endsWith("h264_1080.mp4"));
  assert.ok(dy.pickCandidate(c, "720p").urls[0].includes("video.mp4"));               // 720x1280 → cạnh ngắn 720
  assert.ok(dy.pickCandidate(c, "360p").urls[0].endsWith("h264_540.mp4"));            // không bản nào ≤360 → nhỏ nhất
  assert.ok(dy.pickCandidate(c, "audio_mp3").urls[0].endsWith("h264_540.mp4"));
  assert.strictEqual(dy.pickCandidate([], "best"), null);
});
test("safeFilename: bỏ ký tự cấm, cắt theo ký tự Unicode, tên thiết bị, rỗng → fallback", () => {
  assert.strictEqual(dy.safeFilename('Clip: vui/lắm?\n*', "fb"), "Clip vui lắm");
  assert.strictEqual(dy.safeFilename("   ...  ", "fb"), "fb");
  assert.strictEqual(dy.safeFilename("CON", "fb"), "_CON");
  assert.strictEqual(Array.from(dy.safeFilename("😀".repeat(300), "fb")).length, 100);
  assert.ok(!/[<>:"/\\|?*\u0000-\u001f]/.test(dy.safeFilename('a<b>c:"d"/e\\f|g?h*i\u0001', "fb")));
});
test("isSafeMediaUrl: chỉ http(s) tới host công cộng", () => {
  for (const u of ["https://v3.douyinvod.com/a.mp4", "http://cdn.example.com/x"]) assert.ok(dy.isSafeMediaUrl(u), u);
  for (const u of ["file:///etc/passwd", "ftp://a.com/x", "http://localhost/x", "http://127.0.0.1/x", "http://10.0.0.5/x", "http://192.168.1.1/x",
    "http://172.20.0.1/x", "http://169.254.169.254/latest", "http://[::1]/x", "http://user:pw@a.com/x", "http://a.local/x", "không phải url"])
    assert.ok(!dy.isSafeMediaUrl(u), u);
});
test("isDouyinUrl / extractAwemeId", () => {
  for (const u of ["https://www.douyin.com/video/7699825880927022265", "https://v.douyin.com/AbC123/", "https://www.iesdouyin.com/share/video/1"]) assert.ok(dy.isDouyinUrl(u), u);
  for (const u of ["https://evildouyin.com/x", "https://douyin.com.evil.io/", "https://www.tiktok.com/@a/video/1", "xx"]) assert.ok(!dy.isDouyinUrl(u), u);
  assert.strictEqual(dy.extractAwemeId("https://www.douyin.com/video/7699825880927022265?x=1"), "7699825880927022265");
  assert.strictEqual(dy.extractAwemeId("https://v.douyin.com/AbC123/"), null);
});

console.log("douyin-download (chạy thật với server cục bộ)");
const BODY = Buffer.alloc(300_000, 7);
const srv = http.createServer((req, res) => {
  const seen = (srv.seen ||= []); seen.push({ url: req.url, referer: req.headers.referer, ua: req.headers["user-agent"] });
  if (req.url === "/video.mp4") { res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": BODY.length }); res.end(BODY); }
  else if (req.url === "/redir") { res.writeHead(302, { Location: "/video.mp4" }); res.end(); }
  else if (req.url === "/loop") { res.writeHead(302, { Location: "/loop" }); res.end(); }
  else if (req.url === "/html") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<html>expired</html>"); }
  else if (req.url === "/403") { res.writeHead(403); res.end(); }
  else if (req.url === "/short") { res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": 1000 }); res.write(Buffer.alloc(100)); setTimeout(() => res.destroy(), 30); }
  else if (req.url === "/slow") { res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": BODY.length }); res.write(BODY.subarray(0, 1000)); }
  else { res.writeHead(404); res.end(); }
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const srvBase = `http://127.0.0.1:${srv.address().port}`;
const tmpd = fs.mkdtempSync(path.join(os.tmpdir(), "dy-test-"));
const dl = (u, name, signal) => dd.downloadToFile(srvBase + u, path.join(tmpd, name), { headers: { Referer: "https://www.douyin.com/", "User-Agent": "UA-TEST" }, signal: signal || new AbortController().signal, onProgress() {}, allowPrivate: true });

await atest("downloadToFile: tải đủ file, gửi Referer + User-Agent, theo chuyển hướng", async () => {
  await dl("/redir", "ok.bin");
  assert.strictEqual(fs.statSync(path.join(tmpd, "ok.bin")).size, BODY.length);
  const last = srv.seen[srv.seen.length - 1];
  assert.strictEqual(last.referer, "https://www.douyin.com/"); assert.strictEqual(last.ua, "UA-TEST");
});
await atest("downloadToFile: từ chối HTML, HTTP 403, 404, vòng lặp chuyển hướng, file bị cắt — và không để lại file dở", async () => {
  for (const [u, re] of [["/html", /không trả về video/], ["/403", /HTTP 403/], ["/nope", /HTTP 404/], ["/loop", /chuyển hướng/], ["/short", /ngắt|đủ dung lượng/]]) {
    await assert.rejects(() => dl(u, "bad.bin"), re, u);
    assert.ok(!fs.existsSync(path.join(tmpd, "bad.bin")), "không để lại file dở: " + u);
  }
});
await atest("downloadToFile: chặn link nội bộ khi không bật allowPrivate", async () => {
  await assert.rejects(() => dd.downloadToFile(srvBase + "/video.mp4", path.join(tmpd, "x.bin"), { headers: {}, signal: new AbortController().signal, onProgress() {} }), /không hợp lệ/);
});
await atest("downloadToFile: huỷ giữa chừng → reject 'cancelled' và xoá file dở", async () => {
  const ac = new AbortController();
  const p = dl("/slow", "cancel.bin", ac.signal);
  setTimeout(() => ac.abort(), 150);
  await assert.rejects(() => p, /cancelled/);
  assert.ok(!fs.existsSync(path.join(tmpd, "cancel.bin")));
});

const mkReq = (quality) => ({ id: "abcd1234", url: "https://www.douyin.com/video/7699825880927022265", quality, outputDir: tmpd });
const collect = (h) => new Promise(resolve => { const ev = { progress: [] }; h.emitter.on("progress", p => ev.progress.push(p)); h.emitter.on("complete", c => resolve({ ...ev, complete: c })); h.emitter.on("error", e => resolve({ ...ev, error: e })); });
const fakeMedia = (urls, extra = {}) => ({ id: "7699825880927022265", title: "Clip: vui/lắm?", author: "A", isImagePost: false, candidates: [{ urls, width: 720, height: 1280, bitrate: 1, hevc: false }], ...extra });

await atest("startDouyinDownload: luồng đầy đủ → file .mp4 đúng tên, đủ dung lượng, có progress, link đầu hỏng thì thử link sau", async () => {
  const h = dd.startDouyinDownload(mkReq("best"), { extract: () => ({ promise: Promise.resolve(fakeMedia([srvBase + "/403", srvBase + "/video.mp4"])), cancel() {} }), ffmpeg: () => null, allowPrivate: true });
  const r = await collect(h);
  assert.ok(r.complete, JSON.stringify(r.error));
  assert.strictEqual(r.complete.filename, "Clip vui lắm.mp4");
  assert.strictEqual(fs.statSync(r.complete.filepath).size, BODY.length);
  assert.ok(!fs.existsSync(r.complete.filepath + ".part"));
  assert.ok(r.progress.length >= 2 && r.progress[0].percent === 0 && /Douyin/.test(r.progress[0].filename));
  assert.ok(r.progress.some(p => p.percent === 100));
  const h2 = dd.startDouyinDownload(mkReq("best"), { extract: () => ({ promise: Promise.resolve(fakeMedia([srvBase + "/video.mp4"])), cancel() {} }), ffmpeg: () => null, allowPrivate: true });
  assert.strictEqual((await collect(h2)).complete.filename, "Clip vui lắm (1).mp4");   // không ghi đè file cũ
});
await atest("startDouyinDownload: lỗi thân thiện — bài ảnh, không có link, hết hạn, thiếu ffmpeg cho âm thanh", async () => {
  const run = (media, q = "best") => collect(dd.startDouyinDownload(mkReq(q), { extract: () => ({ promise: Promise.resolve(media), cancel() {} }), ffmpeg: () => null, allowPrivate: true }));
  assert.match((await run(fakeMedia([], { candidates: [], isImagePost: true }))).error.message, /bài đăng dạng ảnh/);
  assert.match((await run(fakeMedia([], { candidates: [] }))).error.message, /không trả về link video/);
  assert.match((await run(fakeMedia([srvBase + "/html"]))).error.message, /Không tải được video Douyin.*không trả về video/);
  assert.match((await run(fakeMedia([srvBase + "/video.mp4"]), "audio_mp3")).error.message, /ffmpeg/);
  assert.deepStrictEqual(fs.readdirSync(tmpd).filter(f => f.endsWith(".part")), []);
});
await atest("startDouyinDownload: lỗi từ bước trích xuất được chuyển nguyên văn cho người dùng", async () => {
  const { UserFacingError } = dy;
  const r = await collect(dd.startDouyinDownload(mkReq("best"), { extract: () => ({ promise: Promise.reject(new UserFacingError("Cần đăng nhập Douyin")), cancel() {} }), ffmpeg: () => null }));
  assert.strictEqual(r.error.message, "Cần đăng nhập Douyin");
});
await atest("startDouyinDownload: huỷ → không phát complete/error, gọi cancel của bước trích xuất, không để rác", async () => {
  let extractCancelled = false, events = 0;
  const h = dd.startDouyinDownload(mkReq("best"), { extract: () => ({ promise: new Promise(() => {}), cancel() { extractCancelled = true; } }), ffmpeg: () => null });
  h.emitter.on("complete", () => events++); h.emitter.on("error", () => events++);
  await new Promise(r => setTimeout(r, 50));
  h.cancel();
  await new Promise(r => setTimeout(r, 100));
  assert.ok(extractCancelled); assert.strictEqual(events, 0);
});
srv.close();
fs.rmSync(tmpd, { recursive: true, force: true });

console.log("srt + whisper (phân tích SRT / tiến trình / cấu hình)");
const srt = require("../dist-electron/main/core/srt.js");
const wh  = require("../dist-electron/main/core/whisper.js");
test("formatTimestamp: HH:MM:SS,mmm, làm tròn, chặn số âm/NaN", () => {
  assert.strictEqual(srt.formatTimestamp(83450), "00:01:23,450");
  assert.strictEqual(srt.formatTimestamp(3_723_007), "01:02:03,007");
  assert.strictEqual(srt.formatTimestamp(-5), "00:00:00,000");
  assert.strictEqual(srt.formatTimestamp(NaN), "00:00:00,000");
});
test("parseSrt: CRLF, BOM, nhiều dòng, dòng chỉ có số trong nội dung, đoạn rỗng", () => {
  const raw = "\uFEFF1\r\n00:00:00,000 --> 00:00:03,500\r\n 大家好，欢迎收看。\r\n\r\n2\r\n00:00:03,500 --> 00:00:07,000\r\n第一行\r\n2024\r\n第三行\r\n\r\n3\r\n00:01:00,000 --> 00:01:02,000\r\n\r\n\r\n";
  const segs = srt.parseSrt(raw);
  assert.strictEqual(segs.length, 3);
  assert.deepStrictEqual(segs[0], { startMs: 0, endMs: 3500, text: "大家好，欢迎收看。" });
  assert.strictEqual(segs[1].text, "第一行\n2024\n第三行");   // "2024" không bị nhầm là số thứ tự
  assert.strictEqual(segs[2].text, "");
  assert.strictEqual(srt.parseSrt("không phải srt").length, 0);
});
test("cleanSegments: bỏ đoạn rỗng / chỉ dấu câu, gọn khoảng trắng, end ≥ start", () => {
  const out = srt.cleanSegments([
    { startMs: 0, endMs: 1000, text: "  你好   世界 " }, { startMs: 1000, endMs: 2000, text: " ♪ " }, { startMs: 2000, endMs: 3000, text: "…。" },
    { startMs: 5000, endMs: 4000, text: "反了" }, { startMs: 6000, endMs: 7000, text: "" },
  ]);
  assert.deepStrictEqual(out.map(x => x.text), ["你好 世界", "反了"]);
  assert.ok(out[1].endMs >= out[1].startMs);
});
test("formatSrt ↔ parseSrt: ghi rồi đọc lại ra đúng nội dung; đánh số lại từ 1", () => {
  const segs = [{ startMs: 1500, endMs: 4000, text: "你好" }, { startMs: 4000, endMs: 3_725_250, text: "第二段\n两行" }];
  const text = srt.formatSrt(segs);
  assert.ok(text.startsWith("1\n00:00:01,500 --> 00:00:04,000\n你好\n\n2\n00:00:04,000 --> 01:02:05,250\n第二段\n两行\n"));
  assert.deepStrictEqual(srt.parseSrt(text), segs);
  assert.strictEqual(srt.toPlainText(segs), "你好\n第二段 两行");
});
test("parseWhisperProgress: lấy % mới nhất, chặn 100, không có thì null", () => {
  assert.strictEqual(srt.parseWhisperProgress("whisper_print_progress_callback: progress =   5%\nwhisper_print_progress_callback: progress =  42%"), 42);
  assert.strictEqual(srt.parseWhisperProgress("progress = 200%"), 100);
  assert.strictEqual(srt.parseWhisperProgress("whisper_print_timings: total time = 10 ms"), null);
});
test("parseFfmpegSeconds: Duration và time=", () => {
  assert.strictEqual(srt.parseFfmpegSeconds("  Duration: 00:01:23.50, start: 0.0", "Duration:"), 83.5);
  assert.strictEqual(srt.parseFfmpegSeconds("size=1kB time=01:00:10.25 bitrate=", "time="), 3610.25);
  assert.strictEqual(srt.parseFfmpegSeconds("không có", "time="), null);
});

console.log("scenes + translate (gom cảnh / đóng gói dòng dịch)");
const scenes = require("../dist-electron/main/core/scenes.js");
const trn = require("../dist-electron/main/core/translate.js");
test("parseSceneCutMs: pts_time, bỏ cắt quá sớm, gộp cắt sát nhau", () => {
  const stderr = "[Parsed_showinfo_1] n:0 pts_time:0.080 foo\n[Parsed_showinfo_1] n:1 pts_time:3.250\n[Parsed_showinfo_1] n:2 pts_time:3.400\n[Parsed_showinfo_1] n:3 pts_time:12.000\n";
  assert.deepStrictEqual(scenes.parseSceneCutMs(stderr), [3250, 12000]);
  assert.deepStrictEqual(scenes.parseSceneCutMs("rác"), []);
});
test("attachSceneIndex: cắt hình chia cảnh; không cắt thì gom theo khoảng lặng", () => {
  const segs = [
    { startMs: 0, endMs: 3000, text: "a" },
    { startMs: 3100, endMs: 5000, text: "b" },
    { startMs: 8000, endMs: 9000, text: "c" },
  ];
  const vis = scenes.attachSceneIndex(segs, [4000]);
  assert.deepStrictEqual(vis.map(s => s.sceneIndex), [0, 1, 1]);
  const pause = scenes.attachSceneIndex(segs, []);
  assert.deepStrictEqual(pause.map(s => s.sceneIndex), [0, 0, 1]);
});
test("batchesForTranslation: không trộn hai cảnh; tách khi quá dài", () => {
  const segs = scenes.attachSceneIndex([
    { startMs: 0, endMs: 1000, text: "一" },
    { startMs: 1100, endMs: 2000, text: "二" },
    { startMs: 5000, endMs: 6000, text: "三" },
  ], []);
  const batches = scenes.batchesForTranslation(segs);
  assert.strictEqual(batches.length, 2);
  assert.deepStrictEqual(batches[0].map(s => s.text), ["一", "二"]);
  assert.deepStrictEqual(batches[1].map(s => s.text), ["三"]);
});
test("pack/unpack numbered + parseGtx/MyMemory", () => {
  const packed = trn.packNumbered(["你好", "世界"]);
  assert.strictEqual(packed, "1. 你好\n2. 世界");
  assert.deepStrictEqual(trn.unpackNumbered("1. Xin chào\n2) Thế giới", 2), ["Xin chào", "Thế giới"]);
  assert.strictEqual(trn.unpackNumbered("1. chỉ một", 2), null);
  assert.strictEqual(trn.parseGtxResponse([[["Xin ", "你好"], ["chào", "你"]]]), "Xin chào");
  assert.strictEqual(trn.parseMyMemoryResponse({ responseStatus: 200, responseData: { translatedText: "  Xin chào  " } }), "Xin chào");
});
await atest("httpsGetJson: host không trong danh sách → từ chối, không gọi mạng", async () => {
  await assert.rejects(() => trn.httpsGetJson("https://evil.example/x", new AbortController().signal), /danh sách cho phép/);
});
await atest("translateZhToVi: dịch cả khối đánh số; lệch dòng thì dịch từng câu", async () => {
  const getJson = async (url) => {
    const q = new URL(url).searchParams.get("q") ?? "";
    if (q.includes("你好")) return [[["1. Chào\n2. Thế giới"]]];
    if (q.includes("单独")) return [[["1. Một mình"]]];
    return [[["?"]]];
  };
  assert.deepStrictEqual(await trn.translateZhToVi(["你好", "世界"], new AbortController().signal, getJson), ["Chào", "Thế giới"]);
  assert.deepStrictEqual(await trn.translateZhToVi(["单独"], new AbortController().signal, getJson), ["Một mình"]);
  const bad = async (url) => {
    const q = new URL(url).searchParams.get("q") ?? "";
    if (q.includes("\n")) return [[["không khớp số dòng"]]];
    return [[[`VI-${q}`]]];
  };
  assert.deepStrictEqual(await trn.translateZhToVi(["甲", "乙"], new AbortController().signal, bad), ["VI-甲", "VI-乙"]);
});
test("danh mục mô hình whisper: id hợp lệ, SHA-1 40 hex, file .bin, URL chỉ trỏ Hugging Face; công cụ ghim SHA-256", () => {
  assert.deepStrictEqual([...wh.MODEL_IDS].sort(), ["base", "small", "turbo"]);
  for (const id of wh.MODEL_IDS) {
    assert.match(wh.WHISPER_MODELS[id].sha1, /^[0-9a-f]{40}$/, id);
    assert.match(wh.WHISPER_MODELS[id].file, /^ggml-[a-z0-9._-]+\.bin$/, id);
    const u = new URL(wh.modelUrl(id)); assert.strictEqual(u.protocol, "https:"); assert.strictEqual(u.hostname, "huggingface.co");
  }
  assert.match(wh.WHISPER_ZIP.sha256, /^[0-9a-f]{64}$/);
  assert.ok(wh.WHISPER_ZIP.url.startsWith("https://github.com/ggml-org/whisper.cpp/releases/download/" + wh.WHISPER_TAG + "/"));
  for (const v of ["small", "base", "turbo"]) assert.ok(wh.isWhisperModelId(v));
  for (const v of ["", "large", "__proto__", "constructor", "../small", null, 1]) assert.ok(!wh.isWhisperModelId(v), String(v));
});
test("buildWhisperArgs: tiếng Trung, SRT, tiến trình, prompt chữ giản thể, mọi đường dẫn tương đối", () => {
  const a = wh.buildWhisperArgs({ modelRel: "models/ggml-small.bin", wavRel: "jobs/ab12/audio.wav", outBaseRel: "jobs/ab12/transcript", threads: 6 });
  const at = (f) => a[a.indexOf(f) + 1];
  assert.strictEqual(at("-l"), "zh"); assert.strictEqual(at("-t"), "6"); assert.strictEqual(at("-m"), "models/ggml-small.bin");
  assert.strictEqual(at("-f"), "jobs/ab12/audio.wav"); assert.strictEqual(at("-of"), "jobs/ab12/transcript");
  assert.ok(a.includes("-osrt") && a.includes("-pp") && a.includes("-sns"));
  assert.strictEqual(at("--prompt"), "以下是普通话的句子。");
  for (const f of ["-m", "-f", "-of"]) assert.ok(!/^([a-zA-Z]:|[\\/])/.test(at(f)), "đường dẫn phải tương đối: " + f);
});
test("explainWhisperExit + pickThreads", () => {
  assert.match(wh.explainWhisperExit(3221225781, ""), /Visual C\+\+/);
  assert.match(wh.explainWhisperExit(-1073741515, ""), /Visual C\+\+/);          // cùng mã nhưng dạng có dấu
  assert.match(wh.explainWhisperExit(3221225501, ""), /CPU/);
  assert.match(wh.explainWhisperExit(1, "whisper: failed to allocate buffer"), /bộ nhớ/);
  assert.match(wh.explainWhisperExit(2, "line1\nboom happened"), /mã 2.*boom happened/);
  assert.deepStrictEqual([1, 2, 4, 8, 16, 64].map(wh.pickThreads), [1, 1, 3, 7, 8, 8]);
});
test("fileDigest: SHA-1 và SHA-256 đúng vector chuẩn của 'abc'", async () => {
  const f = path.join(os.tmpdir(), "digest-" + process.pid + ".txt"); fs.writeFileSync(f, "abc");
  try {
    assert.strictEqual(await sec.fileDigest(f, "sha1"), "a9993e364706816aba3e25717850c26c9cd0d89d");
    assert.strictEqual(await sec.fileDigest(f, "sha256"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  } finally { fs.rmSync(f, { force: true }); }
});

console.log("whisper-install (tải + kiểm checksum + giải nén, server cục bộ)");
const inst = require("../dist-electron/main/core/whisper-install.js");
const { spawnSync } = require("child_process");
const haveZip = spawnSync("zip", ["-v"]).status === 0 && spawnSync("unzip", ["-v"]).status === 0;
const crypto2 = require("crypto");
const sha = (alg, buf) => crypto2.createHash(alg).update(buf).digest("hex");
const MODEL_BODY = Buffer.alloc(200_000, 3);
const zipDir = fs.mkdtempSync(path.join(os.tmpdir(), "wzip-"));
let ZIP_BODY = null;
if (haveZip) {
  fs.mkdirSync(path.join(zipDir, "Release"));
  fs.writeFileSync(path.join(zipDir, "Release", "whisper-cli.exe"), Buffer.concat([Buffer.from("MZ"), Buffer.alloc(1000, 1)]));
  fs.writeFileSync(path.join(zipDir, "Release", "whisper.dll"), "dll");
  spawnSync("zip", ["-q", "-r", path.join(zipDir, "tool.zip"), "Release"], { cwd: zipDir });
  ZIP_BODY = fs.readFileSync(path.join(zipDir, "tool.zip"));
}
const srv2 = http.createServer((req, res) => {
  if (req.url === "/tool.zip" && ZIP_BODY) { res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": ZIP_BODY.length }); res.end(ZIP_BODY); }
  else if (req.url === "/model.bin") { res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": MODEL_BODY.length }); res.end(MODEL_BODY); }
  else if (req.url === "/go-evil") { res.writeHead(302, { Location: "http://localhost:" + srv2.address().port + "/model.bin" }); res.end(); }
  else if (req.url === "/slowmodel") { res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": MODEL_BODY.length }); res.write(MODEL_BODY.subarray(0, 1000)); }
  else { res.writeHead(404); res.end(); }
});
await new Promise(r => srv2.listen(0, "127.0.0.1", r));
const b2 = `http://127.0.0.1:${srv2.address().port}`;
const wbase = fs.mkdtempSync(path.join(os.tmpdir(), "wbase-"));
const opts = (extra = {}) => ({ signal: new AbortController().signal, onProgress() {}, allowPrivate: true, ...extra });
const anyHost = () => true;

if (haveZip) {
  await atest("ensureWhisperTool: sai SHA-256 → từ chối, không cài, không để rác", async () => {
    await assert.rejects(() => inst.ensureWhisperTool(wbase, opts(), { zipUrl: b2 + "/tool.zip", zipSha256: "0".repeat(64), allowHost: anyHost }), /SHA-256/);
    assert.ok(!inst.isToolInstalled(wbase));
    assert.deepStrictEqual(fs.readdirSync(path.join(wbase, "bin")), []);
  });
  await atest("ensureWhisperTool: đúng SHA-256 → giải nén, có whisper-cli.exe + DLL, báo tiến trình; lần sau dùng lại không tải", async () => {
    const seen = [];
    const exe = await inst.ensureWhisperTool(wbase, opts({ onProgress: (p, m) => seen.push(m) }), { zipUrl: b2 + "/tool.zip", zipSha256: sha("sha256", ZIP_BODY), allowHost: anyHost });
    assert.ok(fs.existsSync(exe) && exe.endsWith("whisper-cli.exe") && inst.isToolInstalled(wbase));
    assert.ok(fs.existsSync(path.join(path.dirname(exe), "whisper.dll")));
    assert.ok(seen.some(m => /Đang tải công cụ/.test(m)) && seen.some(m => /giải nén/.test(m)));
    const before = fs.statSync(exe).mtimeMs;
    assert.strictEqual(await inst.ensureWhisperTool(wbase, opts({ signal: AbortSignal.abort() })), exe);   // không tải lại (nếu tải sẽ bị huỷ ngay)
    assert.strictEqual(fs.statSync(exe).mtimeMs, before);
  });
} else { console.log("  (bỏ qua test giải nén: máy không có zip/unzip)"); }
await atest("ensureModel: sai SHA-1 → từ chối, xoá file dở; đúng SHA-1 → cài vào models/", async () => {
  await assert.rejects(() => inst.ensureModel(wbase, "base", opts(), { url: b2 + "/model.bin", sha1: "0".repeat(40), allowHost: anyHost }), /sai mã kiểm tra/);
  assert.ok(!inst.isModelInstalled(wbase, "base")); assert.deepStrictEqual(fs.readdirSync(path.join(wbase, "models")), []);
  const p = await inst.ensureModel(wbase, "base", opts(), { url: b2 + "/model.bin", sha1: sha("sha1", MODEL_BODY), allowHost: anyHost });
  assert.ok(fs.existsSync(p) && fs.statSync(p).size === MODEL_BODY.length && inst.isModelInstalled(wbase, "base"));
  assert.strictEqual(inst.modelRelPath("base"), "models/ggml-base.bin");
});
await atest("ensureModel: danh sách host cho phép được áp dụng cả khi bị chuyển hướng sang host khác", async () => {
  await assert.rejects(() => inst.ensureModel(wbase, "small", opts(), { url: b2 + "/go-evil", sha1: sha("sha1", MODEL_BODY), allowHost: h => h === "127.0.0.1" }), /danh sách cho phép/);
  assert.ok(!inst.isModelInstalled(wbase, "small"));
});
await atest("ensureModel: mặc định chỉ cho phép huggingface.co (host lạ bị chặn)", async () => {
  await assert.rejects(() => inst.ensureModel(wbase, "small", opts(), { url: b2 + "/model.bin", sha1: sha("sha1", MODEL_BODY) }), /danh sách cho phép/);
});
await atest("ensureModel: huỷ giữa chừng → reject và không để file .part", async () => {
  const ac = new AbortController(); setTimeout(() => ac.abort(), 150);
  await assert.rejects(() => inst.ensureModel(wbase, "turbo", opts({ signal: ac.signal }), { url: b2 + "/slowmodel", sha1: sha("sha1", MODEL_BODY), allowHost: anyHost }), /cancelled/);
  assert.ok(!inst.isModelInstalled(wbase, "turbo")); assert.ok(!fs.readdirSync(path.join(wbase, "models")).some(f => f.endsWith(".part")));
});
srv2.close();
fs.rmSync(wbase, { recursive: true, force: true }); fs.rmSync(zipDir, { recursive: true, force: true });

console.log("transcriber (điều phối: ffmpeg → whisper-cli → SRT, dùng chương trình giả lập)");
const { spawn: nspawn } = require("child_process");
const tr = require("../dist-electron/main/core/transcriber.js");
const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-"));
fs.writeFileSync(path.join(fakeDir, "ffmpeg.js"), `
const fs=require("fs"); const a=process.argv.slice(2);
if (process.env.FF_MODE==="nostream") { console.error("Output file #0 does not contain any stream"); process.exit(1); }
if (!a.includes("-vn")) {
  if (process.env.FF_SCENE==="none") { console.error("Stream map '0:v:0' matches no streams"); process.exit(1); }
  console.error("[Parsed_showinfo_1 @ 0] n: 0 pts: 360000 pts_time:4.000 pos:123");
  process.exit(0);
}
console.error("  Duration: 00:00:10.00, start: 0.000000, bitrate: 128 kb/s");
console.error("size=N/A time=00:00:05.00 bitrate=N/A speed=10x");
if (process.env.FF_PACE) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,320);
fs.writeFileSync(a[a.length-1], Buffer.alloc(4000, 1));
`);
fs.writeFileSync(path.join(fakeDir, "whisper.js"), `
const fs=require("fs"); const a=process.argv.slice(2); const get=f=>a[a.indexOf(f)+1];
fs.writeFileSync("args.json", JSON.stringify({args:a,cwd:process.cwd(),modelExists:fs.existsSync(get("-m")),wavExists:fs.existsSync(get("-f"))}));
const mode=process.env.WH_MODE||"ok";
if (mode==="vcredist") process.exit(3221225781);
if (mode==="slow") { setInterval(()=>{},1000); return; }
const nap=()=>{ if(process.env.WH_PACE) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,260); };
process.stderr.write("whisper_print_progress_callback: progress =  10%\\n"); nap();
process.stderr.write("whisper_print_progress_callback: progress =  60%\\n"); nap();
process.stdout.write("[00:00:00.000 --> 00:00:03.000]  x\\n");
if (mode==="nosrt") process.exit(0);
const body = mode==="empty" ? "" :
 "1\\r\\n00:00:00,000 --> 00:00:03,500\\r\\n 大家好，欢迎收看今天的节目。\\r\\n\\r\\n2\\r\\n00:00:03,500 --> 00:00:04,000\\r\\n ♪ \\r\\n\\r\\n3\\r\\n00:00:04,000 --> 00:00:09,250\\r\\n 今天我们来聊一聊人工智能。\\r\\n\\r\\n";
fs.writeFileSync(get("-of")+".srt", body);
process.stderr.write("whisper_print_progress_callback: progress = 100%\\n");
`);
const fakeSpawn = (cmd, args, o) => nspawn(process.execPath, [path.join(fakeDir, cmd === "fake-ffmpeg" ? "ffmpeg.js" : "whisper.js"), ...args], o);
const mkBase = () => { const d = path.join(os.tmpdir(), "基础 目录 " + process.pid + "-" + Math.random().toString(36).slice(2, 6)); fs.mkdirSync(path.join(d, "models"), { recursive: true }); fs.writeFileSync(path.join(d, "models", "ggml-small.bin"), "m"); return d; };
const mkDeps = (baseDir, env = {}, over = {}) => ({
  baseDir, threads: 3, spawn: fakeSpawn, env: { ...process.env, ...env },
  ensureTools: async (onP) => { onP(100, "tools ok"); return "fake-whisper"; },
  ensureModel: async (m, onP) => { onP(100, "model ok"); return "models/ggml-small.bin"; },
  ffmpeg: () => "fake-ffmpeg", ...over,
});
const runT = (deps, id = "abcd1234", job = {}) => new Promise(resolve => {
  const h = tr.startTranscription({ id, inputPath: path.join(deps.baseDir, "in.mp4"), model: "small", ...job }, deps);
  const progress = [];
  h.emitter.on("progress", p => progress.push(p));
  h.emitter.on("done", d => resolve({ done: d, progress, h }));
  h.emitter.on("error", e => resolve({ error: e, progress, h }));
});
const tick = (ms) => new Promise(r => setTimeout(r, ms));

await atest("transcriber: luồng đầy đủ → các đoạn đã làm sạch, tiến trình theo giai đoạn, thư mục tạm được dọn", async () => {
  const base = mkBase();
  try {
    const r = await runT(mkDeps(base, { WH_PACE: "1", FF_PACE: "1" }));
    assert.ok(r.done, JSON.stringify(r.error));
    assert.deepStrictEqual(r.done.segments, [
      { startMs: 0, endMs: 3500, text: "大家好，欢迎收看今天的节目。" },
      { startMs: 4000, endMs: 9250, text: "今天我们来聊一聊人工智能。" },       // đoạn "♪" đã bị loại
    ]);
    const stages = [...new Set(r.progress.map(p => p.stage))];
    assert.deepStrictEqual(stages, ["tools", "model", "audio", "recognize"]);
    const rec = r.progress.filter(p => p.stage === "recognize").map(p => p.percent);
    assert.deepStrictEqual(rec, [0, 10, 60, 100]);   // 10% đến sát sau 0% → được giữ lại và phát sau khoảng nghỉ, không bị mất
    assert.ok(r.progress.some(p => p.stage === "audio" && p.percent === 50));         // time=5s / Duration=10s
    await tick(100);
    assert.deepStrictEqual(fs.readdirSync(path.join(base, "jobs")), []);               // jobs/<id> đã bị xoá
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
await atest("transcriber: dịch theo cảnh — gắn sceneIndex, text tiếng Việt, giữ sourceText", async () => {
  const base = mkBase();
  try {
    const getJson = async (url) => {
      const q = new URL(url).searchParams.get("q") ?? "";
      const lines = q.split(/\n/).map(l => {
        const m = /^(\d+)\.\s*(.*)$/.exec(l);
        return m ? `${m[1]}. VI-${m[2]}` : `VI-${l}`;
      });
      return [[[lines.join("\n")]]];
    };
    const r = await runT(mkDeps(base, {}, { getJson }), "abcd1234", { translateToVi: true });
    assert.ok(r.done, JSON.stringify(r.error));
    assert.strictEqual(r.done.translated, true);
    assert.deepStrictEqual(r.done.segments.map(s => s.sceneIndex), [0, 1]);
    assert.ok(r.done.segments.every(s => s.text.startsWith("VI-") && s.sourceText && !s.sourceText.startsWith("VI-")));
    const stages = [...new Set(r.progress.map(p => p.stage))];
    assert.ok(stages.includes("scenes") && stages.includes("translate"));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
await atest("transcriber: không có luồng hình + dịch lỗi → cảnh theo khoảng lặng, giữ lời gốc, có warning", async () => {
  const base = mkBase();
  try {
    const r = await runT(mkDeps(base, { FF_SCENE: "none" }, {
      getJson: async () => { throw new Error("no net"); },
    }), "abcd1234", { translateToVi: true });
    assert.ok(r.done, JSON.stringify(r.error));
    assert.ok(r.done.warning);
    assert.strictEqual(r.done.translated, false);
    assert.ok(r.done.segments.every(s => !s.sourceText));
    assert.strictEqual(r.done.segments[0].text, "大家好，欢迎收看今天的节目。");
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
await atest("transcriber: whisper-cli nhận đúng tham số, chỉ đường dẫn tương đối, chạy với cwd = thư mục gốc (kể cả khi chứa chữ Trung/dấu cách)", async () => {
  const base = mkBase();
  try {
    let argsFile = null;
    const spy = (cmd, args, o) => { if (cmd !== "fake-ffmpeg") argsFile = path.join(o.cwd, "args.json"); return fakeSpawn(cmd, args, o); };
    const r = await runT(mkDeps(base, {}, { spawn: spy }));
    assert.ok(r.done, JSON.stringify(r.error));
    const got = JSON.parse(fs.readFileSync(argsFile, "utf8"));
    assert.strictEqual(got.cwd, base);
    assert.ok(got.modelExists && got.wavExists, "model và wav phải mở được bằng đường dẫn tương đối");
    const at = f => got.args[got.args.indexOf(f) + 1];
    assert.strictEqual(at("-m"), "models/ggml-small.bin"); assert.strictEqual(at("-f"), "jobs/abcd1234/audio.wav");
    assert.strictEqual(at("-of"), "jobs/abcd1234/transcript"); assert.strictEqual(at("-l"), "zh"); assert.strictEqual(at("-t"), "3");
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
await atest("transcriber: lỗi thân thiện — không có tiếng, thiếu VC++ runtime, kết quả rỗng, whisper không ghi SRT, thiếu ffmpeg, id xấu", async () => {
  const base = mkBase();
  try {
    assert.match((await runT(mkDeps(base, { FF_MODE: "nostream" }))).error.message, /không có âm thanh/);
    // Mã 0xC0000135 chỉ tồn tại trên Windows (Linux cắt exit code còn 8 bit); phần ánh xạ mã đã có test riêng ở trên
    const vc = (await runT(mkDeps(base, { WH_MODE: "vcredist" }))).error.message;
    if (process.platform === "win32") assert.match(vc, /Visual C\+\+/); else assert.match(vc, /Công cụ nhận diện bị lỗi \(mã \d+\)/);
    assert.match((await runT(mkDeps(base, { WH_MODE: "empty" }))).error.message, /Không nhận diện được lời nói/);
    assert.match((await runT(mkDeps(base, { WH_MODE: "nosrt" }))).error.message, /không tạo ra file kết quả/);
    assert.match((await runT(mkDeps(base, {}, { ffmpeg: () => null }))).error.message, /ffmpeg/);
    assert.match((await runT(mkDeps(base), "../evil")).error.message, /không hợp lệ/);
    await tick(100);
    assert.deepStrictEqual(fs.readdirSync(path.join(base, "jobs")), []);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
await atest("transcriber: lỗi cài công cụ/mô hình được chuyển nguyên văn; lỗi lạ được bọc tiền tố", async () => {
  const base = mkBase();
  try {
    const { UserFacingError } = require("../dist-electron/main/core/douyin.js");
    assert.strictEqual((await runT(mkDeps(base, {}, { ensureModel: async () => { throw new UserFacingError("Mô hình hỏng"); } }))).error.message, "Mô hình hỏng");
    assert.match((await runT(mkDeps(base, {}, { ensureTools: async () => { throw new Error("boom"); } }))).error.message, /Không trích xuất được văn bản: boom/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
await atest("transcriber: huỷ khi whisper đang chạy → kill tiến trình, không phát done/error, dọn thư mục tạm", async () => {
  const base = mkBase();
  try {
    let whisperChild = null, events = 0;
    const spy = (cmd, args, o) => { const c = fakeSpawn(cmd, args, o); if (cmd !== "fake-ffmpeg") whisperChild = c; return c; };
    const h = tr.startTranscription({ id: "cancel01", inputPath: path.join(base, "in.mp4"), model: "small" }, mkDeps(base, { WH_MODE: "slow" }, { spawn: spy }));
    h.emitter.on("done", () => events++); h.emitter.on("error", () => events++);
    for (let i = 0; i < 100 && !whisperChild; i++) await tick(50);
    assert.ok(whisperChild, "whisper phải đã được khởi chạy");
    const exited = new Promise(r => whisperChild.on("exit", r));
    h.cancel();
    await Promise.race([exited, tick(3000).then(() => { throw new Error("whisper không bị kill"); })]);
    await tick(150);
    assert.strictEqual(events, 0);
    assert.deepStrictEqual(fs.readdirSync(path.join(base, "jobs")), []);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
fs.rmSync(fakeDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})();
