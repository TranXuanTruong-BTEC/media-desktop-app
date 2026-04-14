import { ipcMain, BrowserWindow, dialog } from "electron";
import { IPC, DownloadRequest } from "../../shared/ipc-types.js";
import { startDownload } from "../core/downloader.js";

const activeCancels = new Map<string, () => void>();

const send = {
  progress:  (win: BrowserWindow, p: unknown) =>
    !win.isDestroyed() && win.webContents.send(IPC.DOWNLOAD_PROGRESS, p),
  complete:  (win: BrowserWindow, c: unknown) =>
    !win.isDestroyed() && win.webContents.send(IPC.DOWNLOAD_COMPLETE, c),
  error:     (win: BrowserWindow, e: unknown) =>
    !win.isDestroyed() && win.webContents.send(IPC.DOWNLOAD_ERROR, e),
  retrying:  (win: BrowserWindow, r: unknown) =>
    !win.isDestroyed() && win.webContents.send(IPC.DOWNLOAD_RETRYING, r),
};

export function registerDownloadHandlers(win: BrowserWindow) {
  ipcMain.handle(IPC.SELECT_DIR, async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.on(IPC.DOWNLOAD_START, (_evt: unknown, req: DownloadRequest) => {
    const { emitter, cancel } = startDownload(req);
    activeCancels.set(req.id, cancel);

    emitter.on("progress",  p => send.progress(win, p));
    emitter.on("retrying",  r => send.retrying(win, r));
    emitter.on("complete",  c => { activeCancels.delete(req.id); send.complete(win, c); });
    emitter.on("error",     e => { activeCancels.delete(req.id); send.error(win, e); });
  });

  ipcMain.on(IPC.DOWNLOAD_CANCEL, (_evt: unknown, id: string) => {
    activeCancels.get(id)?.();
    activeCancels.delete(id);
  });
}
