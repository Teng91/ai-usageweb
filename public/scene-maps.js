// 冒險風格的四季地圖資料（春夏秋冬輪流）。只放資料：每個項目是一個元素的 class 與位置，外觀在 scene.css。
// 加地圖：在 MAPS 加一筆，id 也要在 scene.css 加天空顏色（[data-map="..."]）。
// side: true 的東西放在卡片兩側的空白（螢幕不夠寬時 CSS 會藏起來），平台與天上的怪物都要標 side。

const PF_H = 32; // 平台高度（8 格 × 4）
const onPf = (pfBottom) => `calc(${pfBottom} + ${PF_H - 4}px)`; // 站在平台上的高度
const GROUND = '52px';

// 卡片區最寬 1440px＋左右 16px，兩側剩下的空白寬度；平台與天上的怪物只放在這裡，才不會被卡片擋住
const SIDE = 'max(0px, (100vw - 1472px) / 2)';
// 左側空白裡、右緣距離卡片 gap px 的位置（w＝元素寬度）；right 版本同理
const inLeft = (w, gap = 16) => `calc(${SIDE} - ${w + gap}px)`;
const inRight = inLeft;
const PF_W = 144; // 平台寬度

// 春夏秋冬四季輪流；櫻花、楓紅、金黃的樹由產生器換色
// side: true 的東西放在卡片兩側的空白，螢幕不夠寬時 CSS 會藏起來
export const MAPS = [
  {
    id: 'spring',
    name: '春・櫻花村',
    items: [
      { cls: 'sc-mountains' },
      { cls: 'sc-ground ground-grass' },
      { cls: 'sc-house', s: { left: '2.5%', bottom: GROUND } },
      { cls: 'sc-tree blossom', s: { left: 'calc(2.5% + 150px)', bottom: GROUND, width: '80px', height: '95px' } },
      { cls: 'sc-tree blossom', s: { right: 'calc(3% + 90px)', bottom: GROUND, width: '96px', height: '114px' } },
      { cls: 'sc-tree', s: { right: 'calc(3% + 190px)', bottom: GROUND, width: '64px', height: '76px' } },
      { side: true, cls: 'sc-pf pf-grass', s: { left: inLeft(PF_W), bottom: '38vh', width: `${PF_W}px` } },
      { side: true, cls: 'sc-ladder', s: { left: inLeft(40), bottom: GROUND, height: 'calc(38vh - 52px)' } },
      { side: true, cls: 'sc-pf pf-grass', s: { right: inRight(PF_W), bottom: '54vh', width: `${PF_W}px` } },
      { side: true, cls: 'sc-rope', s: { right: inRight(30), bottom: GROUND, height: 'calc(54vh - 52px)' } },
      { side: true, mon: 'slime-pink', s: { left: inLeft(PF_W - 20), bottom: onPf('38vh') } },
      { side: true, mon: 'chick', s: { right: inRight(PF_W - 30), bottom: onPf('54vh') } },
      { side: true, mon: 'cloudling', s: { left: inLeft(110), top: '16%' } },
      { mon: 'slime', s: { right: '24%', bottom: GROUND } },
      { mon: 'leafling', s: { left: '30%', bottom: GROUND } },
      { cls: 'sc-petals' },
    ],
  },
  {
    id: 'summer',
    name: '夏・海邊碼頭',
    items: [
      { cls: 'sc-sun' },
      { cls: 'sc-sea' },
      { cls: 'sc-boat', s: { left: '18%', bottom: '96px' } },
      { cls: 'sc-dock', s: { right: '0', bottom: '104px', width: '34%' } },
      { cls: 'sc-ground ground-sand' },
      { cls: 'sc-palm', s: { left: '3%', bottom: GROUND, width: '96px', height: '96px' } },
      { cls: 'sc-palm', s: { left: 'calc(3% + 110px)', bottom: GROUND, width: '72px', height: '72px' } },
      { cls: 'sc-palm', s: { right: 'calc(3% + 100px)', bottom: GROUND, width: '88px', height: '88px' } },
      { side: true, cls: 'sc-pf pf-wood', s: { left: inLeft(PF_W), bottom: '44vh', width: `${PF_W}px` } },
      { side: true, cls: 'sc-rope', s: { left: inLeft(30), bottom: GROUND, height: 'calc(44vh - 52px)' } },
      { side: true, mon: 'leafling', s: { left: inLeft(PF_W - 10), bottom: onPf('44vh') } },
      { side: true, mon: 'cloudling', s: { right: inRight(100), top: '14%' } },
      { side: true, mon: 'cloudling', s: { left: inLeft(90), top: '22%' }, small: true, delay: '-2s' },
      { mon: 'crab', s: { left: '28%', bottom: GROUND } },
      { mon: 'crab', s: { right: '24%', bottom: GROUND }, delay: '-1.4s' },
    ],
  },
  {
    id: 'autumn',
    name: '秋・楓葉林',
    items: [
      { cls: 'sc-mountains autumn-hills' },
      { cls: 'sc-ground ground-grass autumn-grass' },
      { cls: 'sc-tree maple', s: { left: '2.5%', bottom: GROUND, width: '96px', height: '114px' } },
      { cls: 'sc-tree maple-gold', s: { left: 'calc(2.5% + 90px)', bottom: GROUND, width: '72px', height: '86px' } },
      { cls: 'sc-tree maple', s: { left: 'calc(2.5% + 170px)', bottom: GROUND, width: '64px', height: '76px' } },
      { cls: 'sc-tree maple-gold', s: { right: 'calc(3% + 90px)', bottom: GROUND, width: '96px', height: '114px' } },
      { cls: 'sc-tree maple', s: { right: 'calc(3% + 190px)', bottom: GROUND, width: '72px', height: '86px' } },
      { side: true, cls: 'sc-pf pf-grass autumn-grass', s: { left: inLeft(PF_W), bottom: '48vh', width: `${PF_W}px` } },
      { side: true, cls: 'sc-ladder', s: { left: inLeft(40), bottom: GROUND, height: 'calc(48vh - 52px)' } },
      { side: true, cls: 'sc-pf pf-grass autumn-grass', s: { right: inRight(PF_W), bottom: '36vh', width: `${PF_W}px` } },
      { side: true, cls: 'sc-rope', s: { right: inRight(30), bottom: GROUND, height: 'calc(36vh - 52px)' } },
      { side: true, mon: 'chick', s: { left: inLeft(PF_W - 20), bottom: onPf('48vh') } },
      { side: true, mon: 'slime', s: { right: inRight(PF_W - 20), bottom: onPf('36vh') } },
      { side: true, mon: 'cloudling', s: { right: inRight(100), top: '14%' } },
      { mon: 'leafling', s: { left: '28%', bottom: GROUND } },
      { mon: 'leafling', s: { right: '26%', bottom: GROUND }, delay: '-4s' },
      { cls: 'sc-leaves' },
    ],
  },
  {
    id: 'winter',
    name: '冬・雪山小鎮',
    items: [
      { cls: 'sc-mountains snowy' },
      { cls: 'sc-ground ground-snow' },
      { cls: 'sc-house snowy-house', s: { left: '2.5%', bottom: GROUND } },
      { cls: 'sc-pine', s: { left: 'calc(2.5% + 150px)', bottom: GROUND, width: '80px', height: '85px' } },
      { cls: 'sc-pine', s: { left: 'calc(2.5% + 220px)', bottom: GROUND, width: '56px', height: '60px' } },
      { cls: 'sc-pine', s: { right: 'calc(3% + 90px)', bottom: GROUND, width: '96px', height: '102px' } },
      { cls: 'sc-snowman', s: { left: '24%', bottom: GROUND } },
      { side: true, cls: 'sc-pf pf-snow', s: { right: inRight(PF_W), bottom: '42vh', width: `${PF_W}px` } },
      { side: true, cls: 'sc-ladder', s: { right: inRight(40), bottom: GROUND, height: 'calc(42vh - 52px)' } },
      { side: true, cls: 'sc-pf pf-snow', s: { left: inLeft(PF_W), bottom: '56vh', width: `${PF_W}px` } },
      { side: true, mon: 'slime-pink', s: { right: inRight(PF_W - 20), bottom: onPf('42vh') } },
      { side: true, mon: 'leafling', s: { left: inLeft(PF_W - 10), bottom: onPf('56vh') } },
      { side: true, mon: 'cloudling', s: { left: inLeft(100), top: '18%' } },
      { mon: 'chick', s: { left: '34%', bottom: GROUND } },
      { cls: 'sc-snowfall' },
    ],
  },
];
