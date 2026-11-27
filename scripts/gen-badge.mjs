// 產生推播通知的小圖示（Android 通知列用的 badge）：public/icons/badge-96.png
// Android 只看這張圖的透明度（輪廓），彩色的 App 圖示會變成一整塊白色方塊，所以要一張「白色圖形＋透明背景」的圖。
// 圖形跟 App 圖示一樣是三條長短不同的額度條；不需要任何套件，自己用 zlib 編 PNG。
// 用法：node scripts/gen-badge.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SIZE = 96;
const OUT = fileURLToPath(new URL('../public/icons/badge-96.png', import.meta.url));

// 以 100×100 為座標（跟 public/icons/icon.svg 一樣），三條圓頭的線：[x1, x2, y]，粗 14
const BARS = [[22, 78, 26], [22, 64, 50], [22, 46, 74]];
const RADIUS = 7;

/** 點到線段的距離（線段是水平的） */
function distToBar(x, y, [x1, x2, by]) {
  const cx = Math.min(Math.max(x, x1), x2);
  return Math.hypot(x - cx, y - by);
}

const scale = 100 / SIZE;
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let py = 0; py < SIZE; py++) {
  const row = py * (SIZE * 4 + 1);
  raw[row] = 0; // filter: none
  for (let px = 0; px < SIZE; px++) {
    // 像素中心換到 100×100 座標；邊緣用距離做反鋸齒
    const x = (px + 0.5) * scale;
    const y = (py + 0.5) * scale;
    const d = Math.min(...BARS.map((b) => distToBar(x, y, b)));
    const alpha = Math.min(1, Math.max(0, (RADIUS - d) / scale + 0.5));
    const o = row + 1 + px * 4;
    raw[o] = 255;
    raw[o + 1] = 255;
    raw[o + 2] = 255;
    raw[o + 3] = Math.round(alpha * 255);
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(OUT, png);
console.log(`已產生 ${OUT}（${png.length} bytes）`);
