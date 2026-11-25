// 冒險風格的原創場景圖塊（文字點陣）：樹、屋子、雲、草地、遠山、傳送點、平台、海、雪地，以及四季換色版本。
import { svg } from './lib.mjs';

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
