// src/main/core/cookie-login.ts
// Mở cửa sổ đăng nhập (Chromium thật) cho Douyin/TikTok, chờ người dùng đăng nhập rồi lấy cookies.
// Cửa sổ chạy sandbox, không preload, không Node; chỉ cho phép điều hướng https.
import { BrowserWindow, session } from "electron";
import { COOKIE_SITES, CookieSiteKey, BrowserCookie, isLoggedIn } from "./cookies.js";
import { logger } from "./logger.js";

const PARTITION = "persist:cookie-login";
const POLL_MS = 1500;
const SETTLE_MS = 4000;                 // sau khi thấy đăng nhập, chờ trang sinh cookie "tươi" rồi mới lấy
const MAX_WAIT_MS = 10 * 60 * 1000;     // tối đa 10 phút

export interface LoginOutcome {
  cookies: BrowserCookie[];
  loggedIn: boolean;
  userAgent: string;
}

/** UA Chrome "sạch" (không có chữ Electron/tên app) — cũng là UA sẽ gửi cho yt-dlp để khớp với cookies. */
export function chromeUserAgent(): string {
  const major = (process.versions.chrome || "130").split(".")[0];
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

let loginOpen = false;

function isHttps(u: string): boolean {
  try { return new URL(u).protocol === "https:"; } catch { return false; }
}

export function runCookieLogin(parent: BrowserWindow, siteKey: CookieSiteKey): Promise<LoginOutcome> {
  if (loginOpen) return Promise.reject(new Error("login-window-open"));
  loginOpen = true;

  const site = COOKIE_SITES[siteKey];
  const ua = chromeUserAgent();
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(ua);
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);

  const win = new BrowserWindow({
    parent,
    modal: true,
    width: 1000,
    height: 720,
    title: site.title,
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
    },
  });

  win.webContents.setUserAgent(ua);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttps(url)) void win.loadURL(url, { userAgent: ua }).catch(() => undefined);
    return { action: "deny" };
  });
  const blockNonHttps = (e: Electron.Event, url: string) => { if (!isHttps(url)) e.preventDefault(); };
  win.webContents.on("will-navigate", blockNonHttps);
  win.webContents.on("will-redirect", blockNonHttps);
  win.on("page-title-updated", e => e.preventDefault());   // giữ tiêu đề do app đặt

  return new Promise<LoginOutcome>((resolve) => {
    let done = false;
    let loggedInSince = 0;
    const getAll = async (): Promise<BrowserCookie[]> => (await ses.cookies.get({})) as BrowserCookie[];

    const finish = async () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(limit);
      let cookies: BrowserCookie[] = [];
      try { cookies = await getAll(); } catch (err) { logger.warn("cookie-login", "Không đọc được cookies", { err }); }
      const outcome = { cookies, loggedIn: isLoggedIn(cookies, site.domains), userAgent: ua };
      if (!win.isDestroyed()) win.destroy();
      resolve(outcome);
    };

    const poll = setInterval(async () => {
      if (done) return;
      try {
        if (isLoggedIn(await getAll(), site.domains)) {
          if (!loggedInSince) loggedInSince = Date.now();
          else if (Date.now() - loggedInSince >= SETTLE_MS) void finish();
        } else {
          loggedInSince = 0;
        }
      } catch { /* bỏ qua, thử lại lượt sau */ }
    }, POLL_MS);
    const limit = setTimeout(() => void finish(), MAX_WAIT_MS);

    // Người dùng tự đóng cửa sổ → vẫn lưu những gì đã có
    win.on("close", (e) => { if (!done) { e.preventDefault(); void finish(); } });
    win.on("closed", () => { loginOpen = false; });

    win.loadURL(site.url, { userAgent: ua }).catch((err) => logger.warn("cookie-login", "Không mở được trang", { err }));
  });
}

/** Xoá phiên đăng nhập đã lưu trong cửa sổ (dùng khi người dùng bấm "Xoá cookies"). */
export async function clearLoginSession(): Promise<void> {
  try { await session.fromPartition(PARTITION).clearStorageData(); }
  catch (err) { logger.warn("cookie-login", "Không xoá được phiên đăng nhập", { err }); }
}
