// src/main/core/http-download.ts
// Tải một file qua http(s) bằng Node thuần: theo chuyển hướng (có giới hạn), kiểm tra từng chặng, báo tiến trình,
// huỷ được, không để lại file dở. Dùng chung cho tải video Douyin và tải công cụ/mô hình nhận diện giọng nói.
import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import { isSafeMediaUrl } from "./douyin.js";

/** Đổi lỗi mạng thô của Node (aborted, ECONNRESET, ENOTFOUND...) thành thông báo dễ hiểu. */
export function friendlyNetError(e: Error): Error {
  const m = e.message || "";
  if (/cancelled|Hết thời gian|Kết nối bị ngắt|Link tải|HTTP \d+|chuyển hướng|không trả về video|đủ dung lượng/i.test(m)) return e;
  if (/aborted|hang up|ECONNRESET|EPIPE|premature/i.test(m)) return new Error("Kết nối bị ngắt giữa chừng.");
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return new Error("Không phân giải được tên miền máy chủ video (kiểm tra mạng).");
  if (/ECONNREFUSED|ENETUNREACH|EHOSTUNREACH/i.test(m)) return new Error("Không kết nối được tới máy chủ video.");
  if (/ETIMEDOUT/i.test(m)) return new Error("Hết thời gian chờ kết nối.");
  return new Error(`Lỗi mạng: ${m}`);
}

export interface DownloadFileOptions {
  headers: Record<string, string>;
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
  maxRedirects?: number;
  idleMs?: number;
  allowPrivate?: boolean;   // chỉ dùng trong test (server localhost)
  allowHost?: (hostname: string) => boolean;   // kiểm tra MỌI chặng (kể cả chuyển hướng); mặc định cho phép mọi host công cộng
}

export function downloadToFile(url: string, dest: string, o: DownloadFileOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let redirects = 0;
    let req: http.ClientRequest | null = null;
    let out: fs.WriteStream | null = null;

    const onAbort = () => fail(new Error("cancelled"));
    const cleanup = () => {
      o.signal.removeEventListener("abort", onAbort);
      req?.destroy();
      out?.destroy();
      try { fs.rmSync(dest, { force: true }); } catch { /* ignore */ }
    };
    const fail = (e: Error) => { if (settled) return; settled = true; cleanup(); reject(friendlyNetError(e)); };

    if (o.signal.aborted) return fail(new Error("cancelled"));
    o.signal.addEventListener("abort", onAbort);

    const go = (u: string) => {
      if (!o.allowPrivate && !isSafeMediaUrl(u)) return fail(new Error("Link tải không hợp lệ."));
      if (o.allowHost) {
        let host = "";
        try { host = new URL(u).hostname.toLowerCase(); } catch { /* để rỗng */ }
        if (!o.allowHost(host)) return fail(new Error("Link tải không hợp lệ (máy chủ không nằm trong danh sách cho phép)."));
      }
      const lib = u.startsWith("https:") ? https : http;
      req = lib.get(u, { headers: o.headers }, (res) => {
        const code = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
          res.resume();
          if (++redirects > (o.maxRedirects ?? 5)) return fail(new Error("Quá nhiều lần chuyển hướng."));
          let next: string;
          try { next = new URL(res.headers.location, u).toString(); } catch { return fail(new Error("Chuyển hướng không hợp lệ.")); }
          return go(next);
        }
        if (code !== 200 && code !== 206) { res.resume(); return fail(new Error(`Máy chủ trả về HTTP ${code}`)); }

        const ct = String(res.headers["content-type"] ?? "").toLowerCase();
        if (ct.startsWith("text/") || ct.includes("json") || ct.includes("html")) {
          res.resume();
          return fail(new Error("Máy chủ không trả về video (link có thể đã hết hạn)."));
        }

        const total = Number(res.headers["content-length"]) || 0;
        let done = 0;
        out = fs.createWriteStream(dest);
        res.on("data", (b: Buffer) => { done += b.length; o.onProgress(done, total); });
        res.on("error", fail);
        res.on("close", () => { if (!res.complete) fail(new Error("Kết nối bị ngắt giữa chừng.")); });
        out.on("error", fail);
        out.on("finish", () => {
          if (settled) return;
          if (total && done < total) return fail(new Error("Tải chưa đủ dung lượng (kết nối bị ngắt)."));
          settled = true;
          o.signal.removeEventListener("abort", onAbort);
          resolve();
        });
        res.pipe(out);
      });
      req.setTimeout(o.idleMs ?? 30000, () => req?.destroy(new Error("Hết thời gian chờ kết nối.")));
      req.on("error", fail);
    };
    go(url);
  });
}

export function uniquePath(dir: string, base: string, ext: string): string {
  let p = path.join(dir, base + ext);
  for (let i = 1; fs.existsSync(p) && i < 1000; i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}
