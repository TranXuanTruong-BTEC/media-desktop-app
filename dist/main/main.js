import { app, BrowserWindow, ipcMain } from "electron";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
/* ===== FIX __dirname CHO ESM ===== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/* ================================= */
let win = null;
function createWindow() {
    win = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, "../preload/preload.js")
        }
    });
    // dev mode
    win.loadURL("http://localhost:5173");
}
app.whenReady().then(createWindow);
/* ===== IPC DOWNLOAD ===== */
ipcMain.handle("download", async (_event, url) => {
    return new Promise((resolve, reject) => {
        const output = path.join(app.getPath("downloads"), "%(title)s.%(ext)s");
        const yt = spawn("yt-dlp", [
            url,
            "-f",
            "mp4",
            "-o",
            output
        ]);
        yt.stdout.on("data", (data) => {
            console.log(data.toString());
        });
        yt.stderr.on("data", (data) => {
            console.error(data.toString());
        });
        yt.on("close", (code) => {
            if (code === 0) {
                resolve("Download complete");
            }
            else {
                reject("Download failed");
            }
        });
    });
});
