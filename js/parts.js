/* ---------- 部件分頁：上傳部件、設定中心點、組裝基本姿勢、自動拼圖、頭像與技能圖標 ----------
   資料：
     P.sprites[組名][部件名稱] = Blob     每個部件一張圖（讀進來的角色會先把拼接圖切開）
     P.meta.parts[組名].images[i]         部件順序與中心點 m（動畫用「第幾個」指定部件，所以順序不能亂改）
     P.pose = [{ i, x, y, r, s, a }]      基本姿勢（只有還沒有動畫的新角色用）：由後往前畫
   任何部件有變動就呼叫 rebuild(組名)：重新拼圖、更新 sprites 的位置；新角色還會重產生靜止動作。 */
"use strict";

const Parts = (() => {
  const P = () => Store.P;
  const GROUPS = [["body", "本體"], ["bul", "普攻投射物"], ["bul2", "技能 1 投射物"], ["bul3", "技能 2 投射物"]];
  let group = "body", selected = 0, poseCv = null, bmps = new Map();

  /* ---- 基本操作 ---- */
  const part = (k = group) => P().meta.parts[k];
  const pivotOf = (im) => [-(im.m ? im.m[4] : 0), -(im.m ? im.m[5] : 0)];
  const isAuto = (k = group) => (k === "body" ? P().autoAnim : !!(P().autoBul && P().autoBul[k]));

  // 讀進來的角色：第一次要改部件時，把拼接圖切開
  async function ensureSliced(k) {
    const p = P(); p.sprites = p.sprites || {};
    if (p.sprites[k] || !part(k)) return;
    p.sprites[k] = p.images[k] ? await Atlas.slice(part(k), p.images[k]) : {};
  }
  async function spriteBmp(k, name) {
    const b = P().sprites[k] && P().sprites[k][name];
    if (!b) return null;
    if (!bmps.has(b)) bmps.set(b, await Atlas.bitmap(b));
    return bmps.get(b);
  }

  /* 重新拼圖 → 更新 sprites 的 rect、拼接圖 Blob；新角色重產生靜止動作 */
  async function rebuild(k = group) {
    const p = P(), pt = part(k);
    const used = {}; for (const im of pt.images) if (p.sprites[k][im.name]) used[im.name] = p.sprites[k][im.name];
    const r = await Atlas.pack(used);
    pt.sprites = {}; for (const [n, rect] of Object.entries(r.rects)) pt.sprites[n] = { rect, rotated: false };
    p.images[k] = r.blob; p.atlasInfo = Object.assign(p.atlasInfo || {}, { [k]: { w: r.w, h: r.h, tooBig: r.tooBig } });
    if (isAuto(k)) autoAnimate(k);
    Store.changed("meta");
  }

  /* 新角色的暫時動作：每段動畫都是同一個靜止姿勢（階段 3 換成真正的動畫）。
     長度照格鬥場的限制取中間值：普攻 0.53 秒、技能 0.8 秒，出手時機在一半。 */
  const mat = (q) => { const t = (q.r || 0) * Math.PI / 180, s = q.s || 1, c = +(Math.cos(t) * s).toFixed(4), n = +(Math.sin(t) * s).toFixed(4); return [c, -n, n, c, +q.x.toFixed(2), +q.y.toFixed(2)]; };
  function autoAnimate(k) {
    const pt = part(k);
    if (k === "body") {
      const frame = P().pose.filter((q) => pt.images[q.i]).map((q, li) => [li + 1, q.i, mat(q), [255, 255, 255, Math.round((q.a ?? 1) * 255)]]);
      const clip = (n) => ({ frame_count: n, frames: Array.from({ length: n }, () => frame) });
      const st = P().stats.sk || [];
      pt.animations = { idle: clip(40), walk: clip(24), attack: clip(16), knockback: clip(24) };
      if (st[0]) pt.animations.s_attack = clip(24);
      if (st[1]) pt.animations.s2_attack = clip(24);
    } else {
      // 投射物：全部部件疊在原點，飛行中 normal 一格
      const frame = pt.images.map((im, i) => [i + 1, i, [1, 0, 0, 1, 0, 0], [255, 255, 255, 255]]);
      pt.animations = { normal: { frame_count: 1, frames: [frame] } };
    }
  }

  const safeName = (s) => (s || "part").replace(/\.[a-z]+$/i, "").replace(/[^\w一-鿿-]+/g, "_").slice(0, 32) || "part";
  function uniqueName(k, base) {
    const names = new Set(part(k).images.map((im) => im.name));
    let n = `${k}_${safeName(base)}.png`, i = 2;
    while (names.has(n)) n = `${k}_${safeName(base)}${i++}.png`;
    return n;
  }

  /* 加一個部件（中心點預設在圖的正中間） */
  async function addPart(k, label, blob, pivot, pose) {
    const p = P(), bmp = await Atlas.bitmap(blob), name = uniqueName(k, label);
    const [px, py] = pivot || [Math.round(bmp.width / 2), Math.round(bmp.height / 2)];
    part(k).images.push({ name, m: [1, 0, 0, 1, -px, -py] });
    p.sprites[k][name] = blob;
    const i = part(k).images.length - 1;
    if (k === "body" && p.autoAnim) p.pose.push(Object.assign({ i, x: 0, y: -60, r: 0, s: 1, a: 1 }, pose || {}));
    return i;
  }
  async function uploadParts(files) { return busy(`正在加入 ${files.length} 個部件…`, () => uploadParts0(files)); }
  async function uploadParts0(files) {
    await ensureSliced(group);
    for (const f of files) await addPart(group, f.name, f);
    selected = part(group).images.length - 1;
    await rebuild(); render();
    toast(`加入了 ${files.length} 個部件`);
  }
  async function replaceImage(i, blob) { return busy("正在換圖並重新拼接…", () => replaceImage0(i, blob)); }
  async function replaceImage0(i, blob) {
    const im = part().images[i], [px, py] = pivotOf(im), old = await spriteBmp(group, im.name), nb = await Atlas.bitmap(blob);
    // 換圖時，中心點照比例換算到新圖上（新圖尺寸不同也不會跑掉太多）
    const kx = old ? nb.width / old.width : 1, ky = old ? nb.height / old.height : 1;
    im.m = [1, 0, 0, 1, -Math.round(px * kx), -Math.round(py * ky)];
    P().sprites[group][im.name] = blob;
    await rebuild(); render();
  }
  async function removePart(i) {
    const pt = part();
    if (!isAuto()) { toast("這隻已經有動畫在用這個部件，不能刪（可以換圖）", "bad"); return; }
    const name = pt.images[i].name;
    pt.images.splice(i, 1); delete P().sprites[group][name];
    if (group === "body") P().pose = P().pose.filter((q) => q.i !== i).map((q) => (q.i > i ? Object.assign(q, { i: q.i - 1 }) : q));
    selected = Math.max(0, Math.min(selected, pt.images.length - 1));
    await rebuild(); render();
  }
  // 圖層順序（只有新角色可以改）：dir＝+1 往前、−1 往後
  async function moveLayer(i, dir) {
    const pose = P().pose, li = pose.findIndex((q) => q.i === i), lj = li + dir;
    if (li < 0 || lj < 0 || lj >= pose.length) return;
    [pose[li], pose[lj]] = [pose[lj], pose[li]];
    autoAnimate("body"); Store.changed("meta"); render();
  }

  /* ---- 用色塊試做：照建議的圖層順序做出一組部件，之後再一個個換成自己的圖 ---- */
  const DEMO = [
    // 名稱, 寬, 高, 顏色, 中心點, 姿勢 { x, y, r }
    ["披風", 46, 58, "#6b4fbb", [23, 4], { x: -4, y: -74, r: 8 }],
    ["遠側手", 14, 34, "#e8b48a", [7, 5], { x: -15, y: -72, r: 12 }],
    ["遠側腳", 16, 36, "#3d4a66", [8, 4], { x: -7, y: -38 }],
    ["近側腳", 16, 36, "#4a5a7a", [8, 4], { x: 7, y: -38 }],
    ["上身", 40, 42, "#d9483b", [20, 21], { x: 0, y: -57 }],
    ["頭", 52, 46, "#f2c9a0", [26, 42], { x: 0, y: -74 }],
    ["武器", 10, 64, "#9aa5b8", [5, 54], { x: 22, y: -44, r: 20 }],
    ["近側手", 14, 34, "#f2c29a", [7, 5], { x: 15, y: -72, r: -18 }],
  ];
  async function demoParts() { return busy("正在做色塊部件…", demoParts0); }
  async function demoParts0() {
    const p = P();
    if (!p.autoAnim) return;
    p.sprites.body = {}; part("body").images = []; p.pose = [];
    for (const [label, w, h, color, pv, pose] of DEMO) {
      const c = Atlas.canvas(w, h), g = c.getContext("2d"), r = Math.min(8, w / 3);
      g.fillStyle = color; g.beginPath(); g.roundRect(0, 0, w, h, r); g.fill();
      g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 2; g.stroke();
      if (label === "頭") { g.fillStyle = "#222"; g.fillRect(30, 18, 5, 8); g.fillRect(40, 18, 5, 8); g.fillStyle = "#5a3a22"; g.fillRect(0, 0, w, 12); }
      await addPart("body", label, await Atlas.toBlob(c), pv, pose);
    }
    selected = 5; await rebuild("body"); render();
    toast("做好了 8 個色塊部件，可以一個個換成自己的圖");
  }

  /* ================= 中心點視窗 ================= */
  let pvDlg = null;
  async function editPivot(i) {
    const im = part().images[i], bmp = await spriteBmp(group, im.name);
    if (!bmp) return;
    if (!pvDlg) {
      pvDlg = el("div", { class: "modal", hidden: true, role: "dialog", "aria-modal": "true", "aria-labelledby": "pvTitle" }, [el("div", { class: "modal-box pivot" }, [
        el("div", { class: "picker-head" }, [el("h2", { id: "pvTitle" }, "中心點"), el("button", { class: "btn ghost", id: "pvX", "aria-label": "關閉" }, "✕")]),
        el("p", { class: "help" }, "點一下或拖曳，設定這個部件的旋轉中心：手臂放在肩膀、腳放在髖部、頭放在脖子、武器放在握把。"),
        el("div", { class: "tool-canvas" }, [el("canvas", { id: "pvCv" })]),
        el("div", { class: "pv-presets", id: "pvPre" }),
        el("div", { class: "tool-foot" }, [el("span", { id: "pvOut", class: "mono" }), el("button", { class: "btn", id: "pvOk" }, "完成")]),
      ])]);
      document.body.append(pvDlg);
    }
    let [px, py] = pivotOf(im);
    const cv = $("#pvCv", pvDlg), W = bmp.width, H = bmp.height;
    const draw = () => {
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); cv.width = r.width * dpr; cv.height = r.height * dpr;
      const g = cv.getContext("2d"), k = Math.min(cv.width / W, cv.height / H) * 0.8, ox = (cv.width - W * k) / 2, oy = (cv.height - H * k) / 2, css = getComputedStyle(cv), s = 10 * dpr;
      g.fillStyle = css.getPropertyValue("--chk-a"); g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = css.getPropertyValue("--chk-b");
      for (let y = 0; y < cv.height; y += s) for (let x = ((y / s) % 2) * s; x < cv.width; x += 2 * s) g.fillRect(x, y, s, s);
      g.imageSmoothingEnabled = false; g.drawImage(bmp, ox, oy, W * k, H * k);
      g.strokeStyle = css.getPropertyValue("--line"); g.strokeRect(ox, oy, W * k, H * k);
      const cx = ox + px * k, cy = oy + py * k; g.strokeStyle = css.getPropertyValue("--accent"); g.lineWidth = 2 * dpr;
      g.beginPath(); g.moveTo(cx - 16 * dpr, cy); g.lineTo(cx + 16 * dpr, cy); g.moveTo(cx, cy - 16 * dpr); g.lineTo(cx, cy + 16 * dpr); g.stroke();
      g.beginPath(); g.arc(cx, cy, 6 * dpr, 0, Math.PI * 2); g.stroke();
      $("#pvOut", pvDlg).textContent = `(${px}, ${py})　圖 ${W}×${H}`;
      cv._map = { k, ox, oy, dpr };
    };
    const set = (e) => { const r = cv.getBoundingClientRect(), m = cv._map; px = clamp(Math.round(((e.clientX - r.left) * m.dpr - m.ox) / m.k), 0, W); py = clamp(Math.round(((e.clientY - r.top) * m.dpr - m.oy) / m.k), 0, H); draw(); };
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); set(e); cv.onpointermove = set; };
    cv.onpointerup = () => (cv.onpointermove = null);
    $("#pvPre", pvDlg).replaceChildren(...[["正中", 0.5, 0.5], ["上中（手、腳、披風）", 0.5, 0.1], ["下中（頭）", 0.5, 0.9], ["左中", 0.1, 0.5], ["右中", 0.9, 0.5]].map(([n, fx, fy]) =>
      el("button", { class: "btn small ghost", onclick: () => { px = Math.round(W * fx); py = Math.round(H * fy); draw(); } }, n)));
    pvDlg.hidden = false; requestAnimationFrame(draw);
    await new Promise((res) => { $("#pvOk", pvDlg).onclick = $("#pvX", pvDlg).onclick = res; });
    pvDlg.hidden = true;
    // 新角色：中心點改了，姿勢的位置跟著補償，讓部件看起來留在原地
    const [ox0, oy0] = pivotOf(im);
    im.m = [1, 0, 0, 1, -px, -py];
    if (group === "body" && P().autoAnim) { const q = P().pose.find((x) => x.i === i); if (q) { const m = mat(q); q.x += m[0] * (px - ox0) + m[1] * (py - oy0); q.y += m[2] * (px - ox0) + m[3] * (py - oy0); } }
    if (isAuto()) autoAnimate(group);
    Store.changed("meta"); render();
  }

  /* ================= 組裝（基本姿勢）畫布 ================= */
  const poseState = { drag: null, view: null };
  async function drawPose() {
    if (!poseCv || !P().autoAnim) return;
    const cv = poseCv, r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.max(10, r.width * dpr); cv.height = Math.max(10, r.height * dpr);
    const g = cv.getContext("2d"), css = getComputedStyle(cv), s = 12 * dpr, pt = part("body");
    g.fillStyle = css.getPropertyValue("--chk-a"); g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = css.getPropertyValue("--chk-b");
    for (let y = 0; y < cv.height; y += s) for (let x = ((y / s) % 2) * s; x < cv.width; x += 2 * s) g.fillRect(x, y, s, s);
    const k = (cv.height * 0.7) / 130, ox = cv.width / 2, oy = cv.height * 0.86;
    poseState.view = { k, ox, oy, dpr };
    g.strokeStyle = css.getPropertyValue("--ground"); g.setLineDash([6, 6]); g.beginPath(); g.moveTo(0, oy); g.lineTo(cv.width, oy); g.stroke(); g.setLineDash([]);
    g.font = `${11 * dpr}px sans-serif`; g.fillStyle = css.getPropertyValue("--muted"); g.fillText("地面（腳底）", 8 * dpr, oy - 6 * dpr);
    for (const q of P().pose) {
      const im = pt.images[q.i], bmp = im && (await spriteBmp("body", im.name)); if (!bmp) continue;
      const m = mat(q), [px, py] = pivotOf(im);
      g.save(); g.setTransform(k, 0, 0, k, ox, oy); g.transform(m[0], m[2], m[1], m[3], m[4], m[5]); g.globalAlpha = q.a ?? 1;
      g.drawImage(bmp, -px, -py);
      if (q.i === selected) { g.globalAlpha = 1; g.strokeStyle = css.getPropertyValue("--accent"); g.lineWidth = 2 / k; g.strokeRect(-px, -py, bmp.width, bmp.height);
        g.beginPath(); g.arc(0, 0, 3 / k * dpr, 0, Math.PI * 2); g.fillStyle = css.getPropertyValue("--accent"); g.fill(); }
      g.restore();
    }
  }
  // 點到哪個部件（由前往後找）
  async function hitPart(x, y) {
    const pt = part("body"), v = poseState.view, wx = (x - v.ox) / v.k, wy = (y - v.oy) / v.k;
    for (const q of P().pose.slice().reverse()) {
      const im = pt.images[q.i], bmp = im && (await spriteBmp("body", im.name)); if (!bmp) continue;
      const m = mat(q), det = m[0] * m[3] - m[1] * m[2], dx = wx - m[4], dy = wy - m[5];
      const lx = (m[3] * dx - m[1] * dy) / det, ly = (-m[2] * dx + m[0] * dy) / det, [px, py] = pivotOf(im);
      if (lx + px >= 0 && lx + px <= bmp.width && ly + py >= 0 && ly + py <= bmp.height) return q;
    }
    return null;
  }
  function bindPose(cv) {
    poseCv = cv;
    const pos = (e) => { const r = cv.getBoundingClientRect(), d = poseState.view.dpr; return [(e.clientX - r.left) * d, (e.clientY - r.top) * d]; };
    cv.onpointerdown = async (e) => {
      const [x, y] = pos(e), q = await hitPart(x, y); if (!q) return;
      cv.setPointerCapture(e.pointerId); selected = q.i; poseState.drag = { q, x, y, qx: q.x, qy: q.y }; render();
    };
    cv.onpointermove = (e) => {
      const d = poseState.drag; if (!d) return;
      const [x, y] = pos(e), k = poseState.view.k;
      d.q.x = Math.round(d.qx + (x - d.x) / k); d.q.y = Math.round(d.qy + (y - d.y) / k); drawPose(); syncSel();
    };
    cv.onpointerup = cv.onpointercancel = () => { if (poseState.drag) { poseState.drag = null; autoAnimate("body"); Store.changed("meta"); } };
    new ResizeObserver(drawPose).observe(cv);
  }

  /* ================= 分頁畫面 ================= */
  let selRows = [];
  function syncSel() { selRows.forEach((r) => r.sync()); }
  function selectedPose() { return P().pose.find((q) => q.i === selected); }
  function setPose(key, v) { const q = selectedPose(); if (!q) return; q[key] = v; autoAnimate("body"); Store.changed("meta"); drawPose(); }

  async function render() {
    const box = $("#tab-parts"); if (!box || box.hidden && !box.dataset.built) return;
    box.dataset.built = 1;
    const p = P();
    // 第一次打開：讀進來的角色要先把拼接圖切開（官方角色部件多，會花一點時間）
    const need = GROUPS.filter(([k]) => part(k) && !(p.sprites && p.sprites[k]));
    if (need.length) await busy("正在切開拼接圖…", () => Promise.all(need.map(([k]) => ensureSliced(k))));
    box.replaceChildren();

    // 部件組切換
    box.append(el("div", { class: "seg", role: "tablist" }, GROUPS.map(([k, n]) => el("button", { class: k === group ? "on" : "", onclick: () => { group = k; selected = 0; render(); } },
      [n, el("small", {}, part(k) ? `${part(k).images.length}` : "—")]))));

    if (!part(group)) {
      box.append(el("section", { class: "card" }, [el("h3", {}, GROUPS.find((g) => g[0] === group)[1]),
        el("p", { class: "help" }, "這組投射物還沒有圖。投射物是普攻或技能打出去的東西（火球、子彈…）。建立後上傳圖片，投射物的飛行方式在階段 4 設定。"),
        el("button", { class: "btn", onclick: async () => { p.meta.parts[group] = Store.blankPart(); p.sprites[group] = {}; p.autoBul = Object.assign(p.autoBul || {}, { [group]: true }); render(); } }, "建立這組")]));
      box.append(avatarCard());
      return;
    }
    const pt = part(group), auto = isAuto();
    const tools = el("div", { class: "row-actions" }, [
      fileButton("上傳部件 PNG（可多選）", { class: "btn", accept: "image/png,image/*", multiple: true }, uploadParts),
      group === "body" && auto && !pt.images.length ? el("button", { class: "btn ghost", onclick: demoParts }, "先用色塊試做一隻") : null,
    ]);

    // 組裝畫布（新角色）
    if (group === "body" && auto) {
      const cv = el("canvas", { class: "pose-cv", "aria-label": "組裝畫布：拖曳部件擺位置" });
      const q = selectedPose();
      selRows = q ? [
        sliderRow({ label: "旋轉", unit: "度", min: -180, max: 180, step: 1, digits: 0, get: () => (selectedPose() || {}).r || 0, set: (v) => setPose("r", v), help: "正數＝順時針。繞著中心點轉。" }),
        sliderRow({ label: "縮放", min: 0.2, max: 3, step: 0.05, digits: 2, get: () => (selectedPose() || {}).s || 1, set: (v) => setPose("s", v) }),
        sliderRow({ label: "透明度", min: 0, max: 1, step: 0.05, digits: 2, get: () => (selectedPose() || {}).a ?? 1, set: (v) => setPose("a", v) }),
        sliderRow({ label: "左右位置", min: -150, max: 150, step: 1, digits: 0, get: () => (selectedPose() || {}).x || 0, set: (v) => setPose("x", v) }),
        sliderRow({ label: "上下位置", min: -250, max: 50, step: 1, digits: 0, get: () => (selectedPose() || {}).y || 0, set: (v) => setPose("y", v), help: "0 是地面，往上是負數。" }),
      ] : [];
      box.append(el("section", { class: "card" }, [
        el("div", { class: "skill-head" }, [el("h3", {}, "組裝基本姿勢"), el("span", { class: "pill" }, "下一步：動畫分頁")]),
        el("p", { class: "help" }, "拖曳部件擺好位置，這就是角色站著的樣子。組好後到「動畫」分頁開始做動作（可以套用自動動作範本）。"),
        el("div", { class: "pose-wrap" }, [cv, el("div", { class: "pose-side" }, q ? [el("b", {}, partLabel(pt.images[selected].name)), ...selRows] : [el("p", { class: "help" }, "還沒有部件。")])]),
      ]));
      bindPose(cv); drawPose();
    }

    // 部件清單
    const order = group === "body" && auto ? p.pose.slice().reverse().map((q) => q.i) : pt.images.map((_, i) => i);
    const list = el("div", { class: "plist" });
    for (const i of order) {
      const im = pt.images[i], blob = p.sprites[group][im.name], [px, py] = pivotOf(im);
      list.append(el("div", { class: "prow" + (i === selected ? " on" : ""), onclick: (e) => { if (e.target.closest("button, label, input")) return; selected = i; render(); } }, [
        el("div", { class: "pthumb" }, blob ? el("img", { src: URL.createObjectURL(blob), alt: "" }) : "?"),
        el("div", { class: "pname" }, [el("b", {}, partLabel(im.name)), el("small", { class: "mono" }, `#${i}・中心 (${Math.round(px)}, ${Math.round(py)})`)]),
        el("div", { class: "pbtns" }, [
          el("button", { class: "btn small ghost", onclick: () => editPivot(i) }, "中心點"),
          fileButton("換圖", { class: "btn small ghost" }, (fs) => replaceImage(i, fs[0])),
          el("button", { class: "btn small ghost", onclick: async () => { const b = await ImgTool.open(blob, { title: "編輯部件：" + partLabel(im.name) }); if (b) replaceImage(i, b); } }, "編輯"),
          group === "body" && auto ? el("button", { class: "btn small ghost", title: "往前一層", "aria-label": "往前一層", onclick: () => moveLayer(i, 1) }, "▲") : null,
          group === "body" && auto ? el("button", { class: "btn small ghost", title: "往後一層", "aria-label": "往後一層", onclick: () => moveLayer(i, -1) }, "▼") : null,
          auto ? el("button", { class: "btn small ghost danger", onclick: () => removePart(i) }, "刪除") : null,
        ]),
      ]));
    }
    const info = p.atlasInfo && p.atlasInfo[group];
    box.append(el("section", { class: "card" }, [
      el("div", { class: "skill-head" }, [el("h3", {}, `部件（${pt.images.length}）`), info ? el("span", { class: "pill" + (info.tooBig ? " badp" : "") }, `拼接圖 ${info.w}×${info.h}`) : null]),
      group === "body" && auto ? el("p", { class: "help" }, "清單上面的畫在最前面。建議由後往前：披風 → 遠側手 → 遠側腳 → 近側腳 → 上身 → 頭 → 近側手。腳要被衣服蓋住，遠側手在身體後面。") :
        group === "body" ? el("p", { class: "help" }, "這隻已經有動畫：可以換圖、改中心點、上傳新部件；新部件要到「動畫」分頁用「加圖層」放進動作裡。") : null,
      tools, list,
      info && info.tooBig ? el("p", { class: "bad" }, "拼接圖超過 2048×2048，部分手機可能顯示不出來。請把部件縮小（「編輯」→ 輸出縮放）。") : null,
    ]));
    box.append(avatarCard());
  }
  const partLabel = (name) => name.replace(/^(body|bul\d?)_/, "").replace(/^.*-body_/, "").replace(/\.png$/, "");

  /* ---- 頭像與技能圖標 ---- */
  function imgSlot(key, label, size, help, extra) {
    const p = P(), blob = p.images[key];
    const up = fileButton("上傳並裁切", { class: "btn small" }, async (fs) => { const b = await ImgTool.open(fs[0], { title: label, aspect: 1, out: [size, size] }); if (b) { p.images[key] = b; Store.changed("images"); render(); } });
    return el("div", { class: "slot" }, [
      el("div", { class: "slot-img" + (key.startsWith("icon") ? " icon" : "") }, blob ? el("img", { src: URL.createObjectURL(blob), alt: label }) : el("span", {}, "沒有")),
      el("div", { class: "slot-body" }, [el("b", {}, label), el("p", { class: "help" }, help),
        el("div", { class: "row-actions" }, [up,
          blob ? el("button", { class: "btn small ghost", onclick: async () => { const b = await ImgTool.open(blob, { title: label, aspect: 1, out: [size, size] }); if (b) { p.images[key] = b; Store.changed("images"); render(); } } }, "重新裁切") : null,
          ...(extra || [])])]),
    ]);
  }
  function avatarCard() {
    const p = P();
    const snap = el("button", { class: "btn small ghost", onclick: async () => {
      const b = await Editor.snapshot(); if (!b) { toast("預覽裡還沒有角色", "bad"); return; }
      const out = await ImgTool.open(b, { title: "從預覽擷取頭像", aspect: 1, out: [140, 140] }); if (out) { p.images.thum140 = out; Store.changed("images"); render(); } } }, "從預覽擷取");
    const iconName = (s) => { const sk = p.skills[s]; return sk && sk.icon && !sk.icon.includes("/") ? sk.icon : ""; };
    return el("section", { class: "card" }, [el("h3", {}, "頭像與技能圖標"),
      imgSlot("thum140", "頭像 140×140", 140, "角色庫、選角、搜尋結果都用它。透明背景 PNG，臉在正中間最好看。", [snap]),
      ...[0, 1].filter((s) => p.stats.sk && p.stats.sk[s]).map((s) => imgSlot("icon" + (s + 1), `技能 ${s + 1} 圖標 128×128`, 128,
        iconName(s) ? `目前用官方圖標 ${iconName(s)}（上傳自己的圖就會換掉）。` : "格鬥場技能按鈕用。沒有的話按鈕顯示文字。")),
    ]);
  }

  return { render, rebuild, ensureSliced, GROUPS, partLabel, autoAnimate };
})();
