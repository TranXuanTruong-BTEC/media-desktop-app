import type { TranscribeRequest, TranscribeProgress, TranscribeDone, TranscribeError, TranscribeStatus, TranscribePickResult, TranscribeActionResult, DownloadRequest, DownloadProgress, DownloadComplete, DownloadError, CookiesStatus, CookiesResult, CookieBrowser, CookieSite } from "../../shared/ipc-types";

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
      loginCookies:     (site: CookieSite) => Promise<CookiesResult>;
      pickTranscribeFile:  () => Promise<TranscribePickResult>;
      getTranscribeStatus: () => Promise<TranscribeStatus | null>;
      startTranscribe:     (req: TranscribeRequest) => Promise<TranscribeActionResult>;
      cancelTranscribe:    (id: string) => void;
      saveTranscribeSrt:   (id: string) => Promise<TranscribeActionResult>;
      copyTranscribeText:  (id: string) => Promise<TranscribeActionResult>;
      onTranscribeProgress: (cb: (p: TranscribeProgress) => void) => () => void;
      onTranscribeDone:     (cb: (d: TranscribeDone) => void) => () => void;
      onTranscribeError:    (cb: (e: TranscribeError) => void) => () => void;
      winMinimize: () => void;
      winMaximize: () => void;
      winClose:    () => void;
    };
  }
}
