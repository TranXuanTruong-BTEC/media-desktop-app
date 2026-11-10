#!/usr/bin/env node
/**
 * scripts/updater-selftest.js — chạy:  npm run test:updater
 * Kiểm thử logic cập nhật NGẦM với `electron` và `electron-updater` giả (không cần Windows, không cần mạng):
 * cấu hình tải/cài ngầm, sự kiện của lần kiểm tra tự động phải mang cờ silent, lần bấm tay thì không,
 * "cài ngay" chỉ chạy khi đã tải xong và phải là cài IM LẶNG + tự mở lại, lỗi không bị báo hai lần.
 */
const assert = require("assert");
const Module = require("module");
const os = require("os");
const { EventEmitter } = require("events");

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { failed++; console.error("  ✗", name, "\n     ", e.stack.split("\n").slice(0, 4).join("\n      ")); } };

// ── Đồ giả ────────────────────────────────────────────────────────────────────
const handlers = new Map();
const sent = [];
const webContents = { send: (ch, payload) => sent.push({ ch, ...payload }) };
const win = { isDestroyed: () => false, webContents };
const fakeApp = { isPackaged: true, getPath: () => os.tmpdir(), getVersion: () => "0.0.0", getName: () => "t" };

class FakeUpdater extends EventEmitter {
  constructor() { super(); this.calls = { check: 0, download: 0, quit: [] }; this.behaviour = async () => {}; }
  async checkForUpdates() { this.calls.check++; return this.behaviour(); }
  async downloadUpdate() { this.calls.download++; }
  quitAndInstall(...a) { this.calls.quit.push(a); }
}
const updater = new FakeUpdater();

const realLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === "electron") return { app: fakeApp, ipcMain: { handle: (c, f) => handlers.set(c, f), on() {} }, BrowserWindow: class {}, dialog: {}, shell: {} };
  if (req === "electron-updater") return { autoUpdater: updater };
  return realLoad.apply(this, arguments);
};

const { registerUpdaterHandlers } = require("../dist-electron/main/ipc/updater.js");
registerUpdaterHandlers(win);

const evt = { sender: webContents, senderFrame: { parent: null, url: "file:///app/index.html" } };
const invoke = (ch, ...a) => handlers.get(ch)(evt, ...a);
const statuses = () => sent.filter(s => s.ch === "updater:status");
const last = () => statuses()[statuses().length - 1];
const reset = () => { sent.length = 0; updater.calls = { check: 0, download: 0, quit: [] }; updater.behaviour = async () => {}; };

(async () => {
  console.log("Cấu hình ngầm");
  await test("tự tải, tự cài khi đóng app, không hạ cấp", async () => {
    assert.strictEqual(updater.autoDownload, true);
    assert.strictEqual(updater.autoInstallOnAppQuit, true);
    assert.strictEqual(updater.allowDowngrade, false);
  });

  console.log("Lần kiểm tra TỰ ĐỘNG (im lặng)");
  await test("cài ngay bị từ chối khi chưa tải xong bản nào", async () => {
    reset();
    await invoke("updater:installNow");
    assert.strictEqual(updater.calls.quit.length, 0);
  });
  await test("sự kiện của chu kỳ tự động đều mang silent=true, kể cả 'ready'", async () => {
    reset();
    // mô phỏng chu kỳ tự động: bộ hẹn giờ gọi runCheck(false). Ta kích bằng sự kiện như electron-updater sẽ phát.
    updater.emit("checking-for-update");
    updater.emit("update-available", { version: "9.9.9", releaseNotes: "<b>mới</b>" });
    updater.emit("download-progress", { percent: 42.4 });
    const ss = statuses();
    assert.ok(ss.length === 3 && ss.every(s => s.silent === true), JSON.stringify(ss));
    assert.strictEqual(ss[1].releaseNotes, "mới");
    assert.strictEqual(ss[2].percent, 42);
    updater.emit("update-downloaded", { version: "9.9.9" });
    assert.deepStrictEqual([last().phase, last().version, last().silent], ["ready", "9.9.9", true]);
  });
  await test("sau khi tải xong: 'Cập nhật ngay' = cài IM LẶNG + tự mở lại app", async () => {
    reset();
    await invoke("updater:installNow");
    assert.deepStrictEqual(updater.calls.quit, [[true, true]]);
  });
  await test("đã có bản tải xong → bấm 'Kiểm tra' không gọi mạng nữa, báo 'ready' (không im lặng)", async () => {
    reset();
    await invoke("updater:check");
    assert.strictEqual(updater.calls.check, 0);
    assert.deepStrictEqual([last().phase, last().version, last().silent], ["ready", "9.9.9", false]);
  });
})().then(async () => {
  // Phần còn lại cần một bản MỚI của module (chưa có bản tải xong) → nạp lại trong ngữ cảnh sạch.
  for (const k of Object.keys(require.cache)) if (k.includes("dist-electron")) delete require.cache[k];
  handlers.clear(); updater.removeAllListeners(); reset();
  require("../dist-electron/main/ipc/updater.js").registerUpdaterHandlers(win);

  console.log("Người dùng bấm 'Kiểm tra' (hiện đủ trạng thái)");
  await test("bấm tay: gọi kiểm tra; checking/not-available hiện ra (silent=false); sau đó quay lại im lặng", async () => {
    reset();
    updater.behaviour = async () => { updater.emit("checking-for-update"); updater.emit("update-not-available", {}); };
    await invoke("updater:check");
    assert.strictEqual(updater.calls.check, 1);
    assert.deepStrictEqual(statuses().map(s => [s.phase, s.silent]), [["checking", false], ["not-available", false]]);
    updater.emit("checking-for-update");
    assert.strictEqual(last().silent, true, "chu kỳ sau đó phải im lặng trở lại");
    updater.emit("update-not-available", {});               // đóng chu kỳ tự động giả
  });
  await test("lỗi mạng khi bấm tay: CHỈ MỘT thông báo lỗi dù electron-updater vừa phát 'error' vừa ném lỗi", async () => {
    reset();
    updater.behaviour = async () => { const e = new Error("getaddrinfo ENOTFOUND github.com"); updater.emit("error", e); throw e; };
    await invoke("updater:check");
    const errs = statuses().filter(s => s.phase === "error");
    assert.strictEqual(errs.length, 1);
    assert.strictEqual(errs[0].silent, false);
    assert.match(errs[0].message, /Không kết nối được GitHub/);
  });
  await test("lỗi chỉ ném ra mà không phát sự kiện: vẫn báo đúng một lần, rồi cho kiểm tra lại được", async () => {
    reset();
    updater.behaviour = async () => { throw new Error("ECONNRESET"); };
    await invoke("updater:check");
    assert.strictEqual(statuses().filter(s => s.phase === "error").length, 1);
    updater.behaviour = async () => { updater.emit("update-not-available", {}); };
    await invoke("updater:check");
    assert.strictEqual(updater.calls.check, 2, "không bị kẹt ở trạng thái bận sau lỗi");
  });
  await test("bấm 'Kiểm tra' khi đang tự tải ngầm: không chạy kiểm tra thứ hai, nhưng từ giờ hiện tiến độ", async () => {
    reset();
    let release; updater.behaviour = () => new Promise(r => { release = r; });
    const p = invoke("updater:check");                      // chu kỳ đang bận (đang chờ)
    updater.emit("checking-for-update");
    await invoke("updater:check");                          // bấm lần nữa
    assert.strictEqual(updater.calls.check, 1);
    updater.emit("download-progress", { percent: 10 });
    assert.strictEqual(last().silent, false);
    release(); await p;
    updater.emit("update-not-available", {});
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
