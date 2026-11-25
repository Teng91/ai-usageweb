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

// 史萊姆（綠、粉，兩格：一般／Q 彈眨眼）
const slime = (c, d) => [
  '................',
  '................',
  '................',
  '......kkkk......',
  '....kk' + c.repeat(4) + 'kk....',
  '...k' + c.repeat(8) + 'k...',
  '..k' + c + 'ww' + c.repeat(7) + 'k..',
  '..k' + c + 'w' + c.repeat(8) + 'k..',
  '..k' + c + c + 'k' + c.repeat(4) + 'k' + c + c + 'k..',
  '..k' + c + c + 'k' + c.repeat(4) + 'k' + c + c + 'k..',
  '..k' + c.repeat(4) + 'kk' + c.repeat(4) + 'k..',
  '..k' + d + c.repeat(8) + d + 'k..',
  '...k' + d + d + c.repeat(4) + d + d + 'k...',
  '....kkkkkkkk....',
  '................',
  '................',
];
const slimeSquish = (c, d) => [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.....kkkkkk.....',
  '...kk' + c.repeat(6) + 'kk...',
  '..k' + c + 'ww' + c.repeat(7) + 'k..',
  '.k' + c + c + 'w' + c.repeat(9) + 'k.',
  '.k' + c + c + 'kk' + c.repeat(4) + 'kk' + c + c + 'k.',
  '.k' + c.repeat(5) + 'kk' + c.repeat(5) + 'k.',
  '.k' + d + c.repeat(10) + d + 'k.',
  '..k' + d + d + c.repeat(6) + d + d + 'k..',
  '...kkkkkkkkkk...',
  '................',
  '................',
];
svg('slime', [slime('g', 'G'), slimeSquish('g', 'G')]);
svg('slime-pink', [slime('p', 'P'), slimeSquish('p', 'P')]);


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

// ---------- 第二批：原創怪物、地形、四季地圖的道具 ----------

// 葉子精靈（兩格：眨眼＋換腳）
const leafTop = [
  '........kk......',
  '.......kGGk.....',
  '......kGk.......',
  '....kkkGkkkk....',
  '...kggggGggggk..',
  '..kgwggggGgggggk',
  '.kggggggGggggggk',
];
const leafBottom = [
  '.kgpggggggggpggk',
  '.kgggggkkgggggk.',
  '..kgggggggggGk..',
  '...kGgggggGGk...',
  '....kkGGGGkk....',
];
svg('leafling', [
  [...leafTop, '.kggkggggggkgggk', '.kggkggggggkgggk', ...leafBottom, '....kk....kk....', '................'],
  [...leafTop, '.kgggggggggggggk', '.kggkggggggkgggk', ...leafBottom, '.....kk..kk.....', '................'],
]);

// 蛋殼小雞（兩格：閉嘴／張嘴）
const chick = (eyes, beak) => [
  '................',
  '................',
  '......kkkk......',
  '.....knnnnk.....',
  '....knnnnnnk....',
  '...' + eyes + '...',
  '...knnnnnnnnk...',
  '...' + beak + '...',
  '..kknnnnnnnnkk..',
  '..kwwkwwwkwwwk..',
  '..kwwwwwwwwwWk..',
  '..kwwWwwwwwWWk..',
  '...kwwwwwwWWk...',
  '....kkkkkkkk....',
  '................',
  '................',
];
svg('chick', [chick('knnknnknnk', 'knnnoonnnk'), chick('knnknnknnk', 'knnokkonnk')]);

// 嘟嘴雲朵怪（兩格：嘟嘴／張嘴）
const cloudling = (mouth) => [
  '................',
  '....kkk..kkk....',
  '...kwwwkkwwwk...',
  '..kwwwwwwwwwwk..',
  '.kwwwkwwwwkwwwk.',
  '.kwwwkwwwwkwwwk.',
  '.kwpwwwwwwwwpwk.',
  '.' + mouth + '.',
  '.kWwwwwwwwwwwWk.',
  '..kWWwwwwwwWWk..',
  '...kkkkkkkkkk...',
  '................',
];
svg('cloudling', [cloudling('kwwwwwkkwwwwwk'), cloudling('kwwwwkwwkwwwwk')]);

// 小螃蟹（兩格：鉗子張合）
const crabBody = [
  '.kk.kk....kk.kk.',
  '....kwk..kwk....',
  '...kkkkkkkkkk...',
  '..krrrrrrrrrrk..',
  '.krrrrrrrrrrrrk.',
  '.krRrrrkkrrrRrk.',
  '..kRRRRRRRRRRk..',
  '.k.k.k....k.k.k.',
  '................',
];
svg('crab', [
  ['.kk..........kk.', 'krrk........krrk', 'krRk........kRrk', ...crabBody],
  ['kk............kk', 'krk..........krk', '.kk..........kk.', ...crabBody],
]);

// 紫光小菇靈（兩格：孢子浮動＋走路換腳＋微笑）
const sporeCap = [
  '.......kvvVk....',
  '.....kkvvvVVk...',
  '....kvqvvvvVVk..',
  '...kvvvvvvqVVVk.',
  '..kvvvqvvvvVVVVk',
  '..kVVVVVVVVVVVVk',
  '...kkkkkkkkkkkk.',
  '....kcccccccck..',
  '....kcckcckcck..',
];
svg('sporeling', [
  ['.........kk.....', '..q.....kvVk....', ...sporeCap, '....kcpccccpck..', '....kCccccccCk..', '.....kkCCCCkk...', '.....kk....kk...', '................'],
  ['...q.....kk.....', '........kvVk....', ...sporeCap, '....kcpckkcpck..', '....kCccccccCk..', '.....kkCCCCkk...', '......kk..kk....', '................'],
]);

// 露珠水精靈（兩格：泡泡上升＋水波裙擺晃動）
svg('dewdrop', [
  [
    '................',
    '............w...',
    '.......kk..wW...',
    '......keek......',
    '.....kweeek.....',
    '....kweeeeek....',
    '...kwWeeeeeek...',
    '..kweeeeeeeeek..',
    '..keekeeeekeek..',
    '..keWeeeeeeWek..',
    '..kEeeeeeeeeEk..',
    '..kEEeeeeeeEEk..',
    '..kEEkEEEEkEEk..',
    '...kk.kkkk.kk...',
    '................',
    '................',
  ],
  [
    '............w...',
    '................',
    '................',
    '.......kk.......',
    '......keek......',
    '.....kweeek.....',
    '....kweeeeek....',
    '...kwWeeeeeek...',
    '..kweeeeeeeeek..',
    '..keekeeeekeek..',
    '..keWeeeeeeWek..',
    '..kEeeeeeeeeEk..',
    '.kEEEeeeeeeEEEk.',
    '.kkEEkkEEkkEEkk.',
    '...kk..kk..kk...',
    '................',
  ],
]);

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
