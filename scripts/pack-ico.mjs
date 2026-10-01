import fs from "fs";
import path from "path";

const tmp = path.join(process.env.TEMP || "/tmp", "mda-icons");
const dest = path.resolve("build/icon.ico");
const sizes = [256, 64, 48, 32, 16];
const images = sizes.map((size) => ({
  size,
  data: fs.readFileSync(path.join(tmp, `icon-${size}.png`)),
}));

const count = images.length;
let offset = 6 + count * 16;
const parts = [];
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(count, 4);
parts.push(header);

const blobs = [];
for (const img of images) {
  const w = img.size >= 256 ? 0 : img.size;
  const h = img.size >= 256 ? 0 : img.size;
  const buf = Buffer.alloc(16);
  buf.writeUInt8(w, 0);
  buf.writeUInt8(h, 1);
  buf.writeUInt8(0, 2);
  buf.writeUInt8(0, 3);
  buf.writeUInt16LE(1, 4);
  buf.writeUInt16LE(32, 6);
  buf.writeUInt32LE(img.data.length, 8);
  buf.writeUInt32LE(offset, 12);
  parts.push(buf);
  blobs.push(img.data);
  offset += img.data.length;
}

fs.writeFileSync(dest, Buffer.concat([...parts, ...blobs]));
console.log("ICO bytes", fs.statSync(dest).size, "sizes", sizes.join(","));
