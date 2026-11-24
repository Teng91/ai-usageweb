// 冒險風格的像素場景：春夏秋冬四張地圖輪流、小勇者走到傳送點就換地圖、怪物可以點、只看風景模式、快捷鍵
// 只在 <html data-skin="adventure"> 時動作；所有圖都是 /pixel/ 底下的原創像素圖

const root = document.documentElement;
const sceneEl = document.getElementById('scene');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const HERO_SPEED = 70; // px／秒
const POP_TEXTS = ['+10 經驗', '+5 經驗', '+20 經驗', '閃避！', '♥', '+1 金幣'];

const isAdventure = () => root.dataset.skin === 'adventure';

// ---------- 地圖定義：位置用 CSS 字串，元素外觀交給 skin-adventure.css ----------
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
const MAPS = [
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

// ---------- 建立 DOM ----------
function el(cls, style) {
  const d = document.createElement('div');
  d.className = cls;
  if (style) Object.assign(d.style, style);
  return d;
}

let mapIndex = 0;

// 地圖圖層等第一次切到冒險風格才建立；選簡約風格的人不會多出這些元素
const mapEls = [];

function buildMaps() {
  if (mapEls.length) return;
  for (const m of MAPS) {
    const layer = el(`map map-${m.id}`);
    layer.dataset.map = m.id;
    for (const it of m.items) {
      if (it.mon) {
        const mon = el(`mon mon-${it.mon}${it.small ? ' small' : ''}${it.side ? ' side' : ''}`, it.s);
        if (it.delay) mon.style.animationDelay = it.delay;
        mon.dataset.mon = it.mon;
        layer.append(mon);
      } else {
        layer.append(el(it.side ? `${it.cls} side` : it.cls, it.s));
      }
    }
    sceneEl.insertBefore(layer, flies); // 地圖在勇者、傳送點、螢火蟲的下面
    mapEls.push(layer);
  }
  mapEls.forEach((m, j) => m.classList.toggle('active', j === mapIndex));
}

const flies = el('sc-flies');
for (let i = 1; i <= 6; i++) flies.append(el(`sc-fly f${i}`));
const portal = el('sc-portal');
portal.title = '傳送點：點一下換地圖';
const hero = el('sc-hero');
hero.title = '點我跳一下';
const fade = el('sc-fade');
sceneEl.append(flies, portal, hero, fade);

// 地圖名稱的牌子（放在場景外，才會蓋在卡片上面）
const plaque = document.createElement('div');
plaque.className = 'map-name';
plaque.setAttribute('aria-live', 'polite');
document.body.append(plaque);

// ---------- 換地圖 ----------

function showMap(i, { announce = true } = {}) {
  mapIndex = (i + MAPS.length) % MAPS.length;
  mapEls.forEach((m, j) => m.classList.toggle('active', j === mapIndex));
  root.dataset.map = MAPS[mapIndex].id;
  if (announce && isAdventure()) {
    plaque.textContent = MAPS[mapIndex].name;
    plaque.classList.remove('show');
    void plaque.offsetWidth; // 重新觸發動畫
    plaque.classList.add('show');
  }
}

// ---------- 小勇者：走到傳送點 → 被吸進去 → 換地圖 → 從左邊重新出發 ----------
let walkTimer = null;
let warping = false;

function heroTargetX() {
  const p = portal.getBoundingClientRect();
  const startLeft = -80; // .sc-hero 的 left
  return p.left + p.width / 2 - 32 - startLeft;
}

function startWalk() {
  if (isAdventure()) buildMaps();
  clearTimeout(walkTimer);
  warping = false;
  hero.classList.remove('warp', 'walking');
  hero.style.transition = 'none';
  hero.style.transform = 'translateX(0)';
  if (!isAdventure() || reduceMotion.matches || document.hidden) {
    if (reduceMotion.matches) hero.style.transform = 'translateX(30vw)';
    return;
  }
  void hero.offsetWidth;
  const target = heroTargetX();
  hero.classList.add('walking');
  hero.style.transition = `transform ${Math.max(4, target / HERO_SPEED)}s linear`;
  hero.style.transform = `translateX(${target}px)`;
}

function warp() {
  if (warping) return;
  warping = true;
  clearTimeout(walkTimer);
  hero.classList.remove('walking');
  hero.classList.add('warp');
  portal.classList.add('active');
  walkTimer = setTimeout(() => {
    fade.classList.add('on');
    walkTimer = setTimeout(() => {
      showMap(mapIndex + 1);
      portal.classList.remove('active');
      fade.classList.remove('on');
      walkTimer = setTimeout(startWalk, 500);
    }, 450);
  }, 650);
}

hero.addEventListener('transitionend', (e) => {
  if (e.propertyName === 'transform' && hero.classList.contains('walking')) warp();
});

// ---------- 互動：點怪物、點勇者、點傳送點 ----------
function pop(x, y, text) {
  const p = el('sc-pop');
  p.textContent = text;
  p.style.left = `${x}px`;
  p.style.top = `${y}px`;
  sceneEl.append(p);
  p.addEventListener('animationend', () => p.remove());
}

sceneEl.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  const r = t.getBoundingClientRect();
  if (t.classList.contains('mon')) {
    t.classList.remove('hit');
    void t.offsetWidth;
    t.classList.add('hit');
    pop(r.left + r.width / 2, r.top, POP_TEXTS[Math.floor(Math.random() * POP_TEXTS.length)]);
  } else if (t === hero) {
    hero.classList.remove('jump');
    void hero.offsetWidth;
    hero.classList.add('jump');
    pop(r.left + r.width / 2, r.top, '嘿！');
  } else if (t === portal) {
    if (reduceMotion.matches) showMap(mapIndex + 1);
    else warp();
  }
});

