// src/main/ipc/bgremove.ts — IPC cho "Tách nền ảnh" (AI chạy hoàn toàn trên máy bạn).
// Giao diện không biết đường dẫn file: ảnh được mở bằng hộp thoại (hoặc kéo-thả, đã kiểm tra ở main) và trả về TOKEN;
// kết quả nằm ở thư mục tạm do main giữ, lưu/sao chép chỉ gửi token nên renderer không cần (và không thể) chỉ định đường dẫn tuỳ ý.
import { ipcMain, BrowserWindow, dialog, app, clipboard, ClipboardItem } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import {
  IPC, BgImage, BgInfo, BgPickResult, BgStartRequest, BgActionResult, BgModelId,
} from "../../shared/ipc-types.js";
import { findFfmpeg } from "../core/downloader.js";
import { isValidId } from "../core/security.js";
import { UserFacingError } from "../core/douyin.js";
import { logger } from "../core/logger.js";
import { isTrustedSender } from "./guard.js";
import { BG_MODELS, BG_ORDER, isBgModelId, isBgModelInstalled, bgModelPath, ensureBgModel } from "../core/bg-models.js";
import { createOrtSession, isOrtAvailable, OrtMaskSession } from "../core/bg-session.js";
import {
  removeBackground, makePreviewPng, validateBackground, isImageFile, IMAGE_EXT_LIST, MAX_IMAGE_FILE_BYTES,
} from "../core/bgremove.js";

const MAX_PICKED = 300;          // token đang nhớ
const MAX_PER_PICK = 100;        // số ảnh tối đa mỗi lần chọn/kéo thả
const MAX_JOBS = 2;              // số lượt xử lý được giữ kết quả

const picked = new Map<string, { path: string; name: string; size: number }>();
const jobs = new Map<string, { dir: string; items: Map<string, { name: string; origPath: string; png: string }> }>();
const downloads = new Map<BgModelId, AbortController>();
let active: { id: string; cancel: () => void } | null = null;
let cached: { id: BgModelId; session: OrtMaskSession } | null = null;

const baseDir = () => path.join(app.getPath("userData"), "bgremove");
const jobsRoot = () => path.join(baseDir(), "jobs");

function remember<K, V>(map: Map<K, V>, key: K, value: V, max: number) {
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value as K);
}
const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;
const stem = (name: string) => name.replace(/\.[^.]+$/, "") || "anh";
const cleanName = (s: string) => s.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "anh";

/** Huỷ mọi việc đang chạy (gọi khi thoát app). */
export function cancelActiveBgRemove(): void {
  try { active?.cancel(); } catch { /* ignore */ }
  active = null;
  for (const c of downloads.values()) { try { c.abort(); } catch { /* ignore */ } }
}

async function getSession(id: BgModelId): Promise<OrtMaskSession> {
  if (cached?.id === id) return cached.session;
  if (cached) { await cached.session.release(); cached = null; }      // chỉ giữ 1 mô hình trong RAM
  const session = await createOrtSession(bgModelPath(baseDir(), id), Math.max(2, Math.min(8, os.cpus().length - 1)));
  cached = { id, session };
  return session;
}

function dropJob(id: string) {
  const j = jobs.get(id);
  if (j) { try { fs.rmSync(j.dir, { recursive: true, force: true }); } catch { /* ignore */ } jobs.delete(id); }
}

