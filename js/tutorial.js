/* ---------- 教學頁的工具：整理圖片、做頭像／圖標、自動拼圖 ---------- */
"use strict";

(() => {
  function download(blob, name) {
    const a = el("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
  }
  // 結果：預覽＋下載按鈕
  function showResult(blob, name) {
    const out = $("#fixOut");
    out.replaceChildren(el("img", { src: URL.createObjectURL(blob), alt: "結果", class: "atlas-prev", style: "max-height:160px" }),
      el("button", { class: "btn", onclick: () => download(blob, name) }, "下載 " + name));
  }
  // 三個選檔按鈕（真正的檔案選擇框包在按鈕裡，手機才點得到）
  for (const [id, mode] of [["#fixIn", "fix"], ["#avaIn", "ava"], ["#icoIn", "ico"]]) {
    const fin = $(id);
    fin.onchange = async () => { const f = fin.files[0]; fin.value = ""; if (f) await fix(f, mode); };
  }
  async function fix(f, mode) {
    const o = mode === "ava" ? { title: "頭像 140×140", aspect: 1, out: [140, 140] } : mode === "ico" ? { title: "技能圖標 128×128", aspect: 1, out: [128, 128] } : { title: "整理圖片" };
    const b = await ImgTool.open(f, o);
    if (b) showResult(b, mode === "ava" ? "thum-140.png" : mode === "ico" ? "icon.png" : f.name.replace(/\.\w+$/, "") + ".png");
  }

  // 自動拼圖
  const ain = $("#atIn");
  ain.onchange = () => { const files = [...ain.files]; ain.value = ""; if (files.length) busy("正在拼接…", () => packFiles(files)); };
  async function packFiles(files) {
    const blobs = {}; for (const f of files) blobs[f.name] = f;
    const r = await Atlas.pack(blobs);
    const images = [], sprites = {};
    for (const f of files) {
      const [, , w, h] = r.rects[f.name];
      images.push({ name: f.name, m: [1, 0, 0, 1, -Math.round(w / 2), -Math.round(h / 2)] });
      sprites[f.name] = { rect: r.rects[f.name], rotated: false };
    }
    const ta = el("textarea", { class: "mono snip out-json", readonly: true, "aria-label": "images 與 sprites" });
    ta.value = JSON.stringify({ images, sprites }, null, 1);
    $("#atOut").replaceChildren(
      el("p", { class: r.tooBig ? "bad" : "help" }, `拼成 ${r.w}×${r.h}，共 ${files.length} 塊` + (r.tooBig ? "（超過 2048，請把部件縮小）" : "")),
      el("img", { src: URL.createObjectURL(r.blob), alt: "拼接圖", class: "atlas-prev" }),
      el("div", { class: "row-actions" }, [el("button", { class: "btn", onclick: () => download(r.blob, "atlas.png") }, "下載拼接圖"),
        el("button", { class: "btn ghost", onclick: () => download(new Blob([ta.value], { type: "application/json" }), "atlas.json") }, "下載位置資料")]),
      ta);
  }
})();
