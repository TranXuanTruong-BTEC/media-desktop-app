// src/main/main.ts
import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import { registerDownloadHandlers } from "./ipc/download.js";
import { registerUpdaterHandlers }  from "./ipc/updater.js";

const isDev = !app.isPackaged;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 620,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    backgroundColor: "#0f1117",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "../../dist/renderer/index.html"));
  }

  return win;
}

function registerAppHandlers(win: BrowserWindow) {
  ipcMain.handle("app:getDefaultDir", () => app.getPath("downloads"));
  ipcMain.handle("app:getVersion",    () => app.getVersion());
  ipcMain.handle("app:openPath", async (_evt: unknown, filePath: string) => {
    await shell.showItemInFolder(filePath);
  });

  // Custom window controls
  ipcMain.on("win:minimize", () => win.minimize());
  ipcMain.on("win:maximize", () => win.isMaximized() ? win.unmaximize() : win.maximize());
  ipcMain.on("win:close",    () => win.close());
}

app.whenReady().then(() => {
  const win = createWindow();
  registerDownloadHandlers(win);
  registerUpdaterHandlers(win);
  registerAppHandlers(win);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
