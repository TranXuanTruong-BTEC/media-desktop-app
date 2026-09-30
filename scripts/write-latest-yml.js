#!/usr/bin/env node
/**
 * Ghi latest.yml (UTF-8 không BOM) từ đúng file installer vừa build.
 * PowerShell Set-Content -Encoding utf8 trên Windows thêm BOM → electron-updater
 * parse YAML thất bại, nên auto-update không chạy.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const releaseDir = path.join(__dirname, "..", "release");
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

function findInstaller() {
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`Không có thư mục release/: ${releaseDir}`);
  }
  const names = fs.readdirSync(releaseDir).filter((n) => /^MediaGet-Setup.*\.exe$/i.test(n) && !n.endsWith(".blockmap"));
  if (names.length === 0) {
    throw new Error("Không tìm thấy MediaGet-Setup*.exe trong release/");
  }
  names.sort((a, b) => fs.statSync(path.join(releaseDir, b)).mtimeMs - fs.statSync(path.join(releaseDir, a)).mtimeMs);
  return path.join(releaseDir, names[0]);
}

const exePath = process.argv[2] ? path.resolve(process.argv[2]) : findInstaller();
const exe = fs.statSync(exePath);
const buf = fs.readFileSync(exePath);
const sha512 = crypto.createHash("sha512").update(buf).digest("base64");
const fileName = path.basename(exePath);
const date = new Date().toISOString();

if (!/^\d+\.\d+\.\d+/.test(pkg.version)) {
  throw new Error(`package.json version không hợp lệ: ${pkg.version}`);
}

const yml =
  [
    `version: ${pkg.version}`,
    `files:`,
    `  - url: ${fileName}`,
    `    sha512: ${sha512}`,
    `    size: ${exe.size}`,
    `path: ${fileName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${date}'`,
    ``,
  ].join("\n");

const out = path.join(releaseDir, "latest.yml");
fs.writeFileSync(out, Buffer.from(yml, "utf8"));

const written = fs.readFileSync(out);
if (written[0] === 0xef && written[1] === 0xbb && written[2] === 0xbf) {
  throw new Error("latest.yml bị ghi kèm UTF-8 BOM");
}

console.log(`[write-latest-yml] ${fileName} (${exe.size} bytes)`);
console.log(yml);
