import type { DownloadRequest, DownloadProgress, DownloadComplete, DownloadError, CookiesStatus, CookiesResult, CookieBrowser } from "../../shared/ipc-types";

declare global {
  interface Window {
    api: {
      startDownload:   (req: DownloadRequest) => void;
      cancelDownload:  (id: string) => void;
      selectOutputDir: () => Promise<string | null>;
      getDefaultDir:   () => Promise<string>;
      openPath:        (p: string) => Promise<void>;
      onProgress: (cb: (p: DownloadProgress) => void) => () => void;
      onComplete: (cb: (c: DownloadComplete) => void) => () => void;
      onError:    (cb: (e: DownloadError)    => void) => () => void;
      getCookiesStatus: () => Promise<CookiesStatus | null>;
      saveCookies:      (text: string) => Promise<CookiesResult>;
      importCookies:    () => Promise<CookiesResult>;
      clearCookies:     () => Promise<CookiesResult>;
      setCookieBrowser: (b: CookieBrowser) => Promise<CookiesResult>;
      winMinimize: () => void;
      winMaximize: () => void;
      winClose:    () => void;
    };
  }
}
