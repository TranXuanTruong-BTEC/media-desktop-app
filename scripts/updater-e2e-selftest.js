#!/usr/bin/env node
/**
 * scripts/updater-e2e-selftest.js — chạy:  npm run test:updater:e2e
 * Kiểm thử cập nhật bằng thư viện electron-updater THẬT (NsisUpdater) + máy chủ HTTP cục bộ + latest.yml do
 * scripts/write-latest-yml.js sinh ra, kết hợp src/main/ipc/updater.ts. Chỉ `electron` được giả.
 * Kiểm: phát hiện bản mới, tải, kiểm sha512 (sai → từ chối), trạng thái "ready", tham số cài đặt thật
 * (--updated /S --force-run). Không thay được lần thử trên Windows với bản cài thật, nhưng bắt được lỗi
 * định dạng latest.yml / checksum / luồng sự kiện.
 */
const assert = require("assert");
const Module = require("module");
const os = require("os");
const fs = require("fs");
const path = require("path");
const http = require("http");
const cp = require("child_process");

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { failed++; console.error("  ✗", name, "\n     ", String(e.stack).split("\n").slice(0, 5).join("\n      ")); } };
const sent = [];
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function until(cond, ms = 8000) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("hết giờ chờ; các trạng thái đã nhận: " + JSON.stringify(sent.filter(s => s.ch === "updater:status").map(s => [s.phase, s.message]))); await wait(25); } }

const root = path.join(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "upd-e2e-"));
const feedDir = path.join(tmp, "feed");
fs.mkdirSync(feedDir, { recursive: true });

// 1) Sinh latest.yml bằng ĐÚNG script của dự án (trong thư mục tạm, không đụng release/ thật)
function buildFeed(version, exeBytes) {
  const proj = path.join(tmp, "proj-" + version);
  fs.mkdirSync(path.join(proj, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(proj, "release"), { recursive: true });
  fs.copyFileSync(path.join(root, "scripts", "write-latest-yml.js"), path.join(proj, "scripts", "write-latest-yml.js"));
  fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ version }));
  const exe = path.join(proj, "release", `MediaGet-Setup-${version}.exe`);
  fs.writeFileSync(exe, exeBytes);
  cp.execFileSync(process.execPath, [path.join(proj, "scripts", "write-latest-yml.js")], { stdio: "pipe" });
  fs.copyFileSync(exe, path.join(feedDir, path.basename(exe)));
  fs.copyFileSync(path.join(proj, "release", "latest.yml"), path.join(feedDir, "latest.yml"));
  return path.basename(exe);
}
const exeBytes = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(300 * 1024, 7)]);   // giả bộ cài ~300 KB

// 2) Máy chủ cục bộ (có thể làm hỏng file để thử checksum)
let corrupt = false;
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (/^\/latest(-[a-z0-9]+)?\.yml$/.test(rel)) rel = "/latest.yml";           // Windows hỏi latest.yml; Linux/Mac (khi chạy test ở đó) hỏi latest-linux.yml / latest-mac.yml
  const f = path.join(feedDir, rel);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  let buf = fs.readFileSync(f);
  if (corrupt && f.endsWith(".exe")) { buf = Buffer.from(buf); buf[1000] ^= 0xff; }
  res.writeHead(200, { "Content-Length": buf.length, "Content-Type": "application/octet-stream" });
  res.end(buf);
});

