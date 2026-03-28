import type { DownloadRequest, DownloadProgress, DownloadComplete, DownloadError } from "../../shared/ipc-types";

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
      winMinimize: () => void;
      winMaximize: () => void;
      winClose:    () => void;
    };
  }
}
