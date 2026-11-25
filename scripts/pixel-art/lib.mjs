// 像素圖產生器的共用部分：調色盤、文字點陣 → SVG、角色畫布 DSL。
// 輸出資料夾：node scripts/gen-pixel-art.mjs [輸出資料夾，預設 public/pixel]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2] || fileURLToPath(new URL('../../public/pixel/', import.meta.url));
fs.mkdirSync(out, { recursive: true });

export const P = {
  k: '#3a2418', // 描邊
  b: '#3f7fe0', B: '#2b5fb8', // 藍
  s: '#ffd9b0', S: '#f0b98a', // 膚色
  r: '#e0413a', R: '#b02a25', // 紅
  y: '#e8eef8', Y: '#aab6c8', // 劍刃
  g: '#7ad35a', G: '#4fa83a', H: '#2f7a26', // 綠
  w: '#ffffff', W: '#d6ecff',
  o: '#ffa64d', O: '#e07b1f', // 橘
  p: '#ff8fb8', P: '#e0608f', // 粉
  t: '#8a5a33', T: '#5e3a1f', // 樹幹／木頭
  c: '#fff3d6', C: '#e8d2a6', // 牆
  n: '#ffd23f', // 黃
  m: '#8fb3e6', M: '#7aa0d8', // 遠山的藍
  a: '#f4d993', A: '#dcb867', // 沙灘
  e: '#4fb6f7', E: '#2b8be0', // 海
  v: '#c49bff', V: '#8a4fe8', // 傳送點
  q: '#fff1a8', // 傳送點中心
  z: '#3f8f5a', Z: '#2a6b41', // 松樹
  f: '#a8743f', F: '#7a4f26', // 木板
  i: '#ffc2dc', I: '#f28bb8', j: '#d9638f', // 櫻花
  u: '#ff9a4a', U: '#e0602a', x: '#b8401c', // 楓紅
  l: '#ffd45a', L: '#e8a925', d: '#b97a14', // 金黃
  h: '#d8c25a', N: '#b39a3a', // 秋天的草
};

export function svg(name, frames) {
  const h = frames[0].length, w = frames[0][0].length;
  let rects = '';
  frames.forEach((rows, fi) => {
    if (rows.length !== h) throw new Error(`${name} frame ${fi}: ${rows.length} rows, want ${h}`);
    rows.forEach((row, y) => {
      if (row.length !== w) throw new Error(`${name} f${fi} row ${y}: "${row}" is ${row.length}, want ${w}`);
      let x = 0;
      while (x < w) {
        const ch = row[x];
        if (ch === '.') { x++; continue; }
        if (!P[ch]) throw new Error(`${name}: unknown color ${ch}`);
        let x2 = x; while (x2 < w && row[x2] === ch) x2++;
        rects += `<rect x="${fi * w + x}" y="${y}" width="${x2 - x}" height="1" fill="${P[ch]}"/>`;
        x = x2;
      }
    });
  });
  const W = w * frames.length;
  fs.writeFileSync(path.join(out, `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" shape-rendering="crispEdges">${rects}</svg>\n`);
  console.log(name, `${W}x${h}`);
}

// ---------- 原創高精細角色畫布 DSL（色相偏移立體明暗、分區色描邊、光澤大眼、4 格動畫） ----------
export function makeCanvas(w, h) {
  const grid = Array(w * h).fill(null);
  const inB = (x, y) => x >= 0 && x < w && y >= 0 && y < h;
  const px = (x, y, hex) => {
    if (!hex) return;
    const rx = Math.round(x), ry = Math.round(y);
    if (inB(rx, ry)) grid[ry * w + rx] = hex;
  };
  const get = (x, y) => (inB(x, y) ? grid[y * w + x] : null);
  const rect = (x, y, rw, rh, hex) => {
    for (let dy = 0; dy < rh; dy++) for (let dx = 0; dx < rw; dx++) px(x + dx, y + dy, hex);
  };
  const fill = (fn) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = fn(x, y);
        if (c) grid[y * w + x] = c;
      }
    }
  };
  const ellipseShade = (cx, cy, rx, ry, ramp, opts = {}) => {
    const { lx = -0.4, ly = -0.5, yMin = -Infinity, yMax = Infinity, flatBottom = false } = opts;
    for (let y = 0; y < h; y++) {
      if (y < yMin || y > yMax) continue;
      for (let x = 0; x < w; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const d = Math.hypot(nx, ny);
        if (d > 1) continue;
        const light = nx * lx + ny * ly;
        let col = ramp.base;
        if (light > 0.34 && d < 0.86) col = ramp.hi;
        else if (light < -0.42 || (d > 0.88 && light < 0)) col = ramp.dark;
        else if (light < -0.14 || (d > 0.78 && light < 0.15)) col = ramp.mid;
        if (ramp.bounce && !flatBottom && ny > 0.62 && d > 0.68 && Math.abs(nx) < 0.65) {
          col = ramp.bounce;
        }
        grid[y * w + x] = col;
      }
    }
  };
  const outline = (colorOrFn) => {
    const src = grid.slice();
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (src[y * w + x]) continue;
        let neighbor = null;
        for (const [dx, dy] of dirs) {
          const nx = x + dx, ny = y + dy;
          if (inB(nx, ny) && src[ny * w + nx]) {
            neighbor = src[ny * w + nx];
            break;
          }
        }
        if (neighbor) {
          grid[y * w + x] = typeof colorOrFn === 'function' ? colorOrFn(neighbor, x, y) : colorOrFn;
        }
      }
    }
  };
  const drawEye = (x, y, style, { pupil, shine = '#ffffff' }) => {
    if (style === 'big') {
      rect(x, y, 2, 3, pupil);
      px(x, y, shine);
    } else if (style === 'cute') {
      rect(x, y, 2, 2, pupil);
      px(x, y, shine);
    } else if (style === 'happy') {
      px(x, y + 1, pupil);
      px(x + 1, y, pupil);
      px(x + 2, y + 1, pupil);
    } else if (style === 'blink') {
      px(x, y + 1, pupil);
      px(x + 1, y + 1, pupil);
    }
  };
  const stamp = (ox, oy, rows, pal) => {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const ch = row[dx];
        if (ch !== '.' && pal[ch]) px(ox + dx, oy + dy, pal[ch]);
      }
    });
  };
  return { w, h, grid, px, get, rect, fill, ellipseShade, outline, drawEye, stamp };
}

export function svgFrames(name, canvases) {
  const { w, h } = canvases[0];
  let rects = '';
  canvases.forEach((c, fi) => {
    if (c.w !== w || c.h !== h) throw new Error(`${name} frame ${fi}: ${c.w}x${c.h}, want ${w}x${h}`);
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        const col = c.grid[y * w + x];
        if (!col) { x++; continue; }
        let x2 = x;
        while (x2 < w && c.grid[y * w + x2] === col) x2++;
        rects += `<rect x="${fi * w + x}" y="${y}" width="${x2 - x}" height="1" fill="${col}"/>`;
        x = x2;
      }
    }
  });
  const W = w * canvases.length;
  fs.writeFileSync(path.join(out, `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" shape-rendering="crispEdges">${rects}</svg>\n`);
  console.log(name, `${W}x${h}`);
}