sceneEl.addEventListener('animationend', (e) => {
  const t = e.target;
  if (t instanceof HTMLElement && (e.animationName === 'mon-hit' || e.animationName === 'hero-jump')) {
    t.classList.remove('hit', 'jump');
  }
});

// ---------- 只看風景 ----------
const bgBtn = document.getElementById('bg-btn');
const bgExit = document.getElementById('bg-exit');

function setBgOnly(on) {
  if (on) root.dataset.bgonly = '1';
  else delete root.dataset.bgonly;
  bgExit.hidden = !on;
  if (on) bgExit.focus();
  else bgBtn.focus();
}

bgBtn.addEventListener('click', () => setBgOnly(true));
bgExit.addEventListener('click', () => setBgOnly(false));

// 只看風景時，點兩下背景（不是點怪物、勇者、傳送點）也能回來；手機上不一定有 dblclick，自己算兩次點擊
let lastTap = { t: 0, x: 0, y: 0 };
document.addEventListener('pointerup', (e) => {
  if (!root.dataset.bgonly) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.classList.contains('mon') || t === hero || t === portal || t === bgExit)) return;
  const now = Date.now();
  if (now - lastTap.t < 400 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
    lastTap.t = 0;
    setBgOnly(false);
  } else {
    lastTap = { t: now, x: e.clientX, y: e.clientY };
  }
});

// ---------- 快捷鍵（冒險風格的快捷欄）：B 風景、M 換地圖、T 白天／夜晚、S 換風格、Esc 回來 ----------
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'escape' && root.dataset.bgonly) { setBgOnly(false); return; }
  if (k === 's') { document.getElementById('skin-btn').click(); return; }
  if (!isAdventure()) return;
  if (k === 'b') setBgOnly(!root.dataset.bgonly);
  else if (k === 'm') { if (reduceMotion.matches) showMap(mapIndex + 1); else warp(); }
  else if (k === 't') document.getElementById('theme-btn').click();
});

// ---------- 切換風格、切到背景、視窗大小改變時重新開始 ----------
new MutationObserver(() => {
  if (!isAdventure() && root.dataset.bgonly) setBgOnly(false);
  startWalk();
}).observe(root, { attributes: true, attributeFilter: ['data-skin'] });

document.addEventListener('visibilitychange', () => { if (!document.hidden) startWalk(); });
reduceMotion.addEventListener('change', startWalk);
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (!warping) startWalk(); }, 300);
});

showMap(0, { announce: false });
startWalk();