// 3) electron giả + electron-updater THẬT (NsisUpdater)
const handlers = new Map();
const webContents = { send: (ch, p) => sent.push({ ch, ...p }) };
const win = { isDestroyed: () => false, webContents };
let quitCalled = 0;
let quitHandlers = [];
const fakeApp = {
  isPackaged: true, name: "MediaGet", getName: () => "MediaGet", get version() { return CURRENT; }, getVersion: () => CURRENT, getAppPath: () => tmp,
  baseCachePath: path.join(tmp, "cache"), userDataPath: path.join(tmp, "userData"), appUpdateConfigPath: path.join(tmp, "dev-app-update.yml"),
  onQuit: (h) => { quitHandlers.push(h); },
  getPath: (n) => path.join(tmp, n), quit: () => { quitCalled++; }, once() {}, on() {}, whenReady: () => Promise.resolve(),
};
let CURRENT = "2.8.1";
let updater;
const spawned = [];
const realSpawn = cp.spawn;
cp.spawn = function (cmd, args, opts) {            // chặn việc chạy bộ cài thật, chỉ ghi lại tham số
  if (String(cmd).toLowerCase().endsWith(".exe")) { spawned.push({ cmd, args }); const { EventEmitter } = require("events"); const e = new EventEmitter(); e.unref = () => {}; e.pid = 1; process.nextTick(() => e.emit("spawn")); return e; }
  return realSpawn.apply(this, arguments);
};
const realLoad = Module._load;
Module._load = function (req) {
  if (req === "electron") return { autoUpdater: new (require("events").EventEmitter)(), app: fakeApp, ipcMain: { handle: (c, f) => handlers.set(c, f), on() {} }, BrowserWindow: class {}, dialog: {}, shell: {} };
  if (req === "electron-updater") return { autoUpdater: updater };
  return realLoad.apply(this, arguments);
};

