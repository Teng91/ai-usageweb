// 產生 public/pixel/ 的像素圖（冒險風格的角色與場景）。全部是原創點陣，無外部素材。
// 用法：node scripts/gen-pixel-art.mjs [輸出資料夾，預設 public/pixel]
import fs from 'node:fs';
import path from 'node:path';
const out = process.argv[2] || new URL("../public/pixel/", import.meta.url).pathname.replace(/^/([A-Za-z]:)/, "$1");
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

// 小勇者（兩格走路）
const heroTop = [
  '................',
  '.....kkkkkk.....',
  '....kbbbbbbk....',
  '...kbbbbbbbbk...',
  '...kkkkkkkkkk...',
  '....kssssssk....',
  '....kskssksk....',
  '....kssSSssk....',
  '.....kssssk..y..',
  '....krrrrrrk.y..',
  '...ksrrrrrrsky..',
  '....krRRRRrk.T..',
];
svg('hero', [
  [...heroTop, '....kBBkkBBk....', '....kBBk.kBBk...', '....kkk...kkk...', '................'],
  [...heroTop, '....kBBkkBBk....', '.....kBBBBk.....', '.....kk..kk.....', '................'],
]);

// 史萊姆（綠、粉）
const slime = (c, d) => [
  '................',
  '................',
  '................',
  '......kkkk......',
  '....kk' + c + c + c + c + 'kk....',
  '...k' + c + c + c + c + c + c + c + c + 'k...',
  '..k' + c + 'ww' + c + c + c + c + c + c + c + 'k..',
  '..k' + c + 'w' + c + c + c + c + c + c + c + c + 'k..',
  '..k' + c + c + 'k' + c + c + c + c + 'k' + c + c + 'k..',
  '..k' + c + c + 'k' + c + c + c + c + 'k' + c + c + 'k..',
  '..k' + c + c + c + c + 'kk' + c + c + c + c + 'k..',
  '..k' + d + c + c + c + c + c + c + c + c + d + 'k..',
  '...k' + d + d + c + c + c + c + d + d + 'k...',
  '....kkkkkkkk....',
  '................',
  '................',
];
svg('slime', [slime('g', 'G')]);
svg('slime-pink', [slime('p', 'P')]);

// 坐著的貓（尾巴兩格擺動）
const catBody = [
  '................',
  '..k.......k.....',
  '..kk.....kk.....',
  '..kOk...kOk.....',
  '..kooookoook....',
  '..koooooooook...',
  '..kokwooowkok...',
  '..kookooookok...',
  '..koooppoook....',
  '...koooooook....',
  '..koowwwwook....',
  '..kooowwoook....',
  '..kooooooook....',
  '..kokoooookok...',
  '...kkkkkkkkk....',
  '................',
];
const tail1 = catBody.map((r, i) => (i === 10 ? r.slice(0, 12) + 'kok.' : i === 11 ? r.slice(0, 12) + 'k.k.' : i === 9 ? r.slice(0, 12) + '.kk.' : r));
const tail2 = catBody.map((r, i) => (i === 12 ? r.slice(0, 12) + 'kook' : i === 13 ? r.slice(0, 12) + 'kkk.' : r));
svg('cat', [tail1, tail2]);

// 樹
svg('tree', [[
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
]]);

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
svg('grass', [[
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
]]);

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
