/* ---------- 角色預覽（畫部件、播放動畫） ----------
   畫法跟網站一樣（src/js-03-unit.js 的 itemsOf）：
     每一格依序畫每一項 [圖層, 部件編號, 變換, 顏色]，實際變換＝這一格的變換 × 部件自己的 m。
   站位：用待機動畫的範圍置中、腳底踩在地面線上（網站也是用待機決定大小與站位）。 */
"use strict";

class Player {
  constructor(canvas) {
    this.cv = canvas; this.g = canvas.getContext("2d");
    this.part = null; this.sprites = new Map();
    this.anim = null; this.pos = 0; this.playing = true; this.speed = 1; this.zoom = 1;
    this.bg = "checker"; this.showGround = true; this.marker = null;
    this.onFrame = null; this.last = 0;
    new ResizeObserver(() => this.fit()).observe(canvas);
    requestAnimationFrame((t) => this.tick(t));
  }

  /* 換角色：part＝units 檔裡的一組部件（body），atlasBlob＝拼接圖 */
  async setPart(part, atlasBlob) {
    this.part = part || null; this.sprites.clear(); this.bounds = null;
    if (!part) { this.anim = null; return; }
    if (atlasBlob) {
      const bmp = await createImageBitmap(atlasBlob);
      for (const im of part.images) {
        const sp = part.sprites[im.name];
        if (!sp || !sp.rect) continue;
        const [sx, sy, w, h] = sp.rect, c = new OffscreenCanvas(Math.max(1, w), Math.max(1, h)), g = c.getContext("2d");
        // rotated：這塊在拼接圖上是轉 90 度存的（官方素材），切下來時轉回來
        if (sp.rotated) { g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2); g.drawImage(bmp, sx, sy, h, w, -h / 2, -w / 2, h, w); }
        else g.drawImage(bmp, sx, sy, w, h, 0, 0, w, h);
        this.sprites.set(im.name, c);
      }
    }
    const idle = part.animations.idle || part.animations.wait || Object.values(part.animations)[0];
    this.bounds = idle ? this.boundsOf(idle.frames) : null;
    if (!this.anim || !part.animations[this.anim]) this.anim = part.animations.idle ? "idle" : Object.keys(part.animations)[0] || null;
    this.pos = 0;
  }

  // 一格裡每個部件的最終變換
  items(frame) {
    const out = [], P = this.part;
    for (const it of frame || []) {
      const def = P.images[it[1]], om = it[2], col = it[3];
      if (!def || !Array.isArray(om)) continue;
      const sp = P.sprites[def.name]; if (!sp || !sp.rect) continue;
      const alpha = (Array.isArray(col) && col.length > 3 ? col[3] : 255) / 255;
      const [m00, m01, m10, m11, m02, m12] = om, [i00, i01, i10, i11, i02, i12] = def.m || [1, 0, 0, 1, 0, 0];
      out.push({ name: def.name, alpha, w: sp.rect[2], h: sp.rect[3],
        A: m00 * i00 + m01 * i10, B: m00 * i01 + m01 * i11, C: m00 * i02 + m01 * i12 + m02,
        D: m10 * i00 + m11 * i10, E: m10 * i01 + m11 * i11, F: m10 * i02 + m11 * i12 + m12 });
    }
    return out;
  }
  boundsOf(frames) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const fr of frames) for (const t of this.items(fr)) {
      if (t.alpha < 0.12) continue;
      for (const [px, py] of [[0, 0], [t.w, 0], [0, t.h], [t.w, t.h]]) {
        const x = t.A * px + t.B * py + t.C, y = t.D * px + t.E * py + t.F;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    return isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -50, y0: -100, x1: 50, y1: 0 };
  }

  fit() {
    const r = this.cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    this.cv.width = Math.max(10, Math.round(r.width * dpr)); this.cv.height = Math.max(10, Math.round(r.height * dpr));
  }
  get clip() { return this.part && this.anim ? this.part.animations[this.anim] : null; }
  get frameCount() { return this.clip ? this.clip.frame_count || this.clip.frames.length : 0; }
  get rate() { return (this.part && this.part.anim_rate) || 30; }
  get frame() { return Math.floor(this.pos) % Math.max(1, this.frameCount); }
  setAnim(name) { this.anim = name; this.pos = 0; }
  seek(f) { this.pos = clamp(f, 0, Math.max(0, this.frameCount - 1)); this.playing = false; }

  tick(t) {
    const dt = this.last ? Math.min(0.1, (t - this.last) / 1000) : 0; this.last = t;
    if (this.playing && this.frameCount) this.pos = (this.pos + dt * this.rate * this.speed) % this.frameCount;
    this.draw();
    if (this.onFrame) this.onFrame(this.frame);
    requestAnimationFrame((tt) => this.tick(tt));
  }

  /* 目前這一格畫成透明背景的圖（頭像擷取用）：只取角色的範圍，放大 2 倍比較清楚 */
  async snapshot(scale = 2) {
    const clip = this.clip; if (!clip) return null;
    const items = this.items(clip.frames[this.frame]), b = this.boundsOf([clip.frames[this.frame]]), pad = 6;
    const c = document.createElement("canvas"); c.width = Math.ceil((b.x1 - b.x0) * scale + pad * 2); c.height = Math.ceil((b.y1 - b.y0) * scale + pad * 2);
    const g = c.getContext("2d"); g.translate(pad, pad); g.scale(scale, scale); g.translate(-b.x0, -b.y0);
    for (const t of items) { const img = this.sprites.get(t.name); if (!img || t.alpha <= 0) continue; g.save(); g.globalAlpha = Math.min(1, t.alpha); g.transform(t.A, t.D, t.B, t.E, t.C, t.F); g.drawImage(img, 0, 0); g.restore(); }
    return new Promise((res) => c.toBlob(res, "image/png"));
  }

  draw() {
    const g = this.g, W = this.cv.width, H = this.cv.height, css = getComputedStyle(this.cv);
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.bg === "checker") {
      const s = 12 * (W / this.cv.clientWidth || 1), a = css.getPropertyValue("--chk-a").trim() || "#ddd", b = css.getPropertyValue("--chk-b").trim() || "#eee";
      g.fillStyle = a; g.fillRect(0, 0, W, H); g.fillStyle = b;
      for (let y = 0; y < H; y += s) for (let x = ((y / s) % 2) * s; x < W; x += 2 * s) g.fillRect(x, y, s, s);
    } else { g.fillStyle = this.bg; g.fillRect(0, 0, W, H); }
    const groundY = H * 0.82;
    if (this.showGround) {
      g.strokeStyle = css.getPropertyValue("--ground").trim() || "#888"; g.lineWidth = Math.max(1, W / 500);
      g.setLineDash([6, 6]); g.beginPath(); g.moveTo(0, groundY); g.lineTo(W, groundY); g.stroke(); g.setLineDash([]);
    }
    const clip = this.clip;
    if (!clip || !this.bounds) {
      g.fillStyle = css.getPropertyValue("--muted").trim() || "#888"; g.font = `${Math.round(H / 18)}px sans-serif`; g.textAlign = "center";
      g.fillText(this.part ? "這段動畫沒有影格" : "還沒有部件：到「部件」分頁上傳圖片", W / 2, H / 2);
      return;
    }
    // 角色高度佔畫面 62%（可以用縮放調整）
    const b = this.bounds, bh = Math.max(20, b.y1 - b.y0), k = (H * 0.62 / bh) * this.zoom;
    g.translate(W / 2, groundY); g.scale(k, k); g.translate(-(b.x0 + b.x1) / 2, -b.y1);
    for (const t of this.items(clip.frames[this.frame])) {
      const img = this.sprites.get(t.name); if (!img || t.alpha <= 0) continue;
      g.save(); g.globalAlpha = Math.min(1, t.alpha); g.transform(t.A, t.D, t.B, t.E, t.C, t.F); g.drawImage(img, 0, 0); g.restore();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    // 出手時機的提示：這一格是出手格時閃一下
    if (this.marker && this.marker(this.anim, this.frame)) {
      g.fillStyle = css.getPropertyValue("--hit").trim() || "#f60"; g.globalAlpha = 0.9;
      g.font = `bold ${Math.round(H / 14)}px sans-serif`; g.textAlign = "center"; g.fillText("出手！", W / 2, H * 0.12); g.globalAlpha = 1;
    }
  }
}
