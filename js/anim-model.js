/* ---------- 動畫資料模型：關鍵影格 ↔ 網站的逐格動畫 ----------
   網站的動畫是「逐格」存的：每一格列出每個部件的矩陣。編輯時改成「圖層＋關鍵影格」：
     P.anim[組名] = { clips: { 名稱: Clip } }
     Clip  = { n 格數, ready 準備段格數（null＝沒有，出手在一半）, tracks: [Track] }
     Track = { id 圖層編號, keys: [Key] }   （id 就是網站逐格資料的第 1 欄「圖層編號」）
     Key   = { f 第幾格, img 部件編號, x, y 位置, r 旋轉（度，正＝順時針）, sx, sy 縮放, sh 斜切, a 透明度 0～1,
               v 看得到嗎, z 前後順序（數字大的畫在前面）, e 補間：l 線性／e 緩入緩出／s 不補間（跳格） }
   關鍵影格之間自動補間；img、v、z 不補間（用前一個關鍵影格的值）。
   出手時機（v7.2 以前就有的規則）：設了出手格的動作，匯出時拆成 X_ready（準備）＋ X_all（完整）＋ X（揮下），
   讓網站算出「準備段結束後再過剩下的 30%」＝ 你指定的那一格。 */
"use strict";

const AnimModel = (() => {
  const BASES = ["attack", "s_attack", "s2_attack"];   // 可以設出手格的動作

  /* ---- 矩陣 ↔ 位置、旋轉、縮放、斜切 ----
     網站矩陣 [m00, m01, m10, m11, x, y]：x' = m00·x + m01·y + x
     拆成 R(θ) · [[sx, sh], [0, sy]]，可以完全還原（sy 是負的＝上下翻轉） */
  function decompose(m) {
    const [a, b, c, d, x, y] = m, sx = Math.hypot(a, c), t = Math.atan2(c, a), cs = Math.cos(t), sn = Math.sin(t);
    return { x, y, r: t * 180 / Math.PI, sx, sh: cs * b + sn * d, sy: -sn * b + cs * d };
  }
  function compose(k) {
    const t = (k.r || 0) * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t), sx = k.sx ?? 1, sy = k.sy ?? 1, sh = k.sh || 0;
    const r3 = (v) => Math.round(v * 1000) / 1000, r2 = (v) => Math.round(v * 100) / 100;
    return [r3(cs * sx), r3(cs * sh - sn * sy), r3(sn * sx), r3(sn * sh + cs * sy), r2(k.x), r2(k.y)];
  }

  /* ---- 某一格的狀態（補間） ---- */
  const ease = (t) => t * t * (3 - 2 * t);
  const lerpAngle = (a, b, t) => { let d = ((b - a) % 360 + 540) % 360 - 180; return a + d * t; };
  function stateAt(track, f) {
    const ks = track.keys;
    if (!ks.length || f < ks[0].f) return null;
    let i = ks.length - 1; while (i > 0 && ks[i].f > f) i--;
    const k0 = ks[i], k1 = ks[i + 1];
    if (!k1 || k0.e === "s" || k0.f === f) return k0;
    let t = (f - k0.f) / (k1.f - k0.f); if (k0.e === "e") t = ease(t);
    const L = (p, d) => (k0[p] ?? d) + ((k1[p] ?? d) - (k0[p] ?? d)) * t;
    return { f, img: k0.img, v: k0.v, z: k0.z, e: k0.e, x: L("x", 0), y: L("y", 0), r: lerpAngle(k0.r || 0, k1.r || 0, t), sx: L("sx", 1), sy: L("sy", 1), sh: L("sh", 0), a: L("a", 1) };
  }

  /* ---- 關鍵影格 → 逐格 ---- */
  function bakeFrame(clip, f) {
    const items = [];
    clip.tracks.forEach((tr, ti) => {
      const s = stateAt(tr, f);
      if (!s || !s.v) return;
      items.push({ z: s.z ?? ti, ti, row: [tr.id, s.img, compose(s), [255, 255, 255, Math.round(clamp(s.a, 0, 1) * 255)]] });
    });
    items.sort((p, q) => p.z - q.z || p.ti - q.ti);
    return items.map((it) => it.row);
  }
  const bakeClip = (clip) => Array.from({ length: clip.n }, (_, f) => bakeFrame(clip, f));

  // 出手格 ↔ 準備段長度 R：出手＝ R + 0.3 × (n − R)（網站的算法，見 js-11 的 hitFrac；比例限制在 0.2～0.9）
  const readyLen = (n, hit) => clamp(Math.round((hit - 0.3 * n) / 0.7), 1, n - 1);
  const hitOf = (n, R) => (R == null ? Math.floor(n * 0.5) : Math.floor(clamp((R + 0.3 * (n - R)) / n, 0.2, 0.9) * n));
  const minHit = (n) => hitOf(n, 1), maxHit = (n) => hitOf(n, n - 1);

  /* 整組動畫 → 網站的 animations（設了出手格的動作拆成 _ready、_all 和本體） */
  function bakeAll(group) {
    const out = {};
    for (const [name, clip] of Object.entries(group.clips)) {
      const frames = bakeClip(clip);
      if (clip.ready != null && BASES.includes(name) && clip.n >= 3) {
        const R = clamp(clip.ready, 1, clip.n - 1);
        out[name + "_all"] = { frame_count: clip.n, frames };
        out[name + "_ready"] = { frame_count: R, frames: frames.slice(0, R) };
        out[name] = { frame_count: clip.n - R, frames: frames.slice(R) };
      } else out[name] = { frame_count: clip.n, frames };
    }
    return out;
  }

  /* ---- 逐格 → 關鍵影格（讀進來的角色） ----
     每一格每個圖層都先記一個關鍵影格，再把「可以由前後補間算出來」的刪掉（誤差極小，等於無損）。 */
  function importClip(anim) {
    const frames = anim.frames || [], n = anim.frame_count || frames.length, byId = new Map(), order = [];
    frames.forEach((fr, f) => {
      const seen = new Set();
      fr.forEach((it, idx) => {
        const id = it[0];
        if (!byId.has(id)) { byId.set(id, []); order.push(id); }
        const d = decompose(it[2]), a = (Array.isArray(it[3]) && it[3].length > 3 ? it[3][3] : 255) / 255;
        byId.get(id).push(Object.assign(d, { f, img: it[1], a, v: true, z: idx, e: "l" }));
        seen.add(id);
      });
      // 這一格沒出現的圖層：記成「看不到」
      for (const id of order) if (!seen.has(id)) { const ks = byId.get(id), last = ks[ks.length - 1]; if (last && last.v) ks.push(Object.assign({}, last, { f, v: false })); }
    });
    const tracks = order.map((id) => ({ id, keys: simplify(byId.get(id), TOL_EXACT) }));
    return { n, ready: null, tracks };
  }
  const TOL_EXACT = { p: 0.02, r: 0.05, s: 0.0015, a: 0.003 }, TOL_LOOSE = { p: 0.6, r: 0.8, s: 0.012, a: 0.02 };
  function same(k, s, tol) {
    return k.img === s.img && k.v === s.v && (k.z ?? 0) === (s.z ?? 0) && Math.abs(k.x - s.x) <= tol.p && Math.abs(k.y - s.y) <= tol.p &&
      Math.abs(((k.r - s.r) % 360 + 540) % 360 - 180) <= tol.r && Math.abs(k.sx - s.sx) <= tol.s && Math.abs(k.sy - s.sy) <= tol.s && Math.abs((k.sh || 0) - (s.sh || 0)) <= tol.s && Math.abs(k.a - s.a) <= tol.a;
  }
  /* 刪掉多餘的關鍵影格：從前往後，能用「上一個保留的」到「下一個」補間算出中間每一格的，就刪 */
  function simplify(keys, tol) {
    if (keys.length <= 2) return keys;
    const out = [keys[0]];
    let i = 1;
    while (i < keys.length) {
      // 盡量往後延伸：找最遠的 j，使 out 最後一個 → keys[j] 的補間能涵蓋中間全部
      let j = i;
      while (j + 1 < keys.length) {
        const A = out[out.length - 1], B = keys[j + 1], test = { keys: [Object.assign({}, A, { e: "l" }), B] };
        let ok = A.v === B.v || true;
        for (let m = i; m <= j && ok; m++) { const s = stateAt(test, keys[m].f); ok = same(keys[m], s, tol); }
        // 看不到／換圖／前後順序改變的那一格一定要保留（step 屬性不能補間）
        if (!ok) break;
        j++;
      }
      if (j > i) { out.push(keys[j]); i = j + 1; }
      else { out.push(keys[i]); i++; }
    }
    return out;
  }

  /* 讀進整組動畫（部件組 part）→ { clips }。X_ready＋X_all 合成一個「設了出手格」的動作 */
  function importGroup(part) {
    const A = part.animations || {}, clips = {}, skip = new Set();
    for (const base of BASES) {
      if (A[base + "_all"] && A[base + "_ready"]) {
        const c = importClip(A[base + "_all"]);
        c.ready = A[base + "_ready"].frame_count;
        clips[base] = c; skip.add(base).add(base + "_all").add(base + "_ready");
      }
    }
    for (const [name, a] of Object.entries(A)) if (!skip.has(name)) clips[name] = importClip(a);
    return { clips };
  }

  /* ---- 新角色：基本姿勢 → 動畫（每段動畫第 0 格都是這個姿勢） ---- */
  function fromPose(pose, names) {
    const base = pose.map((q, z) => ({ f: 0, img: q.i, x: q.x, y: q.y, r: q.r || 0, sx: q.s || 1, sy: q.s || 1, sh: 0, a: q.a ?? 1, v: true, z, e: "e" }));
    const clips = {};
    for (const [name, n] of names) clips[name] = { n, ready: null, tracks: base.map((k, i) => ({ id: i + 1, keys: [Object.assign({}, k)] })) };
    return { clips };
  }

  /* ---- 編輯用小工具 ---- */
  function setKey(track, f, props, base) {
    let k = track.keys.find((x) => x.f === f);
    if (!k) {
      const s = stateAt(track, f) || base || { img: 0, x: 0, y: 0, r: 0, sx: 1, sy: 1, sh: 0, a: 1, v: true, z: track.id, e: "e" };
      k = Object.assign({}, s, { f, e: s.e || "e" });
      track.keys.push(k); track.keys.sort((p, q) => p.f - q.f);
    }
    Object.assign(k, props);
    return k;
  }
  function deleteKey(track, f) { if (track.keys.length > 1) track.keys = track.keys.filter((k) => k.f !== f); }
  // 改格數：拉長／縮短（關鍵影格照比例移動），或只截掉後面
  function resize(clip, n, stretch) {
    n = Math.max(1, Math.round(n));
    for (const tr of clip.tracks) {
      if (stretch && clip.n > 1) { const k = (n - 1) / (clip.n - 1); tr.keys.forEach((x) => (x.f = Math.round(x.f * k))); }
      const seen = new Set(); tr.keys = tr.keys.filter((x) => x.f < n && !seen.has(x.f) && seen.add(x.f));
      if (!tr.keys.length) tr.keys = [];
    }
    if (clip.ready != null) clip.ready = clamp(stretch ? Math.round(clip.ready * n / clip.n) : clip.ready, 1, Math.max(1, n - 1));
    clip.n = n;
  }

  return { decompose, compose, stateAt, bakeFrame, bakeClip, bakeAll, importClip, importGroup, simplify, fromPose, setKey, deleteKey, resize,
    readyLen, hitOf, minHit, maxHit, BASES, TOL_EXACT, TOL_LOOSE };
})();
