// 冒險風格的原創場景圖塊（文字點陣）：樹、屋子、雲、草地、遠山、傳送點、平台、海、雪地，以及四季換色版本。
import { svg, makeCanvas, svgFrames } from './lib.mjs';

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

// ---------- 多層遠景（原創，程式算出來）：遠丘＋帶圓樹冠的近丘，四季各一套配色 ----------
// 寬 128 格、可橫向無縫重複：稜線只用「整數個週期」的正弦波疊出來，樹冠超出右邊界的部分繞回左邊畫
{
  const W = 128, H = 40;
  const TAU = Math.PI * 2;
  const wave = (x, terms) => terms.reduce((sum, [amp, k, ph]) => sum + amp * Math.sin((TAU * k * x) / W + ph), 0);

  const SEASONS = {
    spring: { back: '#bfdff0', front: '#a6d8c2', edge: '#cdeedb', base: '#74c46a', tree: '#86d16c', dark: '#5aa850', hi: '#b4e890', accent: ['#f7b6d0', '#e48db3'] },
    summer: { back: '#a8d4ee', front: '#88ccb0', edge: '#b8e6d0', base: '#4fae55', tree: '#5cbf5a', dark: '#3d9147', hi: '#98df80' },
    autumn: { back: '#e8d2b6', front: '#d9b78f', edge: '#efd9bb', base: '#c98b45', tree: '#e0843f', dark: '#b45a2b', hi: '#f3b462', accent: ['#ebb83c', '#c98f22'] },
    winter: { back: '#dde8f4', front: '#c8d8ea', edge: '#f1f6fc', base: '#e8f0f8', tree: '#5f9a7e', dark: '#447a62', hi: '#86bba0', snow: '#ffffff' },
  };

  // 遠丘：後面一道淡色山稜、前面一道稍深的，前稜頂端一排亮邊
  const farBack = (x) => 24 + wave(x, [[6, 2, 0.3], [3, 5, 1.1], [1.5, 9, 2.4]]);
  const farFront = (x) => 15 + wave(x, [[5, 3, 2.0], [2, 7, 0.4], [1, 11, 1.7]]);
  function farHills(pal) {
    const c = makeCanvas(W, H);
    for (let x = 0; x < W; x++) {
      const b = Math.round(farBack(x));
      const f = Math.round(farFront(x));
      for (let y = H - b; y < H; y++) c.px(x, y, pal.back);
      for (let y = H - f; y < H; y++) c.px(x, y, y === H - f ? pal.edge : pal.front);
    }
    return c;
  }

  // 近丘：緩坡地面＋一排大小不一的圓樹冠（固定的亂數，每次產生都一樣）
  const nearBase = (x) => 9 + wave(x, [[3, 2, 1.3], [1.5, 5, 0.2]]);
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const TREES = [];
  for (let x = 4; x < W; x += 9 + Math.floor(rand() * 6)) TREES.push({ x, r: 4 + Math.floor(rand() * 4), tint: rand() });

  function nearHills(pal) {
    const c = makeCanvas(W, H);
    // 樹冠：圓心在地面上方，左上亮、右下暗；春秋有一部分換成花色／金黃
    for (const t of TREES) {
      const cy = H - nearBase(t.x) - t.r * 0.6;
      const useAccent = pal.accent && t.tint < 0.35;
      const [main, shade] = useAccent ? pal.accent : [pal.tree, pal.dark];
      for (const off of [-W, 0, W]) {
        for (let y = Math.floor(cy - t.r); y <= cy + t.r; y++) {
          for (let x = Math.floor(t.x - t.r); x <= t.x + t.r; x++) {
            const dx = (x - t.x) / t.r, dy = (y - cy) / t.r;
            const d = Math.hypot(dx, dy);
            if (d > 1) continue;
            let col = main;
            if (dx + dy > 0.55 || d > 0.92) col = shade;
            else if (dx + dy < -0.9 && d < 0.8) col = pal.hi;
            if (pal.snow && dy < -0.45 && d < 0.98) col = pal.snow; // 冬天樹頂積雪
            c.px(x + off, y, col);
          }
        }
      }
    }
    // 地面蓋在樹幹位置上，最上面一排亮邊
    for (let x = 0; x < W; x++) {
      const g = Math.round(nearBase(x));
      for (let y = H - g; y < H; y++) c.px(x, y, y === H - g ? (pal.snow || pal.hi) : pal.base);
    }
    return c;
  }

  for (const [name, pal] of Object.entries(SEASONS)) {
    svgFrames(`hills-far-${name}`, [farHills(pal)]);
    if (name !== 'summer') svgFrames(`hills-near-${name}`, [nearHills(pal)]); // 夏天是海邊，前面是海不是丘陵
  }
}
