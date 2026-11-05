/* ---------- 動畫分頁：舞台（拖曳部件）、時間軸（關鍵影格）、出手時機、檢查提示 ----------
   操作：
     舞台：點部件選取、拖曳移動；拖旋轉把手（部件上方的圓點）轉動。
     時間軸：點格子選圖層與格數；◆＝關鍵影格（空心＝這格看不到）；拖 ◆ 可以移到別格；雙擊空格加關鍵影格。
     鍵盤：← → 上一格／下一格、空白鍵播放、K 加關鍵影格、Delete 刪關鍵影格、Ctrl+Z 復原、Ctrl+C／V 複製貼上整格姿勢。
   改任何東西都會：寫回關鍵影格 → 重新產生逐格動畫（meta）→ 稍後通知其他畫面（換算、預覽）。 */
"use strict";

const AnimUI = (() => {
  const P = () => Store.P;
  const STD = [["idle", "待機", 40], ["walk", "走路", 24], ["attack", "普攻", 16], ["s_attack", "技能1", 24], ["s2_attack", "技能2", 24], ["knockback", "被擊退", 24]];
  const BUL = [["normal", "飛行中", 8], ["finish", "命中／爆炸", 12]];
  const LABEL = Object.fromEntries([...STD, ...BUL].map(([n, l]) => [n, l]));
  const S = { group: "body", clip: null, f: 0, sel: 0, playing: false, onion: true, zoom: 1, cw: 14, undo: [], lastPush: 0, copied: null, bmp: new Map() };
  let stage, tl, side, bar;

  const G = () => P().anim && P().anim[S.group];
  const C = () => G() && G().clips[S.clip];
  const part = () => P().meta.parts[S.group];
  const tr = () => C() && C().tracks[S.sel];

  /* ---- 資料變動 ---- */
  function pushUndo() {
    const now = Date.now(); if (now - S.lastPush < 700) return;   // 連續拖曳只記一次
    S.lastPush = now; S.undo.push(JSON.stringify({ g: S.group, c: S.clip, data: G() })); if (S.undo.length > 60) S.undo.shift();
  }
  function undo() {
    const u = S.undo.pop(); if (!u) { toast("沒有可以復原的步驟"); return; }
    const o = JSON.parse(u); P().anim[o.g] = o.data; S.group = o.g; S.clip = o.c; commit(true); render();
  }
  const notify = debounce(() => Store.changed("anim"), 300);
  function commit(now) {
    part().animations = AnimModel.bakeAll(G());
    if (now) Store.changed("anim"); else notify();
    draw();
  }

  /* ---- 準備資料 ---- */
  async function prepare() {
    const p = P();
    await Parts.ensureSliced(S.group);
    if (part() && !(p.anim && p.anim[S.group]) && !(S.group === "body" && p.autoAnim)) {
      p.anim = p.anim || {};
      p.anim[S.group] = AnimModel.importGroup(part());
    }
    // 部件圖片 → bitmap（畫舞台用）
    S.bmp.clear();
    for (const im of (part() || { images: [] }).images) { const b = p.sprites[S.group][im.name]; if (b) S.bmp.set(im.name, await Atlas.bitmap(b)); }
    const names = G() ? Object.keys(G().clips) : [];
    if (!names.includes(S.clip)) S.clip = names.includes("idle") ? "idle" : names.includes("normal") ? "normal" : names[0] || null;
    S.f = Math.min(S.f, C() ? C().n - 1 : 0); S.sel = Math.min(S.sel, C() ? C().tracks.length - 1 : 0);
    fitView();
  }

  /* 新角色：用基本姿勢開始做動畫（可以順便套用自動動作範本） */
  function startFromPose(useTemplates) {
    const p = P(), skills = p.stats.sk || [];
    const names = STD.filter(([n]) => (n === "s_attack" ? skills[0] : n === "s2_attack" ? skills[1] : true)).map(([n, , len]) => [n, len]);
    p.anim = p.anim || {}; p.anim.body = AnimModel.fromPose(p.pose, names);
    if (useTemplates) for (const n of Object.keys(p.anim.body.clips)) AnimTemplates.apply(p.anim.body.clips[n], n, part().images);
    p.autoAnim = false; S.group = "body"; S.clip = "idle";
    part().animations = AnimModel.bakeAll(p.anim.body); Store.changed("anim"); render();
    toast(useTemplates ? "已套用自動動作範本，可以從這裡開始調" : "已用基本姿勢建立動畫");
  }

  /* ================= 舞台 ================= */
  function fitView() {
    const c = C(); if (!c) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const clip = G().clips.idle || c;
    for (let f = 0; f < clip.n; f += Math.max(1, Math.floor(clip.n / 8))) for (const it of AnimModel.bakeFrame(clip, f)) {
      const im = part().images[it[1]], b = im && S.bmp.get(im.name); if (!b) continue;
      const m = it[2], [px, py] = [-(im.m[4]), -(im.m[5])];
      for (const [u, v] of [[0, 0], [b.width, 0], [0, b.height], [b.width, b.height]]) { const x = m[0] * (u - px) + m[1] * (v - py) + m[4], y = m[2] * (u - px) + m[3] * (v - py) + m[5]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
    S.world = isFinite(x0) ? { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, h: Math.max(60, y1 - y0, (x1 - x0) * 0.7) } : { cx: 0, cy: -60, h: 140 };
  }
  function view() {
    const W = stage.width, H = stage.height, k = (H * 0.72 / S.world.h) * S.zoom;
    return { k, ox: W / 2 - S.world.cx * k, oy: H / 2 - S.world.cy * k };
  }
  // 一個圖層在這一格的完整變換（含部件中心點）
  function itemMat(it) {
    const im = part().images[it[1]]; if (!im) return null;
    const m = it[2], i = im.m || [1, 0, 0, 1, 0, 0];
    return { im, A: m[0] * i[0] + m[1] * i[2], B: m[0] * i[1] + m[1] * i[3], C: m[0] * i[4] + m[1] * i[5] + m[4], D: m[2] * i[0] + m[3] * i[2], E: m[2] * i[1] + m[3] * i[3], F: m[2] * i[4] + m[3] * i[5] + m[5] };
  }
  function drawFrame(g, clip, f, alpha, tint) {
    for (const it of AnimModel.bakeFrame(clip, f)) {
      const t = itemMat(it); if (!t) continue; const b = S.bmp.get(t.im.name); if (!b) continue;
      g.save(); g.globalAlpha = alpha * it[3][3] / 255; g.transform(t.A, t.D, t.B, t.E, t.C, t.F); g.drawImage(b, 0, 0);
      if (tint) { g.globalCompositeOperation = "source-atop"; g.fillStyle = tint; g.fillRect(0, 0, b.width, b.height); }
      g.restore();
    }
  }
  function draw() {
    if (!stage || !C()) return;
    const r = stage.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (stage.width !== Math.round(r.width * dpr)) { stage.width = Math.round(r.width * dpr); stage.height = Math.round(r.height * dpr); }
    const g = stage.getContext("2d"), css = getComputedStyle(stage), v = view(), c = C(), s = 12 * dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = css.getPropertyValue("--chk-a"); g.fillRect(0, 0, stage.width, stage.height); g.fillStyle = css.getPropertyValue("--chk-b");
    for (let y = 0; y < stage.height; y += s) for (let x = ((y / s) % 2) * s; x < stage.width; x += 2 * s) g.fillRect(x, y, s, s);
    // 地面線（y = 0）與原點
    g.strokeStyle = css.getPropertyValue("--ground"); g.setLineDash([6, 6]); g.beginPath(); g.moveTo(0, v.oy); g.lineTo(stage.width, v.oy); g.stroke(); g.setLineDash([]);
    g.setTransform(v.k, 0, 0, v.k, v.ox, v.oy);
    // 洋蔥皮：前一格（藍）、後一格（橘）半透明
    if (S.onion && !S.playing) {
      if (S.f > 0) drawFrame(g, c, S.f - 1, 0.25, "rgba(60,120,255,.55)");
      if (S.f < c.n - 1) drawFrame(g, c, S.f + 1, 0.25, "rgba(255,130,40,.55)");
    }
    drawFrame(g, c, S.f, 1);
    // 選取的圖層：外框、中心點、旋轉把手
    const st = tr() && AnimModel.stateAt(tr(), S.f);
    if (st && st.v && !S.playing) {
      const it = [tr().id, st.img, AnimModel.compose(st)], t = itemMat(it), b = t && S.bmp.get(t.im.name);
      if (b) {
        const acc = css.getPropertyValue("--accent");
        g.save(); g.transform(t.A, t.D, t.B, t.E, t.C, t.F); g.strokeStyle = acc; g.lineWidth = 1.5 / v.k; g.strokeRect(0, 0, b.width, b.height); g.restore();
        const h = handlePos(st, v);
        g.setTransform(1, 0, 0, 1, 0, 0);
        const px = v.ox + st.x * v.k, py = v.oy + st.y * v.k;
        g.strokeStyle = acc; g.lineWidth = 2 * dpr; g.beginPath(); g.moveTo(px, py); g.lineTo(h.x, h.y); g.stroke();
        g.fillStyle = acc; g.beginPath(); g.arc(px, py, 4 * dpr, 0, 7); g.fill();
        g.beginPath(); g.arc(h.x, h.y, 7 * dpr, 0, 7); g.fill(); g.fillStyle = css.getPropertyValue("--surface"); g.beginPath(); g.arc(h.x, h.y, 3 * dpr, 0, 7); g.fill();
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    // 出手格提示
    const hf = hitFrame();
    if (hf != null && S.f === hf) { g.fillStyle = css.getPropertyValue("--hit"); g.font = `bold ${16 * dpr}px sans-serif`; g.fillText("出手！", 12 * dpr, 24 * dpr); }
    $("#anFrame") && ($("#anFrame").textContent = `${S.f + 1} / ${c.n} 格・${(c.n / (part().anim_rate || 30)).toFixed(2)} 秒`);
    drawTimeline(); syncSide();
  }
  const handlePos = (st, v) => { const len = 46 * (stage.width / stage.clientWidth || 1), t = (st.r - 90) * Math.PI / 180; return { x: v.ox + st.x * v.k + Math.cos(t) * len, y: v.oy + st.y * v.k + Math.sin(t) * len }; };

  // 點到哪個圖層（由前往後找）
  function hitTest(px, py) {
    const v = view(), wx = (px - v.ox) / v.k, wy = (py - v.oy) / v.k, frame = AnimModel.bakeFrame(C(), S.f);
    for (let j = frame.length - 1; j >= 0; j--) {
      const t = itemMat(frame[j]); if (!t) continue; const b = S.bmp.get(t.im.name); if (!b) continue;
      const det = t.A * t.E - t.B * t.D; if (!det) continue;
      const dx = wx - t.C, dy = wy - t.F, u = (t.E * dx - t.B * dy) / det, w = (-t.D * dx + t.A * dy) / det;
      if (u >= 0 && u <= b.width && w >= 0 && w <= b.height) return C().tracks.findIndex((x) => x.id === frame[j][0]);
    }
    return -1;
  }
  function bindStage() {
    const pos = (e) => { const r = stage.getBoundingClientRect(), d = stage.width / r.width; return [(e.clientX - r.left) * d, (e.clientY - r.top) * d]; };
    let drag = null;
    stage.onpointerdown = (e) => {
      if (!C()) return; stop();
      const [x, y] = pos(e), v = view(), st = tr() && AnimModel.stateAt(tr(), S.f);
      if (st && st.v) { const h = handlePos(st, v); if (Math.hypot(x - h.x, y - h.y) < 16 * (stage.width / stage.clientWidth)) { drag = { kind: "rot", st, cx: v.ox + st.x * v.k, cy: v.oy + st.y * v.k }; stage.setPointerCapture(e.pointerId); pushUndo(); return; } }
      const i = hitTest(x, y); if (i < 0) return;
      S.sel = i; const s2 = AnimModel.stateAt(tr(), S.f);
      drag = { kind: "move", x, y, sx: s2.x, sy: s2.y }; stage.setPointerCapture(e.pointerId); pushUndo(); draw();
    };
    stage.onpointermove = (e) => {
      if (!drag) return;
      const [x, y] = pos(e), v = view();
      if (drag.kind === "move") AnimModel.setKey(tr(), S.f, { x: Math.round(drag.sx + (x - drag.x) / v.k), y: Math.round(drag.sy + (y - drag.y) / v.k) });
      else { const deg = Math.atan2(y - drag.cy, x - drag.cx) * 180 / Math.PI + 90; AnimModel.setKey(tr(), S.f, { r: Math.round(((deg + 540) % 360) - 180) }); }
      commit();
    };
    stage.onpointerup = stage.onpointercancel = () => { drag = null; };
    stage.onwheel = (e) => { e.preventDefault(); S.zoom = clamp(S.zoom * (e.deltaY < 0 ? 1.1 : 0.9), 0.3, 4); draw(); };
  }

  /* ================= 時間軸 ================= */
  const ROW = 22, NAMEW = 128, HEAD = 22;
  function rowsOrder() {   // 時間軸上由上到下＝由前到後（這一格的前後順序）
    const c = C(); return c.tracks.map((t, i) => ({ i, z: (AnimModel.stateAt(t, S.f) || t.keys[0] || { z: i }).z ?? i })).sort((a, b) => b.z - a.z || b.i - a.i).map((o) => o.i);
  }
  function hitFrame() { const c = C(); if (!c || !AnimModel.BASES.includes(S.clip)) return null; return AnimModel.hitOf(c.n, c.ready); }
  function drawTimeline() {
    const c = C(); if (!tl || !c) return;
    const rows = rowsOrder(), dpr = Math.min(2, devicePixelRatio || 1), W = NAMEW + c.n * S.cw + 10, H = HEAD + rows.length * ROW + 4;
    tl.style.width = W + "px"; tl.style.height = H + "px"; tl.width = W * dpr; tl.height = H * dpr;
    const g = tl.getContext("2d"), css = getComputedStyle(tl), col = (n) => css.getPropertyValue(n);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = col("--surface"); g.fillRect(0, 0, W, H);
    g.font = "11px " + col("--f-mono"); g.textBaseline = "middle";
    // 表頭：格數
    for (let f = 0; f < c.n; f++) {
      const x = NAMEW + f * S.cw;
      if (f % 5 === 0) { g.fillStyle = col("--muted"); g.fillText(String(f + 1), x + 2, HEAD / 2); }
      g.fillStyle = f % 2 ? col("--bg") : col("--surface"); g.fillRect(x, HEAD, S.cw, rows.length * ROW);
    }
    // 準備段
    if (c.ready != null && AnimModel.BASES.includes(S.clip)) { g.fillStyle = "color-mix(in srgb, " + col("--accent") + " 10%, transparent)"; g.fillStyle = "rgba(242,107,29,.10)"; g.fillRect(NAMEW, HEAD, c.ready * S.cw, rows.length * ROW); }
    rows.forEach((ti, r) => {
      const t = c.tracks[ti], y = HEAD + r * ROW;
      if (ti === S.sel) { g.fillStyle = col("--accent-soft"); g.fillRect(0, y, W, ROW); }
      g.fillStyle = col("--ink"); const k0 = t.keys[0] || {}, im = part().images[(AnimModel.stateAt(t, S.f) || k0).img];
      g.font = "12px " + col("--f-body"); g.fillText(trimText(g, im ? Parts.partLabel(im.name) : "圖層 " + t.id, NAMEW - 10), 6, y + ROW / 2);
      // 補間線與關鍵影格
      g.strokeStyle = col("--line"); g.lineWidth = 2;
      for (let i = 0; i + 1 < t.keys.length; i++) { const a = t.keys[i], b = t.keys[i + 1]; if (a.v && a.e !== "s") { g.beginPath(); g.moveTo(NAMEW + (a.f + 0.5) * S.cw, y + ROW / 2); g.lineTo(NAMEW + (b.f + 0.5) * S.cw, y + ROW / 2); g.stroke(); } }
      for (const k of t.keys) {
        const cx = NAMEW + (k.f + 0.5) * S.cw, cy = y + ROW / 2, s = Math.min(5, S.cw / 2.4);
        g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx + s, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s, cy); g.closePath();
        if (k.v) { g.fillStyle = ti === S.sel ? col("--accent") : col("--ink"); g.fill(); } else { g.strokeStyle = col("--muted"); g.lineWidth = 1.2; g.stroke(); }
      }
    });
    // 目前格、出手格
    const hf = hitFrame();
    if (hf != null) { g.fillStyle = col("--bad"); g.fillRect(NAMEW + hf * S.cw + S.cw / 2 - 1, 0, 2, H); g.font = "bold 10px " + col("--f-body"); g.fillText("出手", NAMEW + hf * S.cw + S.cw / 2 + 3, 8); }
    g.strokeStyle = col("--accent"); g.lineWidth = 2; g.strokeRect(NAMEW + S.f * S.cw + 1, 1, S.cw - 2, H - 2);
  }
  function trimText(g, s, w) { if (g.measureText(s).width <= w) return s; while (s.length > 1 && g.measureText(s + "…").width > w) s = s.slice(0, -1); return s + "…"; }
  function bindTimeline() {
    let drag = null;
    const at = (e) => { const r = tl.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; const rows = rowsOrder(); return { f: clamp(Math.floor((x - NAMEW) / S.cw), 0, C().n - 1), ti: rows[Math.floor((y - HEAD) / ROW)], x, y }; };
    tl.onpointerdown = (e) => {
      if (!C()) return; stop(); const p = at(e);
      if (p.ti != null) S.sel = p.ti;
      if (p.x > NAMEW) S.f = p.f;
      const k = p.ti != null && C().tracks[p.ti].keys.find((x) => x.f === p.f);
      if (k && p.x > NAMEW) { drag = { k, t: C().tracks[p.ti] }; tl.setPointerCapture(e.pointerId); }
      draw();
    };
    tl.onpointermove = (e) => {
      if (!drag) return; const p = at(e);
      if (p.f !== drag.k.f && !drag.t.keys.some((x) => x.f === p.f)) { if (!drag.moved) { pushUndo(); drag.moved = true; } drag.k.f = p.f; drag.t.keys.sort((a, b) => a.f - b.f); S.f = p.f; commit(); }
    };
    tl.onpointerup = tl.onpointercancel = () => (drag = null);
    tl.ondblclick = (e) => { const p = at(e); if (p.ti == null || p.x < NAMEW) return; pushUndo(); AnimModel.setKey(C().tracks[p.ti], p.f, {}); commit(); };
  }

  /* ================= 播放 ================= */
  let raf = 0, last = 0, acc = 0;
  function play() { if (S.playing) return stop(); S.playing = true; last = 0; acc = 0; raf = requestAnimationFrame(loop); syncBar(); }
  function stop() { if (!S.playing) return; S.playing = false; cancelAnimationFrame(raf); syncBar(); draw(); }
  function loop(t) {
    if (!S.playing) return;
    if (last) acc += (t - last) / 1000; last = t;
    const step = 1 / (part().anim_rate || 30);
    while (acc >= step) { acc -= step; S.f = (S.f + 1) % C().n; }
    draw(); raf = requestAnimationFrame(loop);
  }
  const syncBar = () => { const b = $("#anPlay"); if (b) b.textContent = S.playing ? "暫停" : "播放"; };

  /* ================= 右側：選取圖層的屬性 ================= */
  let sideRows = [];
  const cur = () => (tr() && AnimModel.stateAt(tr(), S.f)) || null;
  function setProp(props) { if (!tr()) return; pushUndo(); AnimModel.setKey(tr(), S.f, props); commit(); }
  function syncSide() { sideRows.forEach((r) => r.sync && r.sync()); const k = tr() && tr().keys.find((x) => x.f === S.f); const kb = $("#anKeyState"); if (kb) kb.textContent = k ? "◆ 這格是關鍵影格" : "◇ 這格是補間（改數值會自動加關鍵影格）"; }
  function buildSide() {
    const imgs = part().images;
    const imgSel = el("select", { id: "anImg", "aria-label": "部件" }, imgs.map((im, i) => el("option", { value: i }, `#${i} ${Parts.partLabel(im.name)}`)));
    imgSel.onchange = () => setProp({ img: +imgSel.value });
    const easeSel = el("select", { id: "anEase", "aria-label": "補間方式" }, [["e", "緩入緩出"], ["l", "等速"], ["s", "不補間（跳到下一格）"]].map(([v, n]) => el("option", { value: v }, n)));
    easeSel.onchange = () => setProp({ e: easeSel.value });
    const S2 = (label, key, o) => sliderRow(Object.assign({ label, get: () => (cur() || {})[key] ?? o.def, set: (v) => setProp({ [key]: v }) }, o));
    sideRows = [
      { sync: () => { const s = cur(); if (s) { imgSel.value = s.img; easeSel.value = s.e || "e"; } } },
      toggleRow("看得到", () => (cur() || {}).v !== false, (v) => setProp({ v }), "anVis"),
      S2("左右位置", "x", { min: -300, max: 300, step: 1, digits: 0, def: 0 }),
      S2("上下位置", "y", { min: -400, max: 100, step: 1, digits: 0, def: 0, help: "0 是地面，往上是負數。" }),
      S2("旋轉", "r", { unit: "度", min: -180, max: 180, step: 1, digits: 0, def: 0, help: "正數＝順時針；也可以拖舞台上的圓點。" }),
      S2("左右縮放", "sx", { min: -3, max: 3, step: 0.05, digits: 2, def: 1 }),
      S2("上下縮放", "sy", { min: -3, max: 3, step: 0.05, digits: 2, def: 1, help: "負數＝翻轉。武器建議保持 1，不要跟著身體變形。" }),
      S2("透明度", "a", { min: 0, max: 1, step: 0.05, digits: 2, def: 1 }),
    ];
    const z = (dir, all) => () => {
      const c = C(), rows = rowsOrder(), pos = rows.indexOf(S.sel), other = rows[pos - dir]; if (other == null) return;
      pushUndo();
      const oz = (AnimModel.stateAt(c.tracks[other], S.f) || {}).z ?? other, nz = oz + dir * 0.5;
      if (all) tr().keys.forEach((k) => (k.z = (k.z ?? S.sel) + (nz - ((cur() || {}).z ?? S.sel))));
      else AnimModel.setKey(tr(), S.f, { z: nz });
      commit();
    };
    side.replaceChildren(
      el("div", { class: "an-sel" }, [el("b", { id: "anSelName" }), el("small", { id: "anKeyState", class: "help" })]),
      el("div", { class: "frow" }, [el("label", { for: "anImg" }, "這格用的部件圖"), imgSel]),
      ...sideRows.slice(1),
      el("div", { class: "frow" }, [el("label", { for: "anEase" }, "到下一個關鍵影格"), easeSel]),
      el("div", { class: "frow" }, [el("label", {}, "前後順序"), el("div", { class: "row-actions" }, [
        el("button", { class: "btn small ghost", onclick: z(1, false), title: "從這一格開始畫在前一層" }, "這格起往前"), el("button", { class: "btn small ghost", onclick: z(-1, false) }, "這格起往後"),
        el("button", { class: "btn small ghost", onclick: z(1, true) }, "整段往前"), el("button", { class: "btn small ghost", onclick: z(-1, true) }, "整段往後")]),
        el("p", { class: "help" }, "例：手舉過頭時按「這格起往後」，讓手畫在頭後面，不擋臉。")]),
      el("div", { class: "row-actions" }, [
        el("button", { class: "btn small", onclick: () => { pushUndo(); AnimModel.setKey(tr(), S.f, {}); commit(); } }, "加關鍵影格 (K)"),
        el("button", { class: "btn small ghost", onclick: () => { pushUndo(); AnimModel.deleteKey(tr(), S.f); commit(); } }, "刪關鍵影格"),
        el("button", { class: "btn small ghost danger", onclick: () => { if (C().tracks.length < 2) return; pushUndo(); C().tracks.splice(S.sel, 1); S.sel = 0; commit(); render(); } }, "刪這個圖層"),
      ]),
    );
    const name = $("#anSelName"); sideRows.push({ sync: () => { const s = cur(), im = s && part().images[s.img]; name.textContent = im ? Parts.partLabel(im.name) : "（沒有選）"; } });
  }

  /* ================= 出手時機與檢查 ================= */
  function timingCard() {
    const c = C(), isMove = AnimModel.BASES.includes(S.clip), rate = part().anim_rate || 30, box = el("section", { class: "card" });
    if (!isMove || S.group !== "body") return null;
    const lim = S.clip === "attack" ? [0.3, 0.6] : [0.4, 1.0], sec = c.n / rate;
    const hf = () => AnimModel.hitOf(c.n, c.ready);
    const out = el("p", { class: "hint" });
    const upd = () => { out.innerHTML = `出手在第 <b>${hf() + 1}</b> 格（${((hf()) / rate).toFixed(2)} 秒，動作的 ${Math.round(hf() / c.n * 100)}%）` + (c.ready == null ? "：沒有指定，網站用一半" : `：準備段 ${c.ready} 格`); draw(); };
    const row = sliderRow({ label: "出手格", min: AnimModel.minHit(c.n) + 1, max: AnimModel.maxHit(c.n) + 1, step: 1, digits: 0, disabled: () => c.ready == null,
      get: () => hf() + 1, set: (v) => { pushUndo(); c.ready = AnimModel.readyLen(c.n, v - 1); commit(); upd(); } });
    box.append(el("div", { class: "skill-head" }, [el("h3", {}, "出手時機"),
      toggleRow("指定出手格", () => c.ready != null, (v) => { pushUndo(); c.ready = v ? AnimModel.readyLen(c.n, Math.floor(c.n / 2)) : null; commit(); row.sync(); upd(); }, "anHitOn")]),
      el("p", { class: "help" }, `指定後，匯出時會自動拆成 ${S.clip}_ready（準備）＋ ${S.clip}_all（完整）。網站在「準備段結束後再過剩下的 30%」出手，所以能選的範圍有限制。普攻建議放在一半左右。`),
      row, out,
      sec < lim[0] || sec > lim[1] ? el("p", { class: "warn" }, `這段動畫 ${sec.toFixed(2)} 秒，格鬥場限制 ${lim[0]}～${lim[1]} 秒，${sec > lim[1] ? "超過的部分會被截短" : "太短會被拉到下限"}。可以在上面改格數（勾「照比例拉長縮短」）。`) : null);
    upd();
    return box;
  }

  /* 自動檢查做動作時常踩的坑 */
  function tips() {
    const out = [], c = G(), imgs = part().images, role = (k) => AnimTemplates.roleOf(Parts.partLabel((imgs[k.img] || {}).name || ""));
    if (S.group !== "body" || !c) return out;
    // 1. 待機第 0 格的圖層順序（由後往前）
    const idle = c.clips.idle;
    if (idle) {
      const want = ["cape", "armB", "legB", "legF", "torso", "head", "armF"], NAME = { cape: "披風", armB: "遠側手", legB: "遠側腳", legF: "近側腳", torso: "上身", head: "頭", armF: "近側手" };
      const zs = {}; idle.tracks.forEach((t) => { const s = AnimModel.stateAt(t, 0); if (s && s.v) { const r = role(s); if (r && zs[r] == null) zs[r] = s.z; } });
      const have = want.filter((r) => zs[r] != null);
      for (let i = 0; i + 1 < have.length; i++) if (zs[have[i]] > zs[have[i + 1]]) out.push(["warn", `待機：「${NAME[have[i]]}」畫在「${NAME[have[i + 1]]}」前面。建議由後往前：披風 → 遠側手 → 遠側腳 → 近側腳 → 上身 → 頭 → 近側手`]);
    }
    // 2. 武器被縮放（會變形）
    for (const [n, clip] of Object.entries(c.clips)) for (const t of clip.tracks) for (const k of t.keys) if (role(k) === "weapon" && (Math.abs(Math.abs(k.sx) - 1) > 0.02 || Math.abs(Math.abs(k.sy) - 1) > 0.02)) { out.push(["warn", `${LABEL[n] || n}：武器在第 ${k.f + 1} 格被縮放，會變形。武器建議只移動、旋轉`]); break; }
    // 3. 手舉過頭卻畫在頭前面（擋臉）
    for (const [n, clip] of Object.entries(c.clips)) {
      let found = null;
      for (let f = 0; f < clip.n && !found; f += 2) {
        const st = clip.tracks.map((t) => AnimModel.stateAt(t, f)).filter((s) => s && s.v);
        const head = st.find((s) => role(s) === "head"), arm = st.find((s) => role(s) === "armF");
        if (head && arm && arm.z > head.z && Math.abs(((arm.r % 360) + 540) % 360 - 180) < 60) found = f;   // 手的角度接近朝上
      }
      if (found != null) out.push(["info", `${LABEL[n] || n}：第 ${found + 1} 格近側手舉高、畫在頭前面，可能擋到臉。可以選手 →「這格起往後」`]);
    }
    // 4. 普攻出手不在一半附近
    const atk = c.clips.attack; if (atk && atk.ready != null) { const fr = AnimModel.hitOf(atk.n, atk.ready) / atk.n; if (Math.abs(fr - 0.5) > 0.15) out.push(["info", `普攻出手在 ${Math.round(fr * 100)}% 的位置，建議放在一半左右`]); }
    // 5. 必要動作
    for (const need of ["idle", "attack"]) if (!c.clips[need]) out.push(["warn", `還沒有「${LABEL[need]}」動畫（必要）`]);
    return out;
  }

  /* ================= 分頁 ================= */
  async function render() {
    const box = $("#tab-anim"); if (!box || box.hidden) return;
    const p = P();
    await busy("正在準備動畫資料…", prepare);
    box.replaceChildren();
    if (window.matchMedia("(max-width: 820px)").matches) box.append(el("p", { class: "note" }, "動畫編輯建議用電腦（滑鼠拖曳、鍵盤快捷鍵）。手機可以看和小調整。"));
    // 部件組
    box.append(el("div", { class: "seg" }, Parts.GROUPS.filter(([k]) => p.meta.parts[k]).map(([k, n]) =>
      el("button", { class: k === S.group ? "on" : "", onclick: () => { stop(); S.group = k; S.clip = null; S.sel = 0; render(); } }, n))));
    // 新角色還沒開始做動畫
    if (S.group === "body" && p.autoAnim) {
      const has = part().images.length;
      box.append(el("section", { class: "card" }, [el("h3", {}, "開始做動畫"),
        el("p", { class: "help" }, has ? "用「部件」分頁組好的基本姿勢當每段動畫的第一格。建議先套用自動動作範本（呼吸、走路、揮手、技能、被擊退），再慢慢調；範本是照部件名稱認出頭、手、腳的，名稱裡有「頭、上身、近側手…」最準。" : "還沒有部件。先到「部件」分頁上傳圖片並組好基本姿勢。"),
        has ? el("div", { class: "row-actions" }, [el("button", { class: "btn", onclick: () => startFromPose(true) }, "套用自動動作範本"), el("button", { class: "btn ghost", onclick: () => startFromPose(false) }, "只用基本姿勢（全部靜止）")]) : null]));
      return;
    }
    if (!G() || !C()) {
      box.append(el("section", { class: "card" }, [el("p", { class: "help" }, "這組還沒有動畫。"),
        el("button", { class: "btn", onclick: () => addClip(S.group === "body" ? "idle" : "normal") }, "建立第一段動畫")]));
      return;
    }
    const c = C(), std = S.group === "body" ? STD : BUL;
    // 動畫清單
    const names = Object.keys(G().clips).sort((a, b) => (std.findIndex((x) => x[0] === a) + 1 || 99) - (std.findIndex((x) => x[0] === b) + 1 || 99));
    const missing = std.filter(([n]) => !G().clips[n]);
    const addSel = el("select", { id: "anAdd", "aria-label": "新增動畫" }, [el("option", { value: "" }, "＋ 新增動畫…"), ...missing.map(([n, l]) => el("option", { value: n }, `${l}（${n}）`))]);
    addSel.onchange = () => addSel.value && addClip(addSel.value);
    box.append(el("div", { class: "clips an-clips" }, [...names.map((n) => el("button", { class: "clip" + (n === S.clip ? " on" : ""), onclick: () => { stop(); S.clip = n; S.f = 0; fitView(); render(); } },
      [LABEL[n] || n, el("small", {}, `${G().clips[n].n} 格`)])), missing.length ? addSel : null]));
    // 工具列
    const nIn = el("input", { type: "number", id: "anN", min: 1, max: 300, value: c.n, class: "num", "aria-label": "格數" });
    const stretch = el("input", { type: "checkbox", id: "anStretch", checked: true });
    const copySel = el("select", { id: "anCopy", "aria-label": "從別的動畫複製" }, [el("option", { value: "" }, "從別的動畫複製到這裡…"), ...names.filter((n) => n !== S.clip).map((n) => el("option", { value: n }, LABEL[n] || n))]);
    copySel.onchange = () => { if (!copySel.value) return; pushUndo(); G().clips[S.clip] = Object.assign(deepCopy(G().clips[copySel.value]), { ready: null }); commit(true); render(); };
    // 範本要認得出至少 3 種部件（頭、上身、手…）才有意義；官方角色的部件沒有名字，不顯示
    const known = new Set(c.tracks.map((t) => AnimTemplates.roleOf(Parts.partLabel((part().images[(t.keys[0] || {}).img] || {}).name || ""))).filter(Boolean));
    const canTpl = S.group === "body" && AnimTemplates.T[S.clip] && known.size >= 3;
    box.append(el("div", { class: "an-tools" }, [
      el("label", { class: "inl" }, ["格數 ", nIn]), el("label", { class: "inl" }, [stretch, " 照比例拉長縮短"]),
      el("button", { class: "btn small ghost", onclick: () => { pushUndo(); AnimModel.resize(c, +nIn.value, stretch.checked); S.f = Math.min(S.f, c.n - 1); commit(true); render(); } }, "套用格數"),
      copySel,
      canTpl ? el("button", { class: "btn small ghost", onclick: () => { pushUndo(); AnimTemplates.apply(c, S.clip, part().images); commit(true); render(); } }, "這段套用範本") : null,
      el("button", { class: "btn small ghost", title: "刪掉可以由前後補間算出來的關鍵影格（看起來幾乎一樣）", onclick: () => { pushUndo(); let a = 0, b = 0; for (const t of c.tracks) { a += t.keys.length; t.keys = AnimModel.simplify(t.keys, AnimModel.TOL_LOOSE); b += t.keys.length; } commit(true); toast(`關鍵影格 ${a} → ${b}`); } }, "精簡關鍵影格"),
      el("button", { class: "btn small ghost", onclick: undo }, "復原 (Ctrl+Z)"),
      el("button", { class: "btn small ghost danger", onclick: () => { if (Object.keys(G().clips).length < 2) return; pushUndo(); delete G().clips[S.clip]; S.clip = null; commit(true); render(); } }, "刪這段動畫"),
    ]));
    // 舞台＋側欄
    stage = el("canvas", { class: "an-stage", tabindex: 0, "aria-label": "動畫舞台：點選並拖曳部件" });
    side = el("div", { class: "an-side" });
    const addLayer = el("select", { id: "anAddLayer", "aria-label": "加圖層" }, [el("option", { value: "" }, "＋ 加圖層（選部件）…"), ...part().images.map((im, i) => el("option", { value: i }, `#${i} ${Parts.partLabel(im.name)}`))]);
    addLayer.onchange = () => {
      if (addLayer.value === "") return; pushUndo();
      const id = Math.max(0, ...c.tracks.map((t) => t.id)) + 1, zTop = Math.max(0, ...c.tracks.map((t) => (AnimModel.stateAt(t, S.f) || {}).z || 0)) + 1;
      c.tracks.push({ id, keys: [{ f: 0, img: +addLayer.value, x: 0, y: -60, r: 0, sx: 1, sy: 1, sh: 0, a: 1, v: true, z: zTop, e: "e" }] }); S.sel = c.tracks.length - 1; commit(true); render();
    };
    box.append(el("div", { class: "an-main" }, [
      el("div", { class: "an-left" }, [stage,
        el("div", { class: "transport" }, [el("button", { class: "btn small", id: "anPlay", onclick: play }, "播放"),
          el("button", { class: "btn small ghost", onclick: () => { stop(); S.f = Math.max(0, S.f - 1); draw(); }, "aria-label": "上一格" }, "◀"),
          el("button", { class: "btn small ghost", onclick: () => { stop(); S.f = Math.min(c.n - 1, S.f + 1); draw(); }, "aria-label": "下一格" }, "▶"),
          el("span", { id: "anFrame", class: "mono frame-no" }),
          el("label", { class: "inl" }, [el("input", { type: "checkbox", checked: S.onion, onchange: (e) => { S.onion = e.target.checked; draw(); } }), " 洋蔥皮"])])]),
      side,
    ]));
    // 時間軸
    tl = el("canvas", { class: "an-tl", "aria-label": "時間軸" });
    const zoomIn = el("input", { type: "range", min: 6, max: 28, value: S.cw, "aria-label": "時間軸縮放", oninput: (e) => { S.cw = +e.target.value; drawTimeline(); } });
    box.append(el("section", { class: "card an-tl-card" }, [
      el("div", { class: "skill-head" }, [el("h3", {}, "時間軸"), el("div", { class: "row-actions" }, [addLayer, el("label", { class: "inl" }, ["寬度 ", zoomIn])])]),
      el("p", { class: "help" }, "上面的圖層畫在前面。◆ 關鍵影格（空心＝看不到）；拖 ◆ 換格、雙擊空格加關鍵影格；藍／橘的半透明是前一格／後一格。"),
      el("div", { class: "an-tl-wrap" }, [tl])]));
    const tc = timingCard(); if (tc) box.append(tc);
    const t = tips();
    box.append(el("section", { class: "card" }, [el("h3", {}, "做動作的提醒"),
      t.length ? el("ul", { class: "checks" }, t.map(([l, m]) => el("li", { class: l === "warn" ? "warn" : "ok" }, [el("span", { class: "ck" }, l === "warn" ? "!" : "i"), el("span", {}, m)]))) : el("p", { class: "ok" }, "✓ 沒有發現常見問題"),
      el("details", {}, [el("summary", {}, "做動作的注意事項"), el("ul", { class: "tips" }, [
        "圖層由後往前：燕尾／披風 → 遠側手 → 遠側腳 → 近側腳 → 上身 → 頭 → 近側手。腳要被衣服蓋住，遠側手在身體後面。",
        "武器跟著手走，但不要跟著身體縮放而變形；放技能時武器要留在原本那一側，不能瞬間換手。",
        "舉手的動作不要擋到臉；手舉過肩時，可以讓那隻手畫在頭後面。",
        "空手不要完全貼在身體上，平常稍微往外張開，看起來比較自然。",
        "普攻的命中格放在動畫大約一半的位置。",
        "五官和頭分開時，五官只畫在皮膚上，被瀏海蓋住的部分自然看不到。"].map((x) => el("li", {}, x)))])]));
    buildSide(); bindStage(); bindTimeline();
    new ResizeObserver(() => draw()).observe(stage);
    draw();
  }

  function addClip(name) {
    const p = P(); p.anim = p.anim || {}; p.anim[S.group] = p.anim[S.group] || { clips: {} };
    const src = G().clips.idle || G().clips.normal || Object.values(G().clips)[0];
    const n = ([...STD, ...BUL].find((x) => x[0] === name) || [0, 0, 24])[2];
    pushUndo();
    if (src) { const c = deepCopy(src); c.ready = null; c.tracks.forEach((t) => (t.keys = [Object.assign({}, AnimModel.stateAt(t, 0) || t.keys[0], { f: 0 })])); c.n = n; G().clips[name] = c; }
    else G().clips[name] = { n, ready: null, tracks: part().images.map((im, i) => ({ id: i + 1, keys: [{ f: 0, img: i, x: 0, y: 0, r: 0, sx: 1, sy: 1, sh: 0, a: 1, v: true, z: i, e: "e" }] })) };
    if (S.group === "body" && AnimTemplates.T[name]) AnimTemplates.apply(G().clips[name], name, part().images);
    S.clip = name; S.f = 0; commit(true); render();
  }

  /* 鍵盤（動畫分頁開著、而且不是在輸入框裡） */
  document.addEventListener("keydown", (e) => {
    const box = $("#tab-anim"); if (!box || box.hidden || !C() || e.target.closest("input, textarea, select")) return;
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === "z") { e.preventDefault(); undo(); }
    else if (ctrl && k === "c") { S.copied = C().tracks.map((t) => ({ id: t.id, s: AnimModel.stateAt(t, S.f) })); toast("已複製這一格的姿勢"); }
    else if (ctrl && k === "v" && S.copied) { pushUndo(); for (const o of S.copied) { const t = C().tracks.find((x) => x.id === o.id); if (t && o.s) AnimModel.setKey(t, S.f, Object.assign({}, o.s, { f: S.f })); } commit(); toast("已貼上姿勢"); }
    else if (k === "arrowleft") { e.preventDefault(); stop(); S.f = Math.max(0, S.f - 1); draw(); }
    else if (k === "arrowright") { e.preventDefault(); stop(); S.f = Math.min(C().n - 1, S.f + 1); draw(); }
    else if (k === " ") { e.preventDefault(); play(); }
    else if (k === "k") { pushUndo(); AnimModel.setKey(tr(), S.f, {}); commit(); }
    else if (k === "delete" || k === "backspace") { pushUndo(); AnimModel.deleteKey(tr(), S.f); commit(); }
  });

  return { render, stop };
})();