export function registerBgRemoveHandlers(win: BrowserWindow) {
  try { fs.rmSync(jobsRoot(), { recursive: true, force: true }); } catch { /* ignore */ }      // dọn thư mục tạm của lần chạy trước
  const send = (channel: string, payload: unknown) => { if (!win.isDestroyed()) win.webContents.send(channel, payload); };
  const setTaskbar = (v: number) => { if (!win.isDestroyed()) win.setProgressBar(v); };

  /** Kiểm tra từng đường dẫn, cấp token, tạo ảnh thu nhỏ. */
  async function register(paths: string[]): Promise<BgPickResult> {
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) return { ok: false, error: "Không tìm thấy ffmpeg.exe." };
    const images: BgImage[] = [];
    let skipped = 0;
    for (const p of paths.slice(0, MAX_PER_PICK)) {
      try {
        if (!isImageFile(p) || !path.isAbsolute(p)) { skipped++; continue; }
        const st = fs.statSync(p);
        if (!st.isFile() || st.size === 0 || st.size > MAX_IMAGE_FILE_BYTES) { skipped++; continue; }
        const thumb = await makePreviewPng(p, 192, { ffmpeg });
        const token = crypto.randomBytes(8).toString("hex");
        remember(picked, token, { path: p, name: path.basename(p), size: st.size }, MAX_PICKED);
        images.push({ token, name: path.basename(p), sizeBytes: st.size, thumb: dataUrl(thumb) });
      } catch { skipped++; }                                    // file hỏng/không đọc được → bỏ qua, không làm hỏng cả lô
    }
    skipped += Math.max(0, paths.length - MAX_PER_PICK);
    if (!images.length) return { ok: false, error: "Không có ảnh hợp lệ nào (hỗ trợ PNG, JPG, WebP, BMP, GIF, TIFF)." };
    return { ok: true, images, skipped };
  }

  ipcMain.handle(IPC.BG_INFO, (evt): BgInfo | null => {
    if (!isTrustedSender(evt, win, IPC.BG_INFO)) return null;
    return {
      ffmpegFound: !!findFfmpeg(), runtimeOk: isOrtAvailable(),
      models: BG_ORDER.map(id => ({ id, label: BG_MODELS[id].label, desc: BG_MODELS[id].desc, sizeMb: BG_MODELS[id].sizeMb, installed: isBgModelInstalled(baseDir(), id) })),
    };
  });

  ipcMain.handle(IPC.BG_PICK, async (evt): Promise<BgPickResult> => {
    if (!isTrustedSender(evt, win, IPC.BG_PICK)) return { ok: false, error: "Yêu cầu bị từ chối." };
    const r = await dialog.showOpenDialog(win, {
      title: "Chọn ảnh cần tách nền", properties: ["openFile", "multiSelections"],
      filters: [{ name: "Ảnh", extensions: IMAGE_EXT_LIST }, { name: "Tất cả file", extensions: ["*"] }],
    });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    return register(r.filePaths);
  });

  ipcMain.handle(IPC.BG_ADD_DROPPED, async (evt, paths: unknown): Promise<BgPickResult> => {
    if (!isTrustedSender(evt, win, IPC.BG_ADD_DROPPED)) return { ok: false, error: "Yêu cầu bị từ chối." };
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 500 || !paths.every(p => typeof p === "string")) return { ok: false, error: "Dữ liệu không hợp lệ." };
    return register(paths as string[]);
  });

  ipcMain.handle(IPC.BG_DOWNLOAD_MODEL, async (evt, modelId: unknown): Promise<BgActionResult> => {
    if (!isTrustedSender(evt, win, IPC.BG_DOWNLOAD_MODEL)) return { ok: false, error: "Yêu cầu bị từ chối." };
    if (!isBgModelId(modelId)) return { ok: false, error: "Model không hợp lệ." };
    if (downloads.has(modelId)) return { ok: false, error: "Model này đang được tải." };
    const ac = new AbortController();
    downloads.set(modelId, ac);
    try {
      await ensureBgModel(baseDir(), modelId, { signal: ac.signal, onProgress: (percent, message) => send(IPC.BG_MODEL_PROGRESS, { id: modelId, percent, message }) });
      return { ok: true };
    } catch (e) {
      if (ac.signal.aborted) return { ok: false, canceled: true };
      logger.warn("ipc:bg", "Tải model thất bại", { message: (e as Error).message });
      return { ok: false, error: e instanceof UserFacingError ? e.message : `Tải model thất bại: ${(e as Error).message}` };
    } finally { downloads.delete(modelId); }
  });

  ipcMain.on(IPC.BG_CANCEL_DOWNLOAD, (evt, modelId: unknown) => {
    if (!isTrustedSender(evt, win, IPC.BG_CANCEL_DOWNLOAD) || !isBgModelId(modelId)) return;
    downloads.get(modelId)?.abort();
  });

  ipcMain.handle(IPC.BG_START, (evt, raw: unknown): BgActionResult => {
    if (!isTrustedSender(evt, win, IPC.BG_START)) return { ok: false, error: "Yêu cầu bị từ chối." };
    const r = (raw && typeof raw === "object" ? raw : {}) as Partial<BgStartRequest>;
    const background = validateBackground(r.background);
    if (!isValidId(r.id) || !isBgModelId(r.model) || !background || typeof r.refine !== "boolean"
        || !Array.isArray(r.tokens) || r.tokens.length === 0 || r.tokens.length > MAX_PER_PICK || !r.tokens.every(t => typeof t === "string")) {
      return { ok: false, error: "Yêu cầu không hợp lệ." };
    }
    if (active) return { ok: false, error: "Đang xử lý một lô ảnh khác. Hãy đợi xong hoặc huỷ." };
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) return { ok: false, error: "Không tìm thấy ffmpeg.exe." };
    if (!isOrtAvailable()) return { ok: false, error: "Thiếu bộ chạy AI (onnxruntime). Hãy cài lại MediaGet." };
    if (!isBgModelInstalled(baseDir(), r.model)) return { ok: false, error: `Chưa tải model "${BG_MODELS[r.model].label}". Hãy bấm "Tải model" trước.` };
    const items = (r.tokens as string[]).map(t => ({ token: t, f: picked.get(t) })).filter((x): x is { token: string; f: { path: string; name: string; size: number } } => !!x.f);
    if (!items.length) return { ok: false, error: "Các ảnh đã chọn không còn hợp lệ. Hãy chọn lại ảnh." };

    const id = r.id, model = BG_MODELS[r.model];
    const ac = new AbortController();
    active = { id, cancel: () => ac.abort() };
    while (jobs.size >= MAX_JOBS) dropJob(jobs.keys().next().value as string);
    const dir = path.join(jobsRoot(), id);
    fs.mkdirSync(dir, { recursive: true });
    const job = { dir, items: new Map<string, { name: string; origPath: string; png: string }>() };
    jobs.set(id, job);
    logger.info("ipc:bg", "Bắt đầu tách nền", { model: model.id, count: items.length, background: background.type });

    void (async () => {
      let ok = 0, failed = 0;
      try {
        const session = await getSession(model.id);
        for (let index = 0; index < items.length; index++) {
          if (ac.signal.aborted) break;
          const { token, f } = items[index];
          const total = items.length;
          const stageBase: Record<string, number> = { decode: 0, analyze: 0.15, compose: 0.8, save: 0.9 };
          const emit = (stage: string, message: string) => {
            const pct = ((index + (stageBase[stage] ?? 0)) / total) * 100;
            setTaskbar(Math.min(1, pct / 100));
            send(IPC.BG_PROGRESS, { id, index, total, name: f.name, percent: Math.round(pct * 10) / 10, message });
          };
          emit("decode", "Đang đọc ảnh...");
          const out = path.join(dir, `${token}.png`);
          const t0 = Date.now();
          try {
            const res = await removeBackground(f.path, out, { model, background, refine: r.refine as boolean }, {
              ffmpeg, session, signal: ac.signal,
              onStage: (s) => emit(s, s === "analyze" ? "AI đang tách nền..." : s === "compose" ? "Đang ghép kết quả..." : s === "save" ? "Đang lưu..." : "Đang đọc ảnh..."),
            });
            const preview = await makePreviewPng(out, 640, { ffmpeg, signal: ac.signal });
            job.items.set(token, { name: f.name, origPath: f.path, png: out });
            ok++;
            send(IPC.BG_ITEM_DONE, { id, index, token, name: f.name, width: res.width, height: res.height, ms: Date.now() - t0, preview: dataUrl(preview), hasAlpha: res.hasAlpha });
          } catch (e) {
            if (ac.signal.aborted) break;
            failed++;
            logger.warn("ipc:bg", "Một ảnh thất bại", { message: (e as Error).message });
            send(IPC.BG_ITEM_ERROR, { id, index, token, name: f.name, message: e instanceof UserFacingError ? e.message : `Lỗi: ${(e as Error).message}` });
          }
        }
      } catch (e) {
        // lỗi nạp mô hình → mọi ảnh còn lại đều thất bại với cùng lý do
        const msg = e instanceof UserFacingError ? e.message : `Lỗi: ${(e as Error).message}`;
        logger.error("ipc:bg", "Không chạy được mô hình", { message: (e as Error).message });
        items.forEach(({ token, f }, index) => { if (!job.items.has(token)) { failed++; send(IPC.BG_ITEM_ERROR, { id, index, token, name: f.name, message: msg }); } });
      } finally {
        if (active?.id === id) active = null;
        setTaskbar(-1);
        send(IPC.BG_DONE, { id, ok, failed, cancelled: ac.signal.aborted });
      }
    })();
    return { ok: true };
  });

  ipcMain.on(IPC.BG_CANCEL, (evt, id: unknown) => {
    if (!isTrustedSender(evt, win, IPC.BG_CANCEL) || !isValidId(id)) return;
    if (active?.id === id) active.cancel();
  });

  const find = (id: unknown, token: unknown) => (isValidId(id) && typeof token === "string" ? jobs.get(id)?.items.get(token) : undefined);
  const outName = (name: string, bgType?: string) => `${cleanName(stem(name))}-${bgType === "mask" ? "mask" : "nobg"}.png`;

  ipcMain.handle(IPC.BG_SAVE, async (evt, id: unknown, token: unknown): Promise<BgActionResult> => {
    if (!isTrustedSender(evt, win, IPC.BG_SAVE)) return { ok: false, error: "Yêu cầu bị từ chối." };
    const it = find(id, token);
    if (!it || !fs.existsSync(it.png)) return { ok: false, error: "Không còn kết quả này. Hãy tách nền lại." };
    const r = await dialog.showSaveDialog(win, { title: "Lưu ảnh đã tách nền", defaultPath: path.join(path.dirname(it.origPath), outName(it.name)), filters: [{ name: "Ảnh PNG", extensions: ["png"] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try { fs.copyFileSync(it.png, r.filePath); return { ok: true, path: r.filePath }; }
    catch (e) { logger.error("ipc:bg", "Không ghi được file", e); return { ok: false, error: "Không ghi được file. Hãy chọn thư mục khác." }; }
  });

  ipcMain.handle(IPC.BG_SAVE_ALL, async (evt, id: unknown): Promise<BgActionResult> => {
    if (!isTrustedSender(evt, win, IPC.BG_SAVE_ALL)) return { ok: false, error: "Yêu cầu bị từ chối." };
    const job = isValidId(id) ? jobs.get(id) : undefined;
    if (!job || job.items.size === 0) return { ok: false, error: "Chưa có kết quả nào để lưu." };
    const r = await dialog.showOpenDialog(win, { title: "Chọn thư mục lưu tất cả ảnh", properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    const dir = r.filePaths[0];
    let saved = 0;
    try {
      for (const it of job.items.values()) {
        if (!fs.existsSync(it.png)) continue;
        let dest = path.join(dir, outName(it.name)), n = 2;
        while (fs.existsSync(dest)) dest = path.join(dir, outName(it.name).replace(/\.png$/, ` (${n++}).png`));   // không bao giờ ghi đè file có sẵn
        fs.copyFileSync(it.png, dest); saved++;
      }
      return { ok: true, path: dir, saved };
    } catch (e) { logger.error("ipc:bg", "Không ghi được file", e); return { ok: false, error: `Đã lưu ${saved} ảnh rồi gặp lỗi khi ghi file.`, saved }; }
  });

  ipcMain.handle(IPC.BG_COPY, async (evt, id: unknown, token: unknown): Promise<BgActionResult> => {
    if (!isTrustedSender(evt, win, IPC.BG_COPY)) return { ok: false, error: "Yêu cầu bị từ chối." };
    const it = find(id, token);
    if (!it || !fs.existsSync(it.png)) return { ok: false, error: "Không còn kết quả này." };
    try {
      // Electron 44: clipboard dùng ClipboardItem (PNG giữ nguyên độ trong suốt khi dán vào CapCut/Photoshop/Word...)
      await clipboard.write([new ClipboardItem({ "image/png": new Blob([fs.readFileSync(it.png)], { type: "image/png" }) })]);
      return { ok: true };
    } catch (e) { logger.warn("ipc:bg", "Không sao chép được ảnh", { message: (e as Error).message }); return { ok: false, error: "Không sao chép được ảnh vào clipboard." }; }
  });

  ipcMain.handle(IPC.BG_CLEAR, (evt): BgActionResult => {
    if (!isTrustedSender(evt, win, IPC.BG_CLEAR)) return { ok: false, error: "Yêu cầu bị từ chối." };
    if (active) return { ok: false, error: "Đang xử lý, hãy huỷ trước." };
    for (const id of [...jobs.keys()]) dropJob(id);
    picked.clear();
    return { ok: true };
  });
}
