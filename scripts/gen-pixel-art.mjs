// 產生 public/pixel/ 的像素圖（冒險風格的角色與場景）。全部是原創點陣，無外部素材。
// 用法：node scripts/gen-pixel-art.mjs [輸出資料夾，預設 public/pixel]
//   scripts/pixel-art/lib.mjs         調色盤、點陣 → SVG、角色畫布 DSL
//   scripts/pixel-art/characters.mjs  勇者與怪物（改角色改這裡）
//   scripts/pixel-art/scenery.mjs     場景圖塊與四季換色（改地形改這裡）
import './pixel-art/characters.mjs';
import './pixel-art/scenery.mjs';
