// Generates the PWA icons without any image library: a blue rounded square
// with a white house shape. Run with `npm run icons`.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const BLUE = [29, 78, 216, 255], WHITE = [255, 255, 255, 255], CLEAR = [0, 0, 0, 0];
function house(u, v, bgTransparentCorners) {
  // rounded square background
  const r = 0.18, cx = Math.min(Math.max(u, r), 1 - r), cy = Math.min(Math.max(v, r), 1 - r);
  const inside = (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
  if (!inside) return bgTransparentCorners ? CLEAR : BLUE;
  // roof: triangle from (0.5,0.24) to (0.2,0.5)-(0.8,0.5); body: rect 0.28..0.72 x 0.5..0.76; door
  const roof = v >= 0.24 && v <= 0.5 && Math.abs(u - 0.5) <= (v - 0.24) * (0.3 / 0.26);
  const body = u >= 0.28 && u <= 0.72 && v >= 0.5 && v <= 0.76;
  const door = u >= 0.44 && u <= 0.56 && v >= 0.58 && v <= 0.76;
  if (door) return BLUE;
  return roof || body ? WHITE : BLUE;
}
mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, (u, v) => house(u, v, true)));
writeFileSync("public/icons/icon-512.png", png(512, (u, v) => house(u, v, false)));
writeFileSync("public/icons/apple-touch-icon.png", png(180, (u, v) => house(u, v, false)));
console.log("icons written");
