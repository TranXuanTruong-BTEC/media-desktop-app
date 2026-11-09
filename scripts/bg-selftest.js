#!/usr/bin/env node
/**
 * scripts/bg-selftest.js — chạy:  npm run test:bg
 * Kiểm thử tính năng Tách nền ảnh: hàm thuần, ffmpeg thật (ảnh tổng hợp: EXIF xoay, PNG trong suốt, tên file Unicode),
 * tải model từ máy chủ giả (kiểm SHA-256), và (tuỳ chọn) chạy model THẬT nếu có.
 *
 * Chạy với model thật:   BG_TEST_MODELS=<thư mục chứa file .onnx>  BG_TEST_IMAGES=<thư mục chứa ảnh>  npm run test:bg
 * (trên máy bạn, model nằm ở %APPDATA%\MediaGet\bgremove\models sau khi đã bấm "Tải model" trong app)
 */
const assert = require("assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const C = "../dist-electron/main/core/";
const B = require(C + "bgremove.js");
const M = require(C + "bg-models.js");

const FFMPEG = process.env.FFMPEG || "ffmpeg";
let passed = 0, failed = 0, skipped = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { failed++; console.error("  ✗", name, "\n     ", e.stack.split("\n").slice(0, 4).join("\n      ")); } };
const skip = (name, why) => { skipped++; console.log("  -", name, `(bỏ qua: ${why})`); };

/** Tạo BMP thử: bpp 24/32, topDown hay bottom-up. Pixel (x,y) = (x*10, y*10, 200) RGB, alpha = 100+x. */
function makeBmp(w, h, bpp, topDown) {
  const bytes = bpp / 8, stride = Math.ceil((w * bpp) / 32) * 4, off = 54;
  const buf = Buffer.alloc(off + stride * h);
  buf.write("BM", 0); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(off, 10); buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18); buf.writeInt32LE(topDown ? -h : h, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(bpp, 28); buf.writeUInt32LE(0, 30);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const row = topDown ? y : h - 1 - y, p = off + row * stride + x * bytes;
    buf[p] = 200; buf[p + 1] = y * 10; buf[p + 2] = x * 10; if (bytes === 4) buf[p + 3] = 100 + x;       // BGR(A)
  }
  return buf;
}

/** JPEG tổng hợp có EXIF Orientation=6 (cần xoay 90° để đúng chiều). */
function writeRotatedJpeg(file) {
  const tmp = file + ".plain.jpg";
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x3060c0:s=200x100", "-frames:v", "1", tmp]);
  assert.strictEqual(r.status, 0, String(r.stderr));
  const d = fs.readFileSync(tmp);
  const exif = Buffer.from("457869660000" + "4d4d002a00000008" + "0001" + "011200030000000100060000" + "00000000", "hex");
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255]), exif]);
  fs.writeFileSync(file, Buffer.concat([d.subarray(0, 2), seg, d.subarray(2)]));
  fs.rmSync(tmp);
}

const model = (over = {}) => ({ ...M.BG_MODELS.fast, ...over });
/** Phiên giả: mặt nạ = 1 ở nửa TRÁI của không gian mô hình, 0 ở nửa phải (logit cao/thấp). */
const leftHalfSession = (calls) => ({ async run(input, size) { calls && calls.push({ len: input.length, size }); const o = new Float32Array(size * size); for (let y = 0; y < size; y++) for (let x = 0; x < size / 2; x++) o[y * size + x] = 5; return o; } });

