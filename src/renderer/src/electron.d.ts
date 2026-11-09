import type { BgInfo, BgPickResult, BgStartRequest, BgActionResult, BgModelId, BgModelProgress, BgProgress, BgItemDone, BgItemError, BgDone, LlmSettingsView, LlmSettingsSave, LlmResult, TranscribeRequest, TranscribeProgress, TranscribeDone, TranscribeError, TranscribeStatus, TranscribePickResult, TranscribeActionResult, DownloadRequest, DownloadProgress, DownloadComplete, DownloadError, CookiesStatus, CookiesResult, CookieBrowser, CookieSite } from "../../shared/ipc-types";

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
      getLlmSettings:      () => Promise<LlmSettingsView | null>;
      saveLlmSettings:     (req: LlmSettingsSave) => Promise<LlmResult>;
      testLlm:             () => Promise<LlmResult>;
      getPathForFile:      (f: File) => string;
      getBgInfo:           () => Promise<BgInfo | null>;
      pickBgImages:        () => Promise<BgPickResult>;
      addDroppedBgImages:  (paths: string[]) => Promise<BgPickResult>;
      downloadBgModel:     (id: BgModelId) => Promise<BgActionResult>;
      cancelBgModelDownload: (id: BgModelId) => void;
      startBg:             (req: BgStartRequest) => Promise<BgActionResult>;
      cancelBg:            (id: string) => void;
      saveBgImage:         (id: string, token: string) => Promise<BgActionResult>;
      saveAllBg:           (id: string) => Promise<BgActionResult>;
      copyBgImage:         (id: string, token: string) => Promise<BgActionResult>;
      clearBg:             () => Promise<BgActionResult>;
      onBgModelProgress:   (cb: (p: BgModelProgress) => void) => () => void;
      onBgProgress:        (cb: (p: BgProgress) => void) => () => void;
      onBgItemDone:        (cb: (p: BgItemDone) => void) => () => void;
      onBgItemError:       (cb: (p: BgItemError) => void) => () => void;
      onBgDone:            (cb: (p: BgDone) => void) => () => void;
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
