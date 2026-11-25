// 產生 public/pixel/ 的像素圖（冒險風格的角色與場景）。全部是原創點陣，無外部素材。
// 用法：node scripts/gen-pixel-art.mjs [輸出資料夾，預設 public/pixel]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2] || fileURLToPath(new URL('../public/pixel/', import.meta.url));
fs.mkdirSync(out, { recursive: true });

const P = {
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

function svg(name, frames) {
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
function makeCanvas(w, h) {
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

function svgFrames(name, canvases) {
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

// 1. 星燈小旅人（hero，32x32 × 4 格，向右走動、圍巾飄動、水晶星燈閃爍）
{
  const frames = [0, 1, 2, 3].map((fi) => {
    const c = makeCanvas(32, 32);
    const bob = (fi === 1 || fi === 3) ? -1 : 0;

    // 背後飄動的金琥珀圍巾尾端（先畫，在身體後方）
    const scarfDy = [0, -1, 1, -1][fi];
    c.stamp(3, 17 + bob + scarfDy, [
      '..yyyy....',
      '.yoooooy..',
      'yooOOOooy.',
      '.yOOOOy...',
    ], { y: '#ffe26a', o: '#ffaa33', O: '#d96f1e' });

    // 短褲與雙腳（四格走路步伐，清楚區分褲管與靴子）
    if (fi === 0) {
      c.rect(10, 26, 4, 2, '#3c4c8f'); c.rect(10, 28, 4, 2, '#6b3e26'); c.px(13, 29, '#4a2918'); // 後腳
      c.rect(16, 26, 4, 2, '#3c4c8f'); c.rect(16, 28, 4, 3, '#8c5233'); c.rect(16, 30, 5, 1, '#5e341e'); // 前腳著地
    } else if (fi === 1) {
      c.rect(12, 26, 4, 2, '#3c4c8f'); c.rect(12, 28, 4, 3, '#8c5233'); c.rect(12, 30, 5, 1, '#5e341e'); // 支撐腳
      c.rect(16, 25, 3, 2, '#3c4c8f'); c.rect(16, 27, 4, 2, '#6b3e26'); // 抬起跨步
    } else if (fi === 2) {
      c.rect(10, 26, 4, 2, '#3c4c8f'); c.rect(10, 28, 4, 2, '#6b3e26'); c.px(13, 29, '#4a2918');
      c.rect(17, 26, 4, 2, '#3c4c8f'); c.rect(17, 28, 4, 3, '#8c5233'); c.rect(17, 30, 5, 1, '#5e341e');
    } else {
      c.rect(13, 26, 4, 2, '#3c4c8f'); c.rect(13, 28, 4, 3, '#8c5233'); c.rect(13, 30, 5, 1, '#5e341e');
      c.rect(10, 25, 3, 2, '#3c4c8f'); c.rect(10, 27, 4, 2, '#6b3e26');
    }

    // 靛藍短褲
    c.rect(11, 24 + bob, 8, 3, '#3c4c8f');
    c.rect(11, 26 + bob, 4, 1, '#293469');

    // 象牙白旅人外衣
    c.ellipseShade(15, 21 + bob, 4.5, 3.8, {
      hi: '#fffaf0', base: '#f7eedc', mid: '#e3d3b8', dark: '#c9b496',
    });
    c.rect(11, 23 + bob, 8, 1, '#7a4a2b'); // 皮帶
    c.px(16, 23 + bob, '#ffe26a'); // 金色扣環

    // 奶油桃臉龐
    c.ellipseShade(15.5, 13.5 + bob, 5.2, 4.8, {
      hi: '#fff0de', base: '#ffd6b0', mid: '#f2be96', dark: '#d99b73',
    });

    // 溫暖栗色瀏海與側髮
    c.stamp(10, 9 + bob, [
      '.bbbbbbbbb.',
      'bbbbbbbbbbb',
      'bb.bb.bbb.b',
      'bb.........',
      'b..........',
    ], { b: '#6e4031' });
    c.px(11, 12 + bob, '#8f5843');
    c.px(15, 11 + bob, '#8f5843');

    // 明亮光澤大眼 + 腮紅 + 小嘴
    c.drawEye(14, 13 + bob, 'big', { pupil: '#281a33' });
    c.drawEye(18, 13 + bob, 'big', { pupil: '#281a33' });
    c.px(13, 16 + bob, '#ff9eb5');
    c.px(19, 16 + bob, '#ff9eb5');
    c.px(17, 16 + bob, '#c97167');

    // 莓紅探險貝雷帽＋白色羽毛＋金色星徽
    c.ellipseShade(14.5, 7.2 + bob, 6.2, 3.6, {
      hi: '#ff8a95', base: '#e3495d', mid: '#b82d47', dark: '#821a34',
    });
    c.rect(10, 9 + bob, 11, 2, '#b82d47');
    c.rect(13, 9 + bob, 7, 1, '#e3495d');
    // 羽毛
    c.px(9, 4 + bob, '#fffaf0'); c.px(10, 4 + bob, '#fffaf0');
    c.px(9, 5 + bob, '#ebe0cc'); c.px(10, 5 + bob, '#fffaf0');
    // 金星徽章
    c.px(18, 7 + bob, '#ffe875'); c.px(19, 8 + bob, '#ffaa33'); c.px(18, 8 + bob, '#ffe875');

    // 圍巾領口
    c.rect(11, 17 + bob, 8, 2, '#ffaa33');
    c.rect(13, 17 + bob, 5, 1, '#ffe26a');
    c.rect(11, 18 + bob, 3, 1, '#d96f1e');

    // 前手與水晶星燈
    c.rect(19, 19 + bob, 3, 2, '#f7eedc');
    c.px(22, 20 + bob, '#ffd6b0');
    // 提燈桿與星燈
    c.px(23, 17 + bob, '#d99a36');
    c.px(24, 16 + bob, '#ffe26a');
    c.px(25, 17 + bob, '#d99a36');
    c.rect(24, 18 + bob, 3, 4, '#7ee8ff');
    c.px(25, 19 + bob, '#fff8c4');
    c.px(25, 20 + bob, '#fff8c4');
    c.rect(24, 22 + bob, 3, 1, '#d99a36');

    c.outline('#281a33');

    // 描邊後的提燈光暈星點
    if (fi === 1) {
      c.px(25, 14 + bob, '#fff8c4');
      c.px(28, 19 + bob, '#9ef2ff');
    } else if (fi === 3) {
      c.px(28, 17 + bob, '#fff8c4');
      c.px(23, 14 + bob, '#9ef2ff');
    }
    return c;
  });
  svgFrames('hero', frames);
}

// 2. 翠玉果凍靈（slime）& 蜜桃果凍靈（slime-pink）— 28x28 × 4 格麻糬布丁圓頂造型
function buildJellySlime(name, pal) {
  const frames = [0, 1, 2, 3].map((fi) => {
    const c = makeCanvas(28, 28);
    // 0: 舒展, 1: 壓扁 Q 彈, 2: 彈跳拉高, 3: 落地緩衝
    const cfg = [
      { cx: 13.5, cy: 19.0, rx: 9.2, ry: 7.4, yMax: 26, eyeY: 17, eyeStyle: 'big', sproutY: 9, mouth: 'smile' },
      { cx: 13.5, cy: 21.0, rx: 10.6, ry: 5.5, yMax: 26, eyeY: 19, eyeStyle: 'happy', sproutY: 13, mouth: 'wide' },
      { cx: 13.5, cy: 16.5, rx: 8.2, ry: 8.5, yMax: 25, eyeY: 15, eyeStyle: 'big', sproutY: 6, mouth: 'open' },
      { cx: 13.5, cy: 19.2, rx: 9.6, ry: 7.0, yMax: 26, eyeY: 17, eyeStyle: 'cute', sproutY: 10, mouth: 'smile' },
    ][fi];

    // 果凍圓頂本體（底邊平實）
    c.ellipseShade(cfg.cx, cfg.cy, cfg.rx, cfg.ry, pal.body, {
      yMax: cfg.yMax, lx: -0.45, ly: -0.55,
    });
    // 底部微高光反光帶
    for (let x = 7; x <= 20; x++) {
      if (c.get(x, cfg.yMax - 1)) c.px(x, cfg.yMax - 1, pal.body.dark);
      if (x >= 10 && x <= 17 && c.get(x, cfg.yMax - 2)) c.px(x, cfg.yMax - 2, pal.body.bounce);
    }

    // 右下腹半透明微光星核／珍珠核（偏右側避免被誤認成嘴巴下巴）
    const coreY = cfg.yMax - 4;
    c.px(17, coreY, pal.coreOuter); c.px(18, coreY, pal.coreOuter);
    c.px(17, coreY - 1, pal.coreInner); c.px(18, coreY - 1, pal.coreOuter);

    // 左上角玻璃感亮澤
    const shineX = Math.round(cfg.cx - cfg.rx * 0.55);
    const shineY = Math.round(cfg.cy - cfg.ry * 0.55);
    c.rect(shineX, shineY, 2, 2, pal.shine);
    c.px(shineX + 2, shineY - 1, pal.shine);
    c.px(shineX - 1, shineY + 2, pal.body.hi);

    // 頭頂嫩葉（翠玉）或側戴櫻花髮飾（蜜桃）
    if (pal.top === 'leaf') {
      c.stamp(11, cfg.sproutY, [
        'll..ll',
        'lLllLl',
        '..ss..',
      ], { l: '#9bf578', L: '#4fa83a', s: '#3fa660' });
    } else {
      c.stamp(14, cfg.sproutY, [
        '.pp.pp.',
        'pPCpCPp',
        '.ppppp.',
      ], { p: '#ffd2e6', P: '#ff7aa8', C: '#fff3a3' });
    }

    // 大眼、腮紅與表情
    if (cfg.eyeStyle === 'happy') {
      c.drawEye(9, cfg.eyeY, 'happy', { pupil: pal.outline });
      c.drawEye(16, cfg.eyeY, 'happy', { pupil: pal.outline });
    } else {
      c.drawEye(10, cfg.eyeY, cfg.eyeStyle, { pupil: pal.outline });
      c.drawEye(16, cfg.eyeY, cfg.eyeStyle, { pupil: pal.outline });
    }
    c.px(8, cfg.eyeY + 3, pal.blush);
    c.px(19, cfg.eyeY + 3, pal.blush);
    if (cfg.mouth === 'open') {
      c.rect(13, cfg.eyeY + 3, 2, 2, pal.outline);
      c.px(13, cfg.eyeY + 4, '#ff7a99');
    } else if (cfg.mouth === 'wide') {
      c.px(12, cfg.eyeY + 2, pal.outline);
      c.px(13, cfg.eyeY + 3, pal.outline);
      c.px(14, cfg.eyeY + 3, pal.outline);
      c.px(15, cfg.eyeY + 2, pal.outline);
    } else {
      c.px(13, cfg.eyeY + 3, pal.outline);
      c.px(14, cfg.eyeY + 3, pal.outline);
    }

    c.outline(pal.outline);
    return c;
  });
  svgFrames(name, frames);
}

buildJellySlime('slime', {
  outline: '#133d32',
  shine: '#f2fff8',
  blush: '#ff9eb5',
  coreInner: '#fff8c4',
  coreOuter: '#ffd966',
  top: 'leaf',
  body: { hi: '#9bf5c6', base: '#48d68b', mid: '#27a86b', dark: '#197852', bounce: '#8ef0be' },
});
buildJellySlime('slime-pink', {
  outline: '#4d1d34',
  shine: '#fff5f9',
  blush: '#ff6e9c',
  coreInner: '#fffaf0',
  coreOuter: '#ffe08a',
  top: 'flower',
  body: { hi: '#ffd2e6', base: '#ff94be', mid: '#e06296', dark: '#b03e6e', bounce: '#ffc4de' },
});


// 樹
const TREE = [
  '.....kkkkkk.....',
  '...kkggggggkk...',
  '..kggggggGgggk..',
  '.kggwgggggGGggk.',
  '.kgwggggggggGgk.',
  'kgggggGggggggGgk',
  'kggggGGgggggGGgk',
  'kgggggggggggggGk',
  'kgGgggggggGgggGk',
  '.kGGggggggGGgGk.',
  '.kgGGgggggggGGk.',
  '..kGGGggggGGGk..',
  '...kkGGGGGGkk...',
  '.....kkttkk.....',
  '......kttk......',
  '......kttk......',
  '......kTtk......',
  '.....kTttTk.....',
  '....kkkkkkkk....',
];
svg('tree', [TREE]);

// 小木屋（牆面每列固定 15 格，由 wall() 組出）
const wall = (inner) => { if (inner.length !== 15) throw new Error("wall " + inner); return "....k" + inner + "k..."; };
svg("house", [[
  "..........kkkk..........",
  ".........krrrrk.........",
  "........krrrrrrk........",
  ".......krrRRrrrrk.......",
  "......krrrrrrRRrrk......",
  ".....krrRRrrrrrrrrk.....",
  "....krrrrrrrRRrrrrrk....",
  "...kkkkkkkkkkkkkkkkkk...",
  wall("ccccccccccccccc"),
  wall("cWWWkcccccWWWkc"),
  wall("cWbWkcccccWbWkc"),
  wall("cWWWkcccccWWWkc"),
  wall("ckkkkctttTckkkc"),
  wall("ccccccttTtccccc"),
  wall("CCCCCCttTtCCCCC"),
  wall("CCCCCCtntTCCCCC"),
  "....kkkkkkkkkkkkkkkkk...",
]]);

// 像素雲
svg('cloud', [[
  '.........kkkkk..........',
  '.......kkwwwwwkk........',
  '...kkkkwwwwwwwwwk.......',
  '..kwwwwwwwwwwwwwwkkkk...',
  '.kwwwwwwwwwwwwwwwwwwwk..',
  'kwwwwwwwwwwwwwwwwwwwwwk.',
  'kWWWWwwwwwWWWWwwwwWWWWk.',
  '.kkkkkkkkkkkkkkkkkkkkk..',
]]);

// 草地邊緣＋花（橫向重複的 32x10 圖塊）
const GRASS = [
  '.....p.............n........y...',
  '....pnp...g.......nnn......yny..',
  '.....p...gHg.......n.......yy...',
  '..g..G..gHHg..g....G...g...G..g.',
  '.gHg.G.gHGHHgGHg...G..gHg..G.gHg',
  'gggggggggggggggggggggggggggggggg',
  'GgGGgGGGgGGgGGGgGGgGGGgGGgGGGgGG',
  'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
  'GGGHGGGGGGGHGGGGGGGGHGGGGGGGGHGG',
  'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
];
svg('grass', [GRASS]);

// 遠山（橫向重複 96x28；階梯狀山形＋雪頂）
{
  const W = 96, H = 28;
  const peaks = [[16, 4, 1.1], [52, 9, 0.9], [80, 2, 1.2]]; // [x, 頂端高度, 斜率]
  const top = (x) => Math.min(...peaks.map(([px, py, k]) => {
    // 讓圖塊左右接得起來：考慮相鄰圖塊的山峰
    const d = Math.min(Math.abs(x - px), Math.abs(x - px - W), Math.abs(x - px + W));
    return Math.round(py + d / k);
  }));
  const rows = [];
  for (let y = 0; y < H; y++) {
    let r = '';
    for (let x = 0; x < W; x++) {
      const t = top(x);
      if (y < t) r += '.';
      else if (y === t) r += 'k';
      else if (y < t + 3 && t < 9) r += 'w';
      else r += y > t + 8 ? 'M' : 'm';
    }
    rows.push(r);
  }
  svg('mountains', [rows]);
}

// ---------- 第二批：重新設計的原創高精細怪物（28x28 / 32x24 / 28x20，4 格動畫） ----------

// 3. 橡果葉小精靈（leafling，28x28 × 4 格：橡果貝雷帽＋翡翠葉披風）
{
  const frames = [0, 1, 2, 3].map((fi) => {
    const c = makeCanvas(28, 28);
    const bob = (fi === 1 || fi === 3) ? -1 : 0;

    // 雙腳
    if (fi === 0) {
      c.rect(9, 24, 3, 3, '#78421e'); c.rect(15, 23, 3, 3, '#96562b');
    } else if (fi === 1) {
      c.rect(10, 24, 3, 2, '#96562b'); c.rect(15, 24, 3, 2, '#78421e');
    } else if (fi === 2) {
      c.rect(9, 23, 3, 3, '#96562b'); c.rect(15, 24, 3, 3, '#78421e');
    } else {
      c.rect(10, 24, 3, 2, '#78421e'); c.rect(15, 24, 3, 2, '#96562b');
    }

    // 翡翠葉片披風（微晃動）
    c.ellipseShade(13.5, 20 + bob, 7.2, 4.8, {
      hi: '#a3f078', base: '#58c44f', mid: '#3ba33f', dark: '#2f8f3d',
    }, { yMax: 24 + bob });
    c.px(6, 22 + bob, '#58c44f'); c.px(21, 22 + bob, '#3ba33f');
    // 披風中央 V 領線
    c.px(13, 18 + bob, '#2f8f3d'); c.px(14, 18 + bob, '#2f8f3d');
    c.px(13, 19 + bob, '#2f8f3d'); c.px(14, 19 + bob, '#2f8f3d');

    // 奶油臉龐
    c.ellipseShade(13.5, 13.5 + bob, 4.8, 3.8, {
      hi: '#fffaf0', base: '#ffeed6', mid: '#f2d3b3', dark: '#d9b291',
    });

    // 橡果貝雷帽＋頂端小芽葉
    c.ellipseShade(13.5, 8.2 + bob, 6.8, 4.0, {
      hi: '#e09c5c', base: '#b06934', mid: '#8f4f24', dark: '#78421e',
    }, { yMax: 11 + bob });
    c.rect(7, 10 + bob, 14, 1, '#78421e');
    for (let x = 8; x <= 19; x += 2) c.px(x, 9 + bob, '#8f4f24');
    // 果蒂＋嫩芽葉
    c.rect(13, 3 + bob, 2, 2, '#78421e');
    c.px(15, 2 + bob, '#a3f078'); c.px(16, 2 + bob, '#58c44f'); c.px(15, 3 + bob, '#58c44f');

    // 五官
    c.drawEye(10, 13 + bob, fi === 3 ? 'blink' : 'big', { pupil: '#361d10' });
    c.drawEye(15, 13 + bob, fi === 3 ? 'blink' : 'big', { pupil: '#361d10' });
    c.px(9, 15 + bob, '#ff9eb5'); c.px(18, 15 + bob, '#ff9eb5');
    c.px(13, 15 + bob, '#b06934');

    c.outline((n) => {
      if (n === '#a3f078' || n === '#58c44f' || n === '#3ba33f' || n === '#2f8f3d') return '#164224';
      if (n === '#fffaf0' || n === '#ffeed6' || n === '#f2d3b3' || n === '#d9b291') return '#4a2f22';
      return '#361d10';
    });
    return c;
  });
  svgFrames('leafling', frames);
}

// 4. 奶油絨毛鳥（chick，28x28 × 4 格：圓滾黃絨鳥坐在鋸齒蛋殼杯裡）
{
  const frames = [0, 1, 2, 3].map((fi) => {
    const c = makeCanvas(28, 28);
    const hop = fi === 2 ? -1 : 0;

    // 兩側拍動小翅膀（在身體兩側）
    const wingY = (fi === 1 || fi === 2) ? 13 + hop : 15 + hop;
    c.rect(5, wingY, 3, 3, '#ffe470'); c.px(5, wingY + 2, '#f5bf3d');
    c.rect(20, wingY, 3, 3, '#ffe470'); c.px(22, wingY + 2, '#f5bf3d');

    // 奶油黃圓滾身體
    c.ellipseShade(13.5, 14.5 + hop, 6.8, 6.2, {
      hi: '#fff9d6', base: '#ffe470', mid: '#f5bf3d', dark: '#d48f1c',
    });
    // 頭頂三根絨毛
    c.px(12, 7 + hop, '#ffe470'); c.px(13, 6 + hop, '#fff9d6');
    c.px(14, 7 + hop, '#ffe470'); c.px(15, 7 + hop, '#f5bf3d');

    // 珍珠白鋸齒蛋殼杯
    c.ellipseShade(13.5, 21.5 + hop, 7.6, 4.8, {
      hi: '#ffffff', base: '#f5eee6', mid: '#e6dac8', dark: '#d9ccb8',
    }, { yMin: 18 + hop, yMax: 26 + hop });
    // 鋸齒破殼邊緣
    [7, 10, 13, 16, 19].forEach((zx) => {
      c.px(zx, 17 + hop, '#ffffff');
      c.px(zx + 1, 18 + hop, '#f5eee6');
    });

    // 眼睛、腮紅、橘色小喙
    c.drawEye(9, 12 + hop, fi === 2 ? 'happy' : 'big', { pupil: '#4a2d14' });
    c.drawEye(16, 12 + hop, fi === 2 ? 'happy' : 'big', { pupil: '#4a2d14' });
    c.px(8, 15 + hop, '#ff9482'); c.px(19, 15 + hop, '#ff9482');
    if (fi === 1 || fi === 2) {
      c.rect(13, 14 + hop, 2, 1, '#ff8c3a');
      c.rect(13, 15 + hop, 2, 1, '#b84214');
      c.rect(13, 16 + hop, 2, 1, '#d95d16');
    } else {
      c.rect(13, 14 + hop, 2, 1, '#ff8c3a');
      c.px(13, 15 + hop, '#d95d16'); c.px(14, 15 + hop, '#d95d16');
    }

    c.outline((n) => (n === '#ffffff' || n === '#f5eee6' || n === '#e6dac8' || n === '#d9ccb8' ? '#4f4238' : '#4a2d14'));

    if (fi === 1 || fi === 2) {
      c.px(22, 6 + hop, '#ffaa33');
      c.px(23, 5 + hop, '#ffe470');
      c.px(23, 7 + hop, '#fff3a3');
    }
    return c;
  });
  svgFrames('chick', frames);
}

// 5. 棉花糖星雲獸（cloudling，32x24 × 4 格：小金翅膀雲團＋頭頂閃爍金星）
{
  const frames = [0, 1, 2, 3].map((fi) => {
    const c = makeCanvas(32, 24);
    const bob = [0, -1, 0, 1][fi];
    const wingDy = [-1, 0, 1, 0][fi];

    // 兩側小金翅
    c.rect(3, 10 + bob + wingDy, 4, 3, '#fff4b8');
    c.rect(4, 12 + bob + wingDy, 3, 2, '#f2c45a');
    c.rect(25, 10 + bob + wingDy, 4, 3, '#fff4b8');
    c.rect(25, 12 + bob + wingDy, 3, 2, '#f2c45a');

    // 三團蓬鬆棉花糖雲體
    const cloudRamp = { hi: '#ffffff', base: '#f2f6ff', mid: '#d8e3fa', dark: '#b3c4eb' };
    c.ellipseShade(11, 13 + bob, 5.5, 4.6, cloudRamp);
    c.ellipseShade(20.5, 13 + bob, 5.5, 4.6, cloudRamp);
    c.ellipseShade(15.5, 10.5 + bob, 6.2, 5.0, cloudRamp);
    // 柔平雲底陰影
    c.rect(9, 16 + bob, 14, 2, '#cddaf7');
    c.rect(11, 17 + bob, 10, 1, '#9fb4e8');

    // 表情
    c.drawEye(12, 11 + bob, fi === 3 ? 'blink' : 'cute', { pupil: '#3d4c7a' });
    c.drawEye(18, 11 + bob, fi === 3 ? 'blink' : 'cute', { pupil: '#3d4c7a' });
    c.px(10, 13 + bob, '#ffb3c6'); c.px(21, 13 + bob, '#ffb3c6');
    c.px(15, 13 + bob, '#6a7db5'); c.px(16, 13 + bob, '#6a7db5');

    c.outline((n) => (n === '#fff4b8' || n === '#f2c45a' ? '#7a5018' : '#3d4c7a'));

    // 頭頂飄浮閃爍小星星
    const sy = 2 + (fi % 2);
    c.px(15, sy, '#fff6a8');
    if (fi === 0 || fi === 2) {
      c.px(15, sy - 1, '#ffd23f'); c.px(15, sy + 1, '#ffd23f');
      c.px(14, sy, '#ffd23f'); c.px(16, sy, '#ffd23f');
    } else {
      c.px(16, sy, '#ffe875');
    }
    return c;
  });
  svgFrames('cloudling', frames);
}

// 6. 珊瑚貝殼蟹（crab，28x20 × 4 格：背著薰衣草條紋貝殼帽的圓滾珊瑚蟹）
{
  const frames = [0, 1, 2, 3].map((fi) => {
    const c = makeCanvas(28, 20);

    // 六隻小腳（左右交替小碎步，最底描邊貼齊 y=19）
    const step = fi % 2;
    [7, 10, 17, 20].forEach((lx, idx) => {
      const yFoot = 17 + ((idx + step) % 2);
      c.rect(lx, 16, 2, yFoot - 15, '#d94436');
    });
    c.px(5, 16 + step, '#d94436'); c.px(22, 16 + (1 - step), '#d94436');

    // 大圓鉗子（開合揮舞）
    const pUp = (fi === 1 || fi === 2) ? -1 : 0;
    c.ellipseShade(4.5, 10 + pUp, 2.6, 2.4, { hi: '#ffb59e', base: '#ff6e59', mid: '#d94436', dark: '#a12524' });
    c.ellipseShade(22.5, 10 + pUp, 2.6, 2.4, { hi: '#ffb59e', base: '#ff6e59', mid: '#d94436', dark: '#a12524' });
    if (fi === 0 || fi === 3) {
      c.px(4, 8 + pUp, null); c.px(22, 8 + pUp, null);
    }
    c.px(6, 12 + pUp, '#d94436'); c.px(20, 12 + pUp, '#d94436');

    // 珊瑚圓滾身體＋奶油肚
    c.ellipseShade(13.5, 13.5, 7.2, 4.0, {
      hi: '#ffb59e', base: '#ff6e59', mid: '#d94436', dark: '#a12524',
    });
    c.rect(10, 15, 8, 2, '#fff0e0');

    // 薰衣草與奶油條紋小貝殼帽
    c.stamp(10, 6, [
      '..llcc..',
      '.lLLcCc.',
      'lLLccCCc',
      'cccccccc',
    ], { l: '#e6ccff', L: '#b88ae6', c: '#fff5e6', C: '#e8d2f5' });

    // 立體眼柄＋水亮眼睛
    c.rect(9, 9, 2, 2, '#ff6e59');
    c.rect(17, 9, 2, 2, '#ff6e59');
    if (fi === 3) {
      c.drawEye(9, 8, 'blink', { pupil: '#451419' });
      c.drawEye(17, 8, 'blink', { pupil: '#451419' });
    } else {
      c.drawEye(9, 8, 'cute', { pupil: '#451419' });
      c.drawEye(17, 8, 'cute', { pupil: '#451419' });
    }
    c.px(13, 14, '#451419'); c.px(14, 14, '#451419');

    c.outline((n) => (n === '#e6ccff' || n === '#b88ae6' || n === '#fff5e6' || n === '#e8d2f5' ? '#473159' : '#451419'));
    return c;
  });
  svgFrames('crab', frames);
}

// 7. 星夜傘菇精（sporeling，28x28 × 4 格：紫羅蘭荷葉邊大法師傘蓋＋薄荷葉領＋螢火孢子）
{
  const frames = [0, 1, 2, 3].map((fi) => {
    const c = makeCanvas(28, 28);
    const bob = (fi === 1 || fi === 3) ? -1 : 0;

    // 胖胖小腳走路
    if (fi === 0) {
      c.rect(9, 24, 3, 3, '#cbb3b8'); c.rect(15, 23, 3, 3, '#ebd9cc');
    } else if (fi === 1) {
      c.rect(9, 24, 3, 2, '#ebd9cc'); c.rect(15, 24, 3, 2, '#cbb3b8');
    } else if (fi === 2) {
      c.rect(9, 23, 3, 3, '#ebd9cc'); c.rect(15, 24, 3, 3, '#cbb3b8');
    } else {
      c.rect(10, 24, 3, 2, '#cbb3b8'); c.rect(15, 24, 3, 2, '#ebd9cc');
    }

    // 月光奶油胖身
    c.ellipseShade(13.5, 19.5 + bob, 5.2, 5.2, {
      hi: '#fffdf7', base: '#fff5e8', mid: '#ebd9cc', dark: '#cbb3b8',
    });

    // 薄荷葉小領巾
    c.stamp(8, 14 + bob, [
      '.gGGGGGGg..',
      'gGGg..gGGg.',
      '.gg....gg..',
    ], { g: '#7de092', G: '#3fa660' });

    // 淡紫菌褶底層
    c.rect(5, 12 + bob, 18, 2, '#f2e3ff');
    for (let gx = 6; gx <= 21; gx += 3) c.px(gx, 13 + bob, '#cbb0ed');

    // 暮光紫羅蘭寬大荷葉傘蓋＋小尖頂
    c.ellipseShade(13.5, 9.2 + bob, 9.6, 4.6, {
      hi: '#efb5ff', base: '#b96bf2', mid: '#7c3ec9', dark: '#4b2085',
    }, { yMax: 12 + bob });
    c.stamp(11, 3 + bob, [
      '..hh..',
      '.hhbm.',
      'hhbbmm',
    ], { h: '#efb5ff', b: '#b96bf2', m: '#7c3ec9' });
    // 荷葉邊波浪裙緣
    [4, 7, 10, 13, 16, 19, 22].forEach((wx) => c.px(wx, 12 + bob, '#7c3ec9'));

    // 微光星辰小金點（非對稱點綴）
    c.px(9, 8 + bob, '#fff3a3');
    c.px(16, 7 + bob, '#fff3a3'); c.px(17, 7 + bob, '#ffd45a');
    c.px(19, 10 + bob, '#fff3a3');

    // 大眼、腮紅、可愛微笑（下移 1px 避開薄荷葉領尖端）
    c.drawEye(10, 18 + bob, fi === 3 ? 'blink' : 'big', { pupil: '#251345' });
    c.drawEye(15, 18 + bob, fi === 3 ? 'blink' : 'big', { pupil: '#251345' });
    c.px(9, 21 + bob, '#ff9eb5'); c.px(17, 21 + bob, '#ff9eb5');
    c.px(13, 21 + bob, '#6b4263');

    c.outline((n) => {
      if (n === '#7de092' || n === '#3fa660') return '#184d34';
      if (n === '#fffdf7' || n === '#fff5e8' || n === '#ebd9cc' || n === '#cbb3b8') return '#472d4a';
      return '#251345';
    });

    // 飄浮金色孢子螢火（描邊後才畫，保持細緻發光）
    const sp = [[4, 4, 23, 6], [4, 3, 24, 5], [5, 2, 23, 4], [5, 3, 22, 5]][fi];
    c.px(sp[0], sp[1], '#fff6b3');
    c.px(sp[2], sp[3], '#ffd23f');
    c.px(14, 1 + (fi % 2), '#fff6b3');
    return c;
  });
  svgFrames('sporeling', frames);
}

// 8. 琉璃海月靈（dewdrop，28x28 × 4 格：半透明水晶海月水母＋絲帶觸鬚＋珍珠氣泡）
{
  const frames = [0, 1, 2, 3].map((fi) => {
    const c = makeCanvas(28, 28);
    const bob = [0, -1, -1, 0][fi];
    const rx = [8.4, 9.0, 8.2, 7.8][fi];

    // 四條同向水波絲帶（間距 4px，飄逸不打結）
    const waveA = [0, 1, 1, 0][fi];
    const waveB = [-1, 0, 1, 0][fi];
    [7, 11, 15, 19].forEach((tx, ti) => {
      const len = ti === 1 || ti === 2 ? 7 : 6;
      for (let dy = 0; dy < len; dy++) {
        const xOff = dy < 2 ? 0 : dy < 4 ? waveA : waveB;
        const col = dy < 3 ? '#3ec4f0' : '#1e88cc';
        c.px(tx + xOff, 17 + bob + dy, col);
        if (dy < len - 1) c.px(tx + 1 + xOff, 17 + bob + dy, '#8ce8ff');
      }
    });

    // 琉璃水母鐘罩
    c.ellipseShade(13.5, 11.5 + bob, rx, 6.6, {
      hi: '#e8fcff', base: '#8ce8ff', mid: '#3ec4f0', dark: '#1e88cc',
    }, { yMax: 16 + bob });
    // 內層淡青發光邊緣與蕾絲裙邊
    for (let x = 6; x <= 21; x++) {
      if (c.get(x, 16 + bob)) c.px(x, 16 + bob, x % 2 === 0 ? '#c4f7ff' : '#3ec4f0');
    }
    // 玻璃弧形亮澤
    c.rect(8, 7 + bob, 2, 2, '#ffffff');
    c.px(10, 6 + bob, '#ffffff');
    c.px(7, 9 + bob, '#e8fcff');

    // 水亮大眼＋粉紅腮紅
    c.drawEye(10, 11 + bob, fi === 3 ? 'blink' : 'big', { pupil: '#143666' });
    c.drawEye(15, 11 + bob, fi === 3 ? 'blink' : 'big', { pupil: '#143666' });
    c.px(8, 14 + bob, '#ffb3cc'); c.px(18, 14 + bob, '#ffb3cc');
    c.px(13, 14 + bob, '#1e88cc');

    c.outline('#143666');

    // 上升的珍珠白氣泡（描邊後繪製）
    const b1y = [7, 5, 3, 9][fi];
    const b2y = [15, 13, 11, 17][fi];
    c.px(24, b1y, '#ffffff'); c.px(24, b1y + 1, '#c4f7ff');
    c.px(3, b2y, '#ffffff');
    return c;
  });
  svgFrames('dewdrop', frames);
}

// 傳送點（橢圓漩渦，程式算出來）
{
  const W = 16, H = 24, cx = 7.5, cy = 11.5, rx = 7.5, ry = 11.5;
  const rows = [];
  for (let y = 0; y < H; y++) {
    let r = '';
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (d > 1) r += '.';
      else if (d > 0.88) r += 'k';
      else if (d > 0.7) r += 'V';
      else if (d > 0.48) r += ((x + y) % 4 === 0 ? 'w' : 'v');
      else if (d > 0.25) r += 'W';
      else r += 'q';
    }
    rows.push(r);
  }
  svg('portal', [rows]);
}

// 浮空平台圖塊（16x8，橫向重複）：草地、雪地、木板
const PF_GRASS = [
  'gggggggggggggggg',
  'GgGGgGGgGGGgGgGG',
  'tttttttttttttttt',
  'ttTttttTtttTtttt',
  'tttTtttttTtttttT',
  'TtttttTttttttTtt',
  'tTTttTttTTttTttT',
  'kkkkkkkkkkkkkkkk',
];
svg('platform-grass', [PF_GRASS]);
svg('platform-snow', [[
  'wwwwwwwwwwwwwwww',
  'WwWWwwWwwWWwwWwW',
  'tttWttttTtttWttt',
  'ttTttttTtttTtttt',
  'tttTtttttTtttttT',
  'TtttttTttttttTtt',
  'tTTttTttTTttTttT',
  'kkkkkkkkkkkkkkkk',
]]);
svg('platform-wood', [[
  'kkkkkkkkkkkkkkkk',
  'ffffkffffffkffff',
  'fFffkfffFffkffFf',
  'FFFFkFFFFFFkFFFF',
  'kkkkkkkkkkkkkkkk',
  '..kFk......kFk..',
  '..kFk......kFk..',
  '..kkk......kkk..',
]]);

// 梯子（8x8，直向重複）
svg('ladder', [[
  'ktk..ktk',
  'ktk..ktk',
  'kttttttk',
  'kTTTTTTk',
  'ktk..ktk',
  'ktk..ktk',
  'ktk..ktk',
  'ktk..ktk',
]]);

// 椰子樹
svg('palm', [[
  '...kkk....kkk...',
  '..kgggk..kgggk..',
  '.kgggGgkkgGgggk.',
  'kggGkkgggggkkGgk',
  'kgGk.kgGGGgk.kGk',
  '.kk..kgkkgk..kk.',
  '......ktTk......',
  '......ktTk......',
  '.......ktTk.....',
  '.......ktTk.....',
  '.......kTtk.....',
  '......ktTk......',
  '......ktTk......',
  '......kTtk......',
  '.....ktTtTk.....',
  '.....kkkkkk.....',
]]);

// 小帆船
svg('boat', [[
  '...........k............',
  '..........kwk...........',
  '.........kwwk...........',
  '........kwwwk...........',
  '.......kwwwwk...........',
  '......kwwwwWk...........',
  '.....kkkkkkkk...........',
  '...........k............',
  'kkkkkkkkkkkkkkkkkkkkkkkk',
  '.krrrrrrrrrrrrrrrrrrrrk.',
  '..kRRRRRRRRRRRRRRRRRRk..',
  '...kkkkkkkkkkkkkkkkkk...',
]]);

// 碼頭木板（16x8，橫向重複）
svg('dock', [[
  'kkkkkkkkkkkkkkkk',
  'ffffkffffffkffff',
  'FFFFkFFFFFFkFFFF',
  'kkkkkkkkkkkkkkkk',
  '..kFk......kFk..',
  '..kFk......kFk..',
  '..kFk......kFk..',
  '..kFk......kFk..',
]]);

// 海浪（32x8，橫向重複）
{
  const pat = ['...ww...', '..weew..', 'eweeeewe', 'eeeeeeee', 'eeEeeeEe', 'EeeeEeee', 'EEEEEEEE', 'EEEEEEEE'];
  svg('sea', [pat.map((r) => r.repeat(4))]);
}

// 沙灘與雪地（32x10，橫向重複）
svg('sand', [[
  '................................',
  '......p.................w.......',
  '.....ppp..............wwk.......',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'aAaaaaaaaaAaaaaaaaaaaaAaaaaaaaaa',
  'aaaaaAaaaaaaaaaAaaaaaaaaaaaAaaaa',
  'AaaaaaaaAaaaaaaaaaaAaaaaaaaaaaaA',
  'aaaAaaaaaaaaAaaaaaaaaaAaaaaaAaaa',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'AaaaaaAaaaaaaaaAaaaaaaAaaaaaaaaa',
]]);
svg('snow', [[
  '................................',
  '................................',
  '................................',
  'wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww',
  'wwWwwwwwwwwwWwwwwwwwwwwwWwwwwwww',
  'wwwwwWwwwwwwwwwwwWwwwwwwwwwwwWww',
  'WwwwwwwwWwwwwwwwwwwwWwwwwwwwwwwW',
  'wwwWwwwwwwwwwWwwwwwwwwwWwwwwwwww',
  'wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww',
  'WWwwwwWwwwwwwwwWWwwwwwWwwwwwwwWW',
]]);

// 雪松
svg('pine', [[
  '.......kk.......',
  '......kwwk......',
  '.....kwzzwk.....',
  '....kwzzzzwk....',
  '...kzzzZzzzzk...',
  '....kkwwwwkk....',
  '...kwwzzzzwwk...',
  '..kwzzzzZzzzwk..',
  '.kzzzZzzzzzZzzk.',
  '..kkkwwwwwwkkk..',
  '.kwwzzzzzzzzwwk.',
  'kwzzzzZzzzzZzzwk',
  'kzzZzzzzzzZzzzzk',
  '.kkkkkkkkkkkkkk.',
  '......ktTk......',
  '......kTtk......',
  '.....kkkkkk.....',
]]);

// 雪人
svg('snowman', [[
  '....kkkk....',
  '...kkkkkk...',
  '...kkkkkk...',
  '..kkkkkkkk..',
  '..kwwwwwwk..',
  '..kwkwwkwk..',
  '..kwwOOwwk..',
  '...kwwwwk...',
  '..krrrrrrk..',
  '.kwwwRwwwwk.',
  'kwwwwkwwwwwk',
  'kwwwwwwwwwWk',
  'kwwwwkwwwwWk',
  'kWwwwwwwwWWk',
  '.kWWwwwwWWk.',
  '..kkkkkkkk..',
]]);

// ---------- 四季的換色版本（只換葉子／草的顏色，樹幹與輪廓不變） ----------
const recolor = (rows, map) => rows.map((r) => [...r].map((c) => map[c] ?? c).join(''));
svg('tree-blossom', [recolor(TREE, { g: 'i', G: 'I', H: 'j', w: 'w' })]);
svg('tree-maple', [recolor(TREE, { g: 'u', G: 'U', H: 'x' })]);
svg('tree-gold', [recolor(TREE, { g: 'l', G: 'L', H: 'd' })]);
svg('grass-autumn', [recolor(GRASS, { g: 'h', G: 'N', H: 'x' })]);
svg('platform-autumn', [recolor(PF_GRASS, { g: 'h', G: 'N' })]);