(async () => {
  buildFeed("2.8.2", exeBytes);
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;

  const { NsisUpdater } = realLoad.call(Module, "electron-updater", module, false);
  // Dùng đúng bản builder-util-runtime mà electron-updater dùng (bản lồng bên trong), để đường tải + kiểm sha512 giống app thật.
  const runtimeDir = path.dirname(require.resolve("electron-updater"));
  const runtime = require(require.resolve("builder-util-runtime", { paths: [runtimeDir] }));
  class NodeHttpExecutor extends runtime.HttpExecutor {
    // Thay ElectronHttpExecutor (cần electron.net): giữ nguyên download()/doDownload() của thư viện, chỉ gửi yêu cầu bằng http của Node.
    createRequest(options, callback) { return http.request(options, callback); }
    async download(u, destination, options) {
      return await options.cancellationToken.createPromise((resolve, reject, onCancel) => {
        const requestOptions = { headers: options.headers || undefined, redirect: "manual" };
        runtime.configureRequestUrl(u, requestOptions);
        runtime.configureRequestOptions(requestOptions);
        this.doDownload(requestOptions, { destination, options, onCancel, callback: (e) => (e == null ? resolve(destination) : reject(e)), responseHandler: null }, 0);
      });
    }
  }
  const makeUpdater = () => {
    const u = new NsisUpdater(undefined, fakeApp);
    u.httpExecutor = new NodeHttpExecutor();
    u.setFeedURL({ provider: "generic", url });                                 // sau khi gán executor (provider giữ executor lúc tạo)
    u.forceDevUpdateConfig = true;
    u.logger = { info() {}, warn() {}, error() {}, debug() {} };
    return u;
  };
  updater = makeUpdater();
  const dev = path.join(tmp, "dev-app-update.yml");
  fs.writeFileSync(dev, `provider: generic\nurl: ${url}\n`);

  const { registerUpdaterHandlers } = require("../dist-electron/main/ipc/updater.js");
  registerUpdaterHandlers(win);
  const evt = { sender: webContents, senderFrame: { parent: null, url: "file:///app/index.html" } };
  const invoke = (ch, ...a) => handlers.get(ch)(evt, ...a);
  const st = () => sent.filter(s => s.ch === "updater:status");
  const phases = () => st().map(s => s.phase);

  console.log("Với latest.yml do scripts/write-latest-yml.js sinh ra");
  await test("đang ở 2.8.1, máy chủ có 2.8.2 → phát hiện, TỰ TẢI, kiểm sha512 đạt, báo 'ready'", async () => {
    sent.length = 0;
    await invoke("updater:check");
    await until(() => phases().includes("ready"));
    const p = phases();
    assert.ok(p.includes("checking") && p.includes("available"), JSON.stringify(p));
    const ready = st().find(s => s.phase === "ready");
    assert.strictEqual(ready.version, "2.8.2");
    assert.ok(st().every(s => s.silent === false), "bấm tay → không im lặng");
  });
  await test("'Cập nhật ngay' chạy bộ cài với đúng tham số IM LẶNG: --updated /S --force-run, rồi thoát app", async () => {
    spawned.length = 0; quitCalled = 0;
    await invoke("updater:installNow");
    await until(() => spawned.length > 0 && quitCalled > 0);
    const s = spawned[0];
    assert.match(path.basename(s.cmd), /^MediaGet-Setup-2\.8\.2\.exe$/i, s.cmd);
    assert.deepStrictEqual(s.args, ["--updated", "/S", "--force-run"]);
  });

  await test("người dùng KHÔNG bấm gì, chỉ đóng app → bộ cài chạy IM LẶNG (--updated /S), không tự mở lại", async () => {
    await fresh("2.8.2", "2.8.1");
    await invoke("updater:check");
    await until(() => phases().includes("ready"));
    assert.ok(quitHandlers.length > 0, "phải đăng ký xử lý 'khi thoát app'");
    spawned.length = 0;
    for (const h of quitHandlers) await h(0);                 // mô phỏng app thoát bình thường (mã 0)
    await until(() => spawned.length > 0);
    assert.deepStrictEqual(spawned[0].args, ["--updated", "/S"]);
  });

  console.log("Các tình huống lỗi / ngoại lệ");
  async function fresh(version, current, clearCache = false) {
    if (clearCache) fs.rmSync(path.join(tmp, "cache"), { recursive: true, force: true });      // thư viện dùng lại file đã tải trong cache
    for (const k of Object.keys(require.cache)) if (k.includes("dist-electron")) delete require.cache[k];
    handlers.clear(); sent.length = 0; CURRENT = current; spawned.length = 0; quitHandlers = [];
    updater = makeUpdater();
    require("../dist-electron/main/ipc/updater.js").registerUpdaterHandlers(win);
  }
  await test("đã ở bản mới nhất → 'not-available', không tải gì", async () => {
    await fresh("2.8.2", "2.8.2");
    await invoke("updater:check");
    await until(() => phases().includes("not-available"));
    assert.ok(!phases().includes("downloading") && !phases().includes("ready"));
  });
  await test("file bộ cài bị hỏng giữa đường (sai sha512) → TỪ CHỐI, báo lỗi, KHÔNG báo 'ready', không cho cài", async () => {
    await fresh("2.8.2", "2.8.1", true);
    corrupt = true;
    await invoke("updater:check");
    await until(() => phases().includes("error"));
    corrupt = false;
    assert.ok(!phases().includes("ready"));
    spawned.length = 0;
    await invoke("updater:installNow");
    await wait(100);
    assert.strictEqual(spawned.length, 0, "không được chạy bộ cài khi chưa có bản hợp lệ");
  });
  await test("sau lỗi checksum, lần kiểm tra kế tiếp (mạng ổn) tải lại được bản đúng", async () => {
    sent.length = 0;
    await invoke("updater:check");
    await until(() => phases().includes("ready"));
    assert.strictEqual(st().find(s => s.phase === "ready").version, "2.8.2");
  });
  await test("máy chủ không có latest.yml (404) → báo lỗi một lần, không treo", async () => {
    await fresh("2.8.2", "2.8.1");
    const bak = path.join(feedDir, "latest.yml.bak");
    fs.renameSync(path.join(feedDir, "latest.yml"), bak);
    try {
      await invoke("updater:check");
      await until(() => phases().includes("error"));
      assert.strictEqual(phases().filter(p => p === "error").length, 1);
    } finally { fs.renameSync(bak, path.join(feedDir, "latest.yml")); }
  });
})().catch(e => { failed++; console.error(e); }).finally(() => {
  cp.spawn = realSpawn; server.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
