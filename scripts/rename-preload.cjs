const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "..", "dist", "main", "preload.js");
const out = path.join(__dirname, "..", "dist", "main", "preload.cjs");
if (fs.existsSync(p)) {
  fs.renameSync(p, out);
  console.log("Renamed preload.js -> preload.cjs");
}
