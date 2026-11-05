/* ---------- 圖片拼接（atlas）與切割 ----------
   slice：把網站上現有的拼接圖切回一塊塊部件（rotated 的轉正），方便換圖、改中心點、重新拼。
   pack ：把很多張部件排進一張圖（部件之間留 2px），回傳每塊的位置 rect。匯出時一律 rotated: false。 */
"use strict";

const Atlas = (() => {
  const PAD = 2, MAX = 2048;
  const bitmapCache = new WeakMap();   // Blob → ImageBitmap（同一張圖不重複解碼）

  async function bitmap(blob) {
    if (!blob) return null;
    if (!bitmapCache.has(blob)) bitmapCache.set(blob, createImageBitmap(blob));
    return bitmapCache.get(blob);
  }
  const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
  const toBlob = (c) => new Promise((res) => c.toBlob(res, "image/png"));

  /* 拼接圖 → { 部件名稱: Blob } */
  async function slice(part, atlasBlob) {
    const out = {}, bmp = await bitmap(atlasBlob);
    if (!bmp) return out;
    for (const [name, sp] of Object.entries(part.sprites || {})) {
      if (!sp || !sp.rect) continue;
      const [sx, sy, w, h] = sp.rect, c = canvas(w, h), g = c.getContext("2d");
      if (sp.rotated) { g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2); g.drawImage(bmp, sx, sy, h, w, -h / 2, -w / 2, h, w); }
      else g.drawImage(bmp, sx, sy, w, h, 0, 0, w, h);
      out[name] = await toBlob(c);
    }
    return out;
  }

  /* 架子排法：由高到矮排，一列放不下就換下一列。寬度從「總面積開根號」開始試，找最接近正方形的結果 */
  function layout(items) {
    const sorted = items.slice().sort((a, b) => b.h - a.h || b.w - a.w);
    const area = items.reduce((s, it) => s + (it.w + PAD) * (it.h + PAD), 0);
    const widest = Math.max(1, ...items.map((it) => it.w + PAD * 2));
    let best = null;
    for (let k = 0.8; k <= 2.01; k += 0.2) {
      const W = Math.max(widest, Math.ceil(Math.sqrt(area) * k));
      let x = PAD, y = PAD, rowH = 0, usedW = 0;
      const pos = new Map();
      for (const it of sorted) {
        if (x + it.w + PAD > W) { x = PAD; y += rowH + PAD; rowH = 0; }
        pos.set(it.name, [x, y, it.w, it.h]);
        x += it.w + PAD; rowH = Math.max(rowH, it.h); usedW = Math.max(usedW, x);
      }
      const H = y + rowH + PAD, score = Math.max(usedW, H);
      if (!best || score < best.score) best = { score, W: usedW, H, pos };
    }
    return best || { W: 1, H: 1, pos: new Map() };
  }

  /* blobs：{ 名稱: Blob } → { blob, w, h, rects: { 名稱: [x, y, w, h] }, tooBig } */
  async function pack(blobs) {
    const items = [];
    for (const [name, b] of Object.entries(blobs)) { const bmp = await bitmap(b); if (bmp) items.push({ name, w: bmp.width, h: bmp.height, bmp }); }
    const L = layout(items), c = canvas(L.W, L.H), g = c.getContext("2d"), rects = {};
    for (const it of items) { const r = L.pos.get(it.name); g.drawImage(it.bmp, r[0], r[1]); rects[it.name] = r; }
    return { blob: await toBlob(c), w: c.width, h: c.height, rects, tooBig: c.width > MAX || c.height > MAX };
  }

  /* 把透明的邊裁掉 → { canvas, dx, dy }（dx、dy＝裁掉了左邊、上邊多少，用來保持中心點位置） */
  function trim(src) {
    const w = src.width, h = src.height, d = src.getContext("2d").getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return { canvas: canvas(1, 1), dx: 0, dy: 0 };
    const c = canvas(x1 - x0 + 1, y1 - y0 + 1); c.getContext("2d").drawImage(src, -x0, -y0);
    return { canvas: c, dx: x0, dy: y0 };
  }

  async function blobToCanvas(blob) { const b = await bitmap(blob), c = canvas(b.width, b.height); c.getContext("2d").drawImage(b, 0, 0); return c; }

  return { slice, pack, layout, trim, bitmap, canvas, toBlob, blobToCanvas, PAD, MAX };
})();
