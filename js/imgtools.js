/* ---------- 圖片工具：裁切、縮放、去背、裁掉透明邊 ----------
   ImgTool.open(來源 Blob, 選項) → Promise<Blob 或 null（取消）>
   選項：
     title      視窗標題
     aspect     裁切框固定比例（1＝正方形；不給就自由）
     out        輸出固定尺寸 [寬, 高]（頭像 [140,140]、技能圖標 [128,128]）；不給就用「縮放」拉桿
   去背是「從點的那一點往外擴散」：只去掉跟點到的顏色相連、而且顏色接近的區域（勾「全部同色」則整張都去）。 */
"use strict";

const ImgTool = (() => {
  let dlg = null, S = null;

  function build() {
    dlg = el("div", { class: "modal", hidden: true, role: "dialog", "aria-modal": "true", "aria-labelledby": "itTitle" }, [
      el("div", { class: "modal-box tool" }, [
        el("div", { class: "picker-head" }, [el("h2", { id: "itTitle" }, "圖片工具"), el("button", { class: "btn ghost", id: "itClose", "aria-label": "取消" }, "✕")]),
        el("div", { class: "tool-modes", role: "radiogroup" }, [
          el("button", { class: "mode on", "data-m": "crop" }, "裁切"), el("button", { class: "mode", "data-m": "erase" }, "去背（點背景）"),
          el("button", { class: "btn small ghost", id: "itTrim" }, "裁掉透明邊"), el("button", { class: "btn small ghost", id: "itUndo" }, "復原"),
        ]),
        el("div", { class: "tool-canvas" }, [el("canvas", { id: "itCv" })]),
        el("div", { class: "tool-opts" }, [
          el("label", { id: "itTolBox" }, ["去背容許差 ", el("input", { type: "range", id: "itTol", min: 0, max: 120, value: 32 }), " ", el("output", { id: "itTolOut" }, "32")]),
          el("label", {}, [el("input", { type: "checkbox", id: "itAll" }), " 全部同色都去掉"]),
          el("label", { id: "itScaleBox" }, ["輸出縮放 ", el("input", { type: "range", id: "itScale", min: 10, max: 200, value: 100 }), " ", el("output", { id: "itScaleOut" }, "100%")]),
        ]),
        el("p", { class: "help", id: "itInfo" }),
        el("div", { class: "tool-foot" }, [el("button", { class: "btn ghost", id: "itCancel" }, "取消"), el("button", { class: "btn", id: "itOk" }, "使用這張")]),
      ]),
    ]);
    document.body.append(dlg);
    $$(".mode", dlg).forEach((b) => (b.onclick = () => { S.mode = b.dataset.m; $$(".mode", dlg).forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
    $("#itTol", dlg).oninput = (e) => ($("#itTolOut", dlg).textContent = e.target.value);
    $("#itScale", dlg).oninput = (e) => { $("#itScaleOut", dlg).textContent = e.target.value + "%"; info(); };
    $("#itTrim", dlg).onclick = () => { push(); const t = Atlas.trim(S.work); S.work = t.canvas; S.crop = full(); draw(); };
    $("#itUndo", dlg).onclick = () => { if (S.undo.length) { S.work = S.undo.pop(); S.crop = full(); draw(); } };
    const cv = $("#itCv", dlg);
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    new ResizeObserver(() => S && draw()).observe(cv);
  }

  const full = () => fitAspect({ x: 0, y: 0, w: S.work.width, h: S.work.height });
  // 裁切框套上固定比例（在框內取最大的那個比例的矩形，置中）
  function fitAspect(r) {
    if (!S.aspect) return r;
    let w = r.w, h = r.h;
    if (w / h > S.aspect) w = h * S.aspect; else h = w / S.aspect;
    return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
  }
  function push() { const c = Atlas.canvas(S.work.width, S.work.height); c.getContext("2d").drawImage(S.work, 0, 0); S.undo.push(c); if (S.undo.length > 20) S.undo.shift(); }

  // 畫面座標 ↔ 圖片座標
  function view() {
    const cv = $("#itCv", dlg), W = cv.width, H = cv.height, k = Math.min(W / S.work.width, H / S.work.height) * 0.92;
    return { k, ox: (W - S.work.width * k) / 2, oy: (H - S.work.height * k) / 2 };
  }
  function toImg(e) {
    const cv = $("#itCv", dlg), r = cv.getBoundingClientRect(), dpr = cv.width / r.width, v = view();
    return { x: ((e.clientX - r.left) * dpr - v.ox) / v.k, y: ((e.clientY - r.top) * dpr - v.oy) / v.k };
  }

  function draw() {
    const cv = $("#itCv", dlg), r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.max(10, r.width * dpr); cv.height = Math.max(10, r.height * dpr);
    const g = cv.getContext("2d"), v = view(), css = getComputedStyle(cv), s = 10 * dpr;
    g.fillStyle = css.getPropertyValue("--chk-a"); g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = css.getPropertyValue("--chk-b");
    for (let y = 0; y < cv.height; y += s) for (let x = ((y / s) % 2) * s; x < cv.width; x += 2 * s) g.fillRect(x, y, s, s);
    g.imageSmoothingEnabled = v.k < 1;
    g.drawImage(S.work, v.ox, v.oy, S.work.width * v.k, S.work.height * v.k);
    if (S.mode === "crop") {
      const c = S.crop, X = v.ox + c.x * v.k, Y = v.oy + c.y * v.k, Wc = c.w * v.k, Hc = c.h * v.k;
      g.fillStyle = "rgba(0,0,0,0.45)";
      g.fillRect(0, 0, cv.width, Y); g.fillRect(0, Y + Hc, cv.width, cv.height); g.fillRect(0, Y, X, Hc); g.fillRect(X + Wc, Y, cv.width, Hc);
      g.strokeStyle = css.getPropertyValue("--accent"); g.lineWidth = 2 * dpr; g.strokeRect(X, Y, Wc, Hc);
      g.fillStyle = g.strokeStyle; for (const [hx, hy] of [[X, Y], [X + Wc, Y], [X, Y + Hc], [X + Wc, Y + Hc]]) g.fillRect(hx - 6 * dpr, hy - 6 * dpr, 12 * dpr, 12 * dpr);
    }
    info();
  }
  function outSize() {
    const c = S.crop;
    if (S.out) return S.out;
    const k = +$("#itScale", dlg).value / 100;
    return [Math.max(1, Math.round(c.w * k)), Math.max(1, Math.round(c.h * k))];
  }
  function info() { const [w, h] = outSize(); $("#itInfo", dlg).textContent = `原圖 ${S.work.width}×${S.work.height}，裁切 ${Math.round(S.crop.w)}×${Math.round(S.crop.h)} → 輸出 ${w}×${h}`; }

  /* ---- 拖曳：裁切框（移動、拉角、重新畫）；去背（點一下） ---- */
  function down(e) {
    const p = toImg(e), c = S.crop, tol = 14 / view().k;
    e.target.setPointerCapture(e.pointerId);
    if (S.mode === "erase") { erase(p); return; }
    const corner = [[c.x, c.y, "nw"], [c.x + c.w, c.y, "ne"], [c.x, c.y + c.h, "sw"], [c.x + c.w, c.y + c.h, "se"]].find(([x, y]) => Math.abs(p.x - x) < tol && Math.abs(p.y - y) < tol);
    if (corner) S.drag = { kind: corner[2], c0: { ...c } };
    else if (p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h) S.drag = { kind: "move", p0: p, c0: { ...c } };
    else S.drag = { kind: "new", p0: p };
  }
  function move(e) {
    if (!S.drag) return;
    const p = toImg(e), d = S.drag, W = S.work.width, H = S.work.height;
    let r;
    if (d.kind === "move") r = { ...d.c0, x: clamp(d.c0.x + p.x - d.p0.x, 0, W - d.c0.w), y: clamp(d.c0.y + p.y - d.p0.y, 0, H - d.c0.h) };
    else {
      // 固定對角那一點，跟著指標拉
      const a = d.kind === "new" ? d.p0 : { x: d.kind.includes("w") ? d.c0.x + d.c0.w : d.c0.x, y: d.kind.includes("n") ? d.c0.y + d.c0.h : d.c0.y };
      const bx = clamp(p.x, 0, W), by = clamp(p.y, 0, H);
      let w = Math.abs(bx - a.x), h = Math.abs(by - a.y);
      if (S.aspect) { if (w / Math.max(h, 1) > S.aspect) h = w / S.aspect; else w = h * S.aspect; }
      r = { x: bx < a.x ? a.x - w : a.x, y: by < a.y ? a.y - h : a.y, w, h };
      r.x = clamp(r.x, 0, W - 1); r.y = clamp(r.y, 0, H - 1); r.w = Math.min(r.w, W - r.x); r.h = Math.min(r.h, H - r.y);
      if (S.aspect) { if (r.w / r.h > S.aspect) r.w = r.h * S.aspect; else r.h = r.w / S.aspect; }
    }
    if (r.w >= 2 && r.h >= 2) S.crop = r;
    draw();
  }
  function up() { S.drag = null; }

  // 去背：從點到的地方往外擴散（或整張同色），把相近顏色變透明
  function erase(p) {
    const x0 = Math.floor(p.x), y0 = Math.floor(p.y), W = S.work.width, H = S.work.height;
    if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return;
    push();
    const g = S.work.getContext("2d"), img = g.getImageData(0, 0, W, H), d = img.data, tol = +$("#itTol", dlg).value;
    const i0 = (y0 * W + x0) * 4, R = d[i0], G = d[i0 + 1], B = d[i0 + 2];
    const near = (i) => d[i + 3] > 0 && Math.abs(d[i] - R) + Math.abs(d[i + 1] - G) + Math.abs(d[i + 2] - B) <= tol * 3;
    if ($("#itAll", dlg).checked) { for (let i = 0; i < d.length; i += 4) if (near(i)) d[i + 3] = 0; }
    else {
      const seen = new Uint8Array(W * H), stack = [y0 * W + x0];
      while (stack.length) {
        const q = stack.pop(); if (seen[q]) continue; seen[q] = 1;
        if (!near(q * 4)) continue;
        d[q * 4 + 3] = 0;
        const x = q % W;
        if (x > 0) stack.push(q - 1); if (x < W - 1) stack.push(q + 1); if (q >= W) stack.push(q - W); if (q < W * (H - 1)) stack.push(q + W);
      }
    }
    g.putImageData(img, 0, 0); draw();
  }

  async function open(src, o = {}) {
    if (!dlg) build();
    const work = await busy("正在開啟圖片…", () => Atlas.blobToCanvas(src));
    S = { work, mode: "crop", aspect: o.aspect || null, out: o.out || null, undo: [], drag: null };
    S.crop = full();
    $("#itTitle", dlg).textContent = o.title || "圖片工具";
    $("#itScaleBox", dlg).hidden = !!S.out;
    $$(".mode", dlg).forEach((x) => x.classList.toggle("on", x.dataset.m === "crop"));
    dlg.hidden = false;
    requestAnimationFrame(draw);
    return new Promise((resolve) => {
      const done = async (ok) => {
        dlg.hidden = true;
        if (!ok) return resolve(null);
        const [w, h] = outSize(), c = Atlas.canvas(w, h), g = c.getContext("2d"), r = S.crop;
        g.imageSmoothingQuality = "high";
        g.drawImage(S.work, r.x, r.y, r.w, r.h, 0, 0, w, h);
        resolve(await Atlas.toBlob(c));
      };
      $("#itOk", dlg).onclick = () => done(true);
      $("#itCancel", dlg).onclick = $("#itClose", dlg).onclick = () => done(false);
    });
  }

  return { open };
})();
