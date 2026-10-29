// src/main/core/douyin-extract.ts
// Lấy dữ liệu video Douyin bằng cửa sổ Chromium của app (dùng phiên đã đăng nhập ở "Cookies đăng nhập").
// Trang Douyin tự ký các request API của nó, nên ta chỉ cần bắt phản hồi của chính trang thay vì tự gọi API.
import { BrowserWindow, session } from "electron";
import { DouyinMedia, UserFacingError, parseAwemeDetail, extractAwemeId } from "./douyin.js";
import { PARTITION, chromeUserAgent, configureLoginSession } from "./cookie-login.js";
import { logger } from "./logger.js";

const DETAIL_RE = /\/aweme\/v1\/web\/aweme\/detail\//;
const HIDDEN_MS  = 20_000;     // thử ngầm trước
const VISIBLE_MS = 120_000;    // không được thì hiện cửa sổ để người dùng xác minh (captcha) rồi chờ thêm
const POLL_MS    = 2_500;      // dự phòng: đọc dữ liệu nhúng sẵn trong trang

export interface ExtractHandle {
  promise: Promise<DouyinMedia>;
  cancel: () => void;
}

function isHttps(u: string): boolean {
  try { return new URL(u).protocol === "https:"; } catch { return false; }
}

const NEED_LOGIN =
  "Douyin không trả về dữ liệu video (có thể cần đăng nhập hoặc xác minh). " +
  "Vào Cài đặt → Cookies đăng nhập → bấm \"Đăng nhập Douyin\", rồi thử tải lại.";

export function extractDouyinMedia(url: string): ExtractHandle {
  let cancelFn: () => void = () => {};

  const promise = new Promise<DouyinMedia>((resolve, reject) => {
    const ua = chromeUserAgent();
    configureLoginSession(session.fromPartition(PARTITION), ua);

    const win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 720,
      title: "Douyin",
      autoHideMenuBar: true,
      backgroundColor: "#ffffff",
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        backgroundThrottling: false,
      },
    });
    const wc = win.webContents;
    wc.setUserAgent(ua);
    wc.setAudioMuted(true);

    let settled = false;
    let expectedId = extractAwemeId(url);
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    let limitTimer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (hiddenTimer) clearTimeout(hiddenTimer);
      if (limitTimer) clearTimeout(limitTimer);
      if (poll) clearInterval(poll);
      try { if (wc.debugger.isAttached()) wc.debugger.detach(); } catch { /* ignore */ }
      if (!win.isDestroyed()) win.destroy();
      fn();
    };
    const succeed = (m: DouyinMedia) => settle(() => resolve(m));
    const fail = (msg: string) => settle(() => reject(new UserFacingError(msg)));
    cancelFn = () => settle(() => reject(new Error("cancelled")));

    // Chỉ cho phép https; mở tab mới thì nạp ngay trong cửa sổ này
    wc.setWindowOpenHandler(({ url: u }) => {
      if (isHttps(u)) void win.loadURL(u, { userAgent: ua }).catch(() => undefined);
      return { action: "deny" };
    });
    const blockNonHttps = (e: Electron.Event, u: string) => { if (!isHttps(u)) e.preventDefault(); };
    wc.on("will-navigate", blockNonHttps);
    wc.on("will-redirect", blockNonHttps);
    win.on("page-title-updated", e => e.preventDefault());

    // Link rút gọn (v.douyin.com) → biết ID thật sau khi chuyển hướng
    const learnId = (u: string) => { const id = extractAwemeId(u); if (id) expectedId = id; };
    wc.on("did-navigate", (_e, u) => learnId(u));
    wc.on("did-navigate-in-page", (_e, u) => learnId(u));

    // 1) Bắt phản hồi API detail của chính trang (đã được trang ký sẵn)
    const pending = new Set<string>();
    const dbg = wc.debugger;
    try {
      dbg.attach("1.3");
    } catch (err) {
      logger.warn("douyin-extract", "Không gắn được debugger", { err });
      return fail("Không khởi tạo được trình theo dõi mạng của cửa sổ trình duyệt.");
    }
    dbg.on("message", (_e, method: string, params: { requestId?: string; response?: { url?: string } }) => {
      const rid = params?.requestId;
      if (!rid) return;
      if (method === "Network.responseReceived" && DETAIL_RE.test(params.response?.url ?? "")) {
        pending.add(rid);
      } else if (method === "Network.loadingFinished" && pending.has(rid)) {
        pending.delete(rid);
        void (async () => {
          try {
            const r = (await dbg.sendCommand("Network.getResponseBody", { requestId: rid })) as { body: string; base64Encoded: boolean };
            const text = r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body;
            const media = parseAwemeDetail(JSON.parse(text), expectedId ?? undefined);
            if (media) succeed(media);
          } catch { /* phản hồi rỗng / không phải JSON → chờ lượt khác */ }
        })();
      }
    });
    void dbg.sendCommand("Network.enable").catch(() => undefined);

    // 2) Dự phòng: dữ liệu nhúng sẵn trong HTML (RENDER_DATA)
    let polling = false;
    poll = setInterval(async () => {
      if (settled || polling || wc.isLoading()) return;
      polling = true;
      try {
        const raw = (await wc.executeJavaScript(
          "(()=>{const e=document.getElementById('RENDER_DATA');return e?e.textContent:null})()", false,
        )) as string | null;
        if (raw) {
          const media = parseAwemeDetail(JSON.parse(decodeURIComponent(raw)), expectedId ?? undefined);
          if (media) succeed(media);
        }
      } catch { /* chưa có / không đọc được */ }
      polling = false;
    }, POLL_MS);

    // Thử ngầm → không được thì hiện cửa sổ cho người dùng xác minh
    hiddenTimer = setTimeout(() => {
      if (settled) return;
      logger.info("douyin-extract", "Chưa có dữ liệu sau khi thử ngầm, hiện cửa sổ để xác minh");
      win.setTitle("Douyin — hoàn tất xác minh nếu có (cửa sổ sẽ tự đóng)");
      win.show();
      win.focus();
      limitTimer = setTimeout(() => fail(NEED_LOGIN), VISIBLE_MS);
    }, HIDDEN_MS);

    win.on("closed", () => { if (!settled) fail("Bạn đã đóng cửa sổ xác minh của Douyin trước khi hoàn tất."); });

    win.loadURL(url, { userAgent: ua }).catch((err) => {
      logger.warn("douyin-extract", "Không mở được trang", { err: String(err) });
    });
  });

  return { promise, cancel: () => cancelFn() };
}
