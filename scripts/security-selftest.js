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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})();