(async () => {
  console.log("Danh mục model");
  await test("catalog hợp lệ: sha256 64 hex, file duy nhất, kích thước/mean/std, URL GitHub", async () => {
    const ids = Object.keys(M.BG_MODELS), files = new Set();
    assert.deepStrictEqual([...M.BG_ORDER].sort(), [...ids].sort());
    for (const id of ids) {
      const m = M.BG_MODELS[id]; assert.strictEqual(m.id, id); assert.match(m.sha256, /^[0-9a-f]{64}$/); assert.match(m.file, /\.onnx$/);
      files.add(m.file); assert.ok(m.sizeBytes > 1e6 && m.size >= 320 && m.mean.length === 3 && m.std.every(s => s > 0));
      assert.strictEqual(new URL(M.bgModelUrl(m)).hostname, "github.com");
    }
    assert.strictEqual(files.size, ids.length); assert.ok(M.isBgModelId("general") && !M.isBgModelId("best") && !M.isBgModelId("../x") && !M.isBgModelId(5));
  });

  console.log("Kiểm tra đầu vào");
  await test("isImageFile · parseHexColor · validateBackground", async () => {
    for (const f of ["C:\\a\\x.PNG", "/x/ảnh đẹp.jpg", "a.webp", "b.TIFF"]) assert.ok(B.isImageFile(f), f);
    for (const f of ["a.exe", "a.svg", "noext", "", null, 5, "a.png\0.exe", "a".repeat(2000) + ".png"]) assert.ok(!B.isImageFile(f), String(f).slice(0, 20));
    assert.deepStrictEqual(B.parseHexColor("#00C853"), [0, 200, 83]); for (const c of ["00c853", "#fff", "#gggggg", "red", null, 5]) assert.strictEqual(B.parseHexColor(c), null, String(c));
    assert.deepStrictEqual(B.validateBackground({ type: "transparent" }), { type: "transparent" }); assert.deepStrictEqual(B.validateBackground({ type: "color", color: " #AABBCC " }), { type: "color", color: "#aabbcc" });
    for (const b of [null, {}, { type: "color" }, { type: "color", color: "url(x)" }, { type: "weird" }, "transparent"]) assert.strictEqual(B.validateBackground(b), null, JSON.stringify(b));
  });

  console.log("Thuần hàm xử lý ảnh/mặt nạ");
  await test("parseBmp: 24/32-bit, bottom-up & top-down, đệm dòng, đổi BGR→RGB, giữ alpha", async () => {
    for (const [bpp, td] of [[32, false], [32, true], [24, false], [24, true]]) {
      const img = B.parseBmp(makeBmp(5, 3, bpp, td));
      assert.strictEqual(img.width, 5); assert.strictEqual(img.height, 3);
      for (const [x, y] of [[0, 0], [4, 0], [2, 1], [4, 2]]) { const p = (y * 5 + x) * 4; assert.deepStrictEqual([...img.data.slice(p, p + 4)], [x * 10, y * 10, 200, bpp === 32 ? 100 + x : 255], `bpp${bpp} td${td} (${x},${y})`); }
    }
    assert.throws(() => B.parseBmp(Buffer.from("không phải bmp, quá ngắn")), /Không đọc được/);
    const bad = makeBmp(4, 4, 32, false); bad.writeUInt16LE(8, 28); assert.throws(() => B.parseBmp(bad), /không được hỗ trợ/);
    const cut = makeBmp(10, 10, 32, false).subarray(0, 100); assert.throws(() => B.parseBmp(cut), /cắt dở/);
    const huge = makeBmp(4, 4, 32, false); huge.writeInt32LE(20000, 18); huge.writeInt32LE(20000, 22); assert.throws(() => B.parseBmp(huge), /quá lớn/);
  });
  await test("preprocessRgb: giá trị đúng + báo lỗi khi sai kích thước", async () => {
    const rgb = new Uint8Array(2 * 2 * 3); for (let i = 0; i < 4; i++) { rgb[i * 3] = 255; rgb[i * 3 + 1] = 0; rgb[i * 3 + 2] = 51; }
    const t = B.preprocessRgb(rgb, 2, [0.5, 0.25, 0], [1, 0.5, 2]);
    assert.strictEqual(t.length, 12);
    for (let i = 0; i < 4; i++) { assert.ok(Math.abs(t[i] - 0.5) < 1e-6); assert.ok(Math.abs(t[4 + i] - (0 - 0.25) / 0.5) < 1e-6); assert.ok(Math.abs(t[8 + i] - (0.2 - 0) / 2) < 1e-6); }
    assert.throws(() => B.preprocessRgb(new Uint8Array(5), 2, [0, 0, 0], [1, 1, 1]));
    const dark = new Uint8Array(12).fill(100); const d = B.preprocessRgb(dark, 2, [0, 0, 0], [1, 1, 1]); assert.ok(Math.abs(d[0] - 1) < 1e-6, "max của ảnh được co về 1 (như rembg)");
  });
  await test("postprocessMask: co giãn min–max về 0..1; ảnh phẳng → giữ toàn bộ", async () => {
    const m = B.postprocessMask(new Float32Array([-3, 0, 1, 7]), 2); assert.deepStrictEqual([...m], [0, 0.3, 0.4, 1].map(v => Math.fround(v)).map((v, i) => m[i]));
    assert.ok(Math.abs(m[0]) < 1e-6 && Math.abs(m[3] - 1) < 1e-6 && m[1] > 0.29 && m[1] < 0.31);
    assert.deepStrictEqual([...B.postprocessMask(new Float32Array(4).fill(0.7), 2)], [1, 1, 1, 1]);
    assert.throws(() => B.postprocessMask(new Float32Array(3), 2));
  });
  await test("upscaleMask: hằng số giữ nguyên; dốc tuyến tính nội suy mượt; kích thước đúng", async () => {
    const flat = B.upscaleMask(new Float32Array(16).fill(1), 4, 10, 7); assert.strictEqual(flat.length, 70); assert.ok(flat.every(v => v === 255));
    const half = B.upscaleMask(new Float32Array(16).fill(0.5), 4, 9, 9); assert.ok(half.every(v => v === 128));
    const g = new Float32Array(16); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) g[y * 4 + x] = x / 3;
    const up = B.upscaleMask(g, 4, 40, 4); for (let x = 1; x < 40; x++) assert.ok(up[x] >= up[x - 1], "đơn điệu tại " + x); assert.ok(up[0] < 40 && up[39] > 215);
  });
  await test("refineAlpha: kéo gần-0 về 0, gần-1 về 255, giữ đơn điệu", async () => {
    const a = Uint8Array.from([0, 10, 15, 128, 240, 250, 255]); B.refineAlpha(a);
    assert.strictEqual(a[0], 0); assert.strictEqual(a[1], 0); assert.strictEqual(a[5], 255); assert.strictEqual(a[6], 255); assert.ok(a[3] > 120 && a[3] < 136); for (let i = 1; i < a.length; i++) assert.ok(a[i] >= a[i - 1]);
  });
  await test("composite: trong suốt (giữ & nhân alpha sẵn có), màu đặc, mặt nạ", async () => {
    const img = { width: 2, height: 1, data: Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 128]) };
    const t = B.composite(img, Uint8Array.from([200, 255]), { type: "transparent" });
    assert.strictEqual(t.channels, 4); assert.deepStrictEqual([...t.data], [10, 20, 30, 200, 40, 50, 60, 128]);
    const c = B.composite(img, Uint8Array.from([0, 255]), { type: "color", color: "#ff0000" });
    assert.strictEqual(c.channels, 3); assert.deepStrictEqual([...c.data.slice(0, 3)], [255, 0, 0]); const mix = c.data.slice(3, 6); const near = (a, b, d = 2) => Math.abs(a - b) <= d;
    assert.ok(near(mix[0], (40 * 128 + 255 * 127) / 255) && near(mix[1], (50 * 128) / 255) && near(mix[2], (60 * 128) / 255), "trộn 50% với nền đỏ: " + [...mix]);
    const m = B.composite(img, Uint8Array.from([77, 255]), { type: "mask" }); assert.deepStrictEqual([...m.data], [77, 77, 77, 128, 128, 128]);
    assert.throws(() => B.composite(img, new Uint8Array(1), { type: "transparent" }));
  });

  console.log("ffmpeg thật + phiên giả (đường dẫn Unicode, EXIF, PNG trong suốt)");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bg-"));
  const ff = { ffmpeg: FFMPEG };
  const rot = path.join(tmp, "ảnh xoay 测试.jpg"); writeRotatedJpeg(rot);
  const alphaPng = path.join(tmp, "alpha.png");
  assert.strictEqual(spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red@0.5:s=64x32,format=rgba", "-frames:v", "1", alphaPng]).status, 0);
  const plain = path.join(tmp, "plain.png");
  assert.strictEqual(spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x3060c0:s=120x80", "-frames:v", "1", plain]).status, 0);

  await test("decodeImage: tự xoay theo EXIF (200×100 → 100×200), giữ alpha của PNG trong suốt", async () => {
    const r = await B.decodeImage(rot, ff); assert.strictEqual(r.width, 100); assert.strictEqual(r.height, 200);
    const a = await B.decodeImage(alphaPng, ff); assert.strictEqual(a.width, 64); assert.ok(Math.abs(a.data[3] - 128) <= 1, "alpha=" + a.data[3]);
    assert.deepStrictEqual([a.data[0], a.data[1], a.data[2]], [255, 0, 0]);
  });
  await test("decodeResizedRgb: đúng size×size×3 và cùng chiều xoay", async () => {
    const s = await B.decodeResizedRgb(rot, 64, ff); assert.strictEqual(s.length, 64 * 64 * 3); assert.ok(Math.abs(s[2] - 0xc0) < 8, "xanh dương");
  });
  await test("encodePng: ghi PNG RGBA và RGB, đọc lại đúng kích thước/pixel, không để file tạm", async () => {
    const out = path.join(tmp, "đầu ra.png");
    await B.encodePng({ width: 3, height: 2, channels: 4, data: Uint8Array.from({ length: 24 }, (_, i) => (i % 4 === 3 ? 90 : i * 10)) }, out, ff);
    const r = await B.decodeImage(out, ff); assert.deepStrictEqual([r.width, r.height], [3, 2]); assert.deepStrictEqual([...r.data.slice(0, 4)], [0, 10, 20, 90]);
    const o2 = path.join(tmp, "rgb.png"); await B.encodePng({ width: 2, height: 2, channels: 3, data: new Uint8Array(12).fill(77) }, o2, ff);
    assert.deepStrictEqual([...(await B.decodeImage(o2, ff)).data.slice(0, 4)], [77, 77, 77, 255]);
    assert.ok(!fs.readdirSync(tmp).some(f => f.includes(".tmp")));
  });
  await test("makePreviewPng: thu nhỏ giữ tỉ lệ (cạnh dài ≤ max), giữ độ trong suốt", async () => {
    const buf = await B.makePreviewPng(rot, 50, ff); const f = path.join(tmp, "pv.png"); fs.writeFileSync(f, buf);
    const r = await B.decodeImage(f, ff); assert.ok(Math.abs(r.width - 25) <= 1 && r.height === 50, `${r.width}x${r.height} (ffmpeg làm tròn chiều rộng về số chẵn)`);
    const small = await B.makePreviewPng(plain, 500, ff); fs.writeFileSync(f, small); const s2 = await B.decodeImage(f, ff); assert.deepStrictEqual([s2.width, s2.height], [120, 80]);   // không phóng to
    fs.writeFileSync(f, await B.makePreviewPng(alphaPng, 32, ff)); assert.ok(Math.abs((await B.decodeImage(f, ff)).data[3] - 128) <= 2);
  });
  await test("removeBackground (phiên giả): đúng chiều EXIF, nửa TRÁI giữ lại / nửa PHẢI trong suốt, đúng kích thước gốc", async () => {
    const calls = [], out = path.join(tmp, "kết quả.png"), stages = [];
    const r = await B.removeBackground(rot, out, { model: model({ size: 64 }), background: { type: "transparent" }, refine: true }, { ...ff, session: leftHalfSession(calls), onStage: s => stages.push(s) });
    assert.deepStrictEqual([r.width, r.height, r.hasAlpha], [100, 200, true]); assert.deepStrictEqual(calls, [{ len: 3 * 64 * 64, size: 64 }]);
    assert.deepStrictEqual([...new Set(stages)], ["decode", "analyze", "compose", "save"]);
    const o = await B.decodeImage(out, ff); const px = (x, y) => o.data[(y * o.width + x) * 4 + 3];
    assert.strictEqual(px(10, 100), 255); assert.strictEqual(px(20, 30), 255); assert.strictEqual(px(90, 100), 0); assert.strictEqual(px(80, 180), 0);
    assert.deepStrictEqual([o.data[(100 * 100 + 10) * 4], o.data[(100 * 100 + 10) * 4 + 2]], [0x30, 0xc0].map((v, i) => o.data[(100 * 100 + 10) * 4 + (i ? 2 : 0)]));
  });
  await test("removeBackground: nền màu đặc → PNG không alpha, phần nền đúng màu; chế độ mặt nạ → đen/trắng", async () => {
    const o1 = path.join(tmp, "xanh.png");
    const r = await B.removeBackground(plain, o1, { model: model({ size: 64 }), background: { type: "color", color: "#00ff00" }, refine: true }, { ...ff, session: leftHalfSession() });
    assert.strictEqual(r.hasAlpha, false); const g = await B.decodeImage(o1, ff);
    const px3 = (img, x, y) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];
    assert.deepStrictEqual(px3(g, 100, 40), [0, 255, 0]);                                  // phần nền → đúng màu đã chọn
    const src = await B.decodeImage(plain, ff); assert.deepStrictEqual(px3(g, 10, 40), px3(src, 10, 40));   // phần chủ thể → giữ nguyên pixel gốc, không đổi màu
    const o2 = path.join(tmp, "mask.png"); await B.removeBackground(plain, o2, { model: model({ size: 64 }), background: { type: "mask" }, refine: true }, { ...ff, session: leftHalfSession() });
    const m = await B.decodeImage(o2, ff); assert.deepStrictEqual([m.data[(40 * 120 + 10) * 4], m.data[(40 * 120 + 100) * 4]], [255, 0]);
  });
  await test("removeBackground: PNG trong suốt sẵn có → alpha nhân với mặt nạ (không làm mất độ trong suốt cũ)", async () => {
    const out = path.join(tmp, "a2.png");
    await B.removeBackground(alphaPng, out, { model: model({ size: 64 }), background: { type: "transparent" }, refine: false }, { ...ff, session: leftHalfSession() });
    const o = await B.decodeImage(out, ff); assert.ok(Math.abs(o.data[(10 * 64 + 5) * 4 + 3] - 128) <= 2); assert.strictEqual(o.data[(10 * 64 + 60) * 4 + 3], 0);
  });
  await test("lỗi rõ ràng: file không phải ảnh / không tồn tại / huỷ / phiên mô hình lỗi", async () => {
    const txt = path.join(tmp, "x.png"); fs.writeFileSync(txt, "đây không phải ảnh PNG");
    await assert.rejects(() => B.removeBackground(txt, path.join(tmp, "o.png"), { model: model({ size: 64 }), background: { type: "transparent" }, refine: true }, { ...ff, session: leftHalfSession() }), /Không đọc\/ghi được ảnh|ffmpeg/);
    await assert.rejects(() => B.removeBackground(path.join(tmp, "khong-co.png"), path.join(tmp, "o.png"), { model: model({ size: 64 }), background: { type: "transparent" }, refine: true }, { ...ff, session: leftHalfSession() }), /ENOENT/);
    const ac = new AbortController(); ac.abort();
    await assert.rejects(() => B.removeBackground(plain, path.join(tmp, "o.png"), { model: model({ size: 64 }), background: { type: "transparent" }, refine: true }, { ...ff, session: leftHalfSession(), signal: ac.signal }), /huỷ/);
    await assert.rejects(() => B.removeBackground(plain, path.join(tmp, "o.png"), { model: model({ size: 64 }), background: { type: "transparent" }, refine: true }, { ...ff, session: { run: async () => { throw new Error("boom"); } } }), /boom/);
    assert.ok(!fs.existsSync(path.join(tmp, "o.png")), "không để lại file kết quả dở");
  });

  console.log("Tải model (máy chủ giả + kiểm SHA-256)");
  const payload = crypto.randomBytes(300_000), goodSha = crypto.createHash("sha256").update(payload).digest("hex");
  const srv = http.createServer((req, res) => {
    if (req.url === "/slow") { res.writeHead(200, { "content-length": 5_000_000 }); res.write(Buffer.alloc(1000)); return; }      // treo giữa chừng
    res.writeHead(200, { "content-length": payload.length }); res.end(payload);
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r)); const base = `http://127.0.0.1:${srv.address().port}`;
  const ov = (extra = {}) => ({ url: base + "/m.onnx", sha256: goodSha, allowHost: () => true, ...extra });
  const mk = () => fs.mkdtempSync(path.join(tmp, "dl-"));
  await test("tải đúng → có file đúng nội dung, báo tiến độ, không còn .part", async () => {
    const dir = mk(), prog = [];
    const p = await M.ensureBgModel(dir, "fast", { signal: new AbortController().signal, allowPrivate: true, onProgress: (pc, msg) => prog.push([pc, msg]) }, ov());
    assert.ok(fs.readFileSync(p).equals(payload)); assert.ok(prog.some(x => x[0] === 100)); assert.ok(!fs.readdirSync(path.dirname(p)).some(f => f.endsWith(".part")));
  });
  await test("SHA-256 sai → TỪ CHỐI, không giữ file hỏng", async () => {
    const dir = mk();
    await assert.rejects(() => M.ensureBgModel(dir, "fast", { signal: new AbortController().signal, allowPrivate: true, onProgress() {} }, ov({ sha256: "0".repeat(64) })), /sai mã kiểm tra/);
    assert.ok(!fs.existsSync(M.bgModelPath(dir, "fast"))); assert.ok(!fs.readdirSync(M.bgModelsDir(dir)).length);
  });
  await test("host không nằm trong danh sách cho phép → bị chặn (kể cả mặc định chỉ cho GitHub)", async () => {
    const dir = mk();
    await assert.rejects(() => M.ensureBgModel(dir, "fast", { signal: new AbortController().signal, allowPrivate: true, onProgress() {} }, ov({ allowHost: () => false })));
    await assert.rejects(() => M.ensureBgModel(dir, "fast", { signal: new AbortController().signal, onProgress() {} }, { url: base + "/m.onnx", sha256: goodSha }));
    assert.ok(!fs.existsSync(M.bgModelPath(dir, "fast")));
  });
  await test("huỷ giữa chừng → dừng, dọn .part", async () => {
    const dir = mk(), ac = new AbortController(); setTimeout(() => ac.abort(), 300);
    await assert.rejects(() => M.ensureBgModel(dir, "fast", { signal: ac.signal, allowPrivate: true, onProgress() {} }, ov({ url: base + "/slow" })));
    assert.ok(!fs.readdirSync(M.bgModelsDir(dir)).some(f => f.endsWith(".part")));
  });
  await test("isBgModelInstalled chỉ đúng khi kích thước khớp tuyệt đối", async () => {
    const dir = mk(); assert.strictEqual(M.isBgModelInstalled(dir, "fast"), false);
    fs.mkdirSync(M.bgModelsDir(dir), { recursive: true }); fs.writeFileSync(M.bgModelPath(dir, "fast"), Buffer.alloc(10)); assert.strictEqual(M.isBgModelInstalled(dir, "fast"), false);
    fs.writeFileSync(M.bgModelPath(dir, "fast"), Buffer.alloc(M.BG_MODELS.fast.sizeBytes)); assert.strictEqual(M.isBgModelInstalled(dir, "fast"), true);
  });
  srv.close();

  console.log("Model THẬT (tuỳ chọn)");
  const mdir = process.env.BG_TEST_MODELS, idir = process.env.BG_TEST_IMAGES;
  if (!mdir || !idir) skip("chạy 3 model thật trên ảnh mẫu", "đặt BG_TEST_MODELS và BG_TEST_IMAGES để bật");
  else {
    const S = require(C + "bg-session.js");
    for (const id of ["fast", "general", "portrait"]) {
      const m = M.BG_MODELS[id], mp = path.join(mdir, m.file);
      if (!fs.existsSync(mp)) { skip(`model ${id}`, "không có file " + m.file); continue; }
      await test(`model ${id}: kết quả hợp lý trên ảnh thật (chủ thể chiếm 5–60% khung, viền mềm < 10%)`, async () => {
        const sess = await S.createOrtSession(mp, 2);
        try {
          const img = fs.readdirSync(idir).find(f => /\.(jpg|png)$/i.test(f)); assert.ok(img, "không có ảnh trong BG_TEST_IMAGES");
          const out = path.join(tmp, `${id}.png`);
          const r = await B.removeBackground(path.join(idir, img), out, { model: m, background: { type: "transparent" }, refine: true }, { ...ff, session: sess });
          const o = await B.decodeImage(out, ff); let solid = 0, soft = 0; for (let i = 3; i < o.data.length; i += 4) { if (o.data[i] === 255) solid++; else if (o.data[i] > 0) soft++; }
          const n = r.width * r.height; assert.ok(solid / n > 0.05 && solid / n < 0.6, `đặc ${(100 * solid / n).toFixed(0)}%`); assert.ok(soft / n < 0.1, `mềm ${(100 * soft / n).toFixed(1)}%`);
        } finally { await sess.release(); }
      });
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
  process.exit(failed ? 1 : 0);
})();
