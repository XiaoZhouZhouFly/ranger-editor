/* ---------- 讀取網站資料 ----------
   編輯器是獨立的 GitHub 專案，直接從「Ranger 惡搞工坊」網站讀 custom/ 與 data/（GitHub Pages 允許跨網站讀取）。
   網站網址改了就改 SITE_URL；測試時也可以在網址加 ?base=…（例如本機的 http://localhost:8000/）。
   官方角色的動畫檔是 .json.gz（用瀏覽器內建的 DecompressionStream 解壓縮），自製角色是 .json。 */
"use strict";

const IO = (() => {
  const qBase = new URLSearchParams(location.search).get("base");
  const SITE_URL = "https://xiaozhouzhoufly.github.io/ranger-kichiku/";
  let base = qBase || document.documentElement.dataset.base || SITE_URL;
  if (!base.endsWith("/")) base += "/";
  const cache = new Map();

  const url = (path) => base + path;

  async function fetchJson(path, fallback) {
    if (cache.has(path)) return cache.get(path);
    const p = (async () => {
      const r = await fetch(url(path), { cache: "no-cache" });
      if (!r.ok) throw new Error(`${path}：${r.status}`);
      return r.json();
    })();
    cache.set(path, p);
    try { return await p; } catch (e) { cache.delete(path); if (fallback !== undefined) return fallback; throw e; }
  }

  // 讀 .json.gz：伺服器可能已經幫忙解壓縮，所以先看檔頭（1f 8b 才是 gzip）
  async function fetchGzJson(path) {
    const r = await fetch(url(path));
    if (!r.ok) throw new Error(`${path}：${r.status}`);
    const u8 = new Uint8Array(await r.arrayBuffer());
    if (u8[0] !== 0x1f || u8[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(u8));
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }

  async function fetchBlob(path) {
    const r = await fetch(url(path));
    if (!r.ok) throw new Error(`${path}：${r.status}`);
    return r.blob();
  }

  // 角色清單：自製（custom/units.json）與官方（data/units.json）
  const customIndex = () => fetchJson("custom/units.json", []);
  const officialIndex = () => fetchJson("data/units.json", []);

  /* 讀一隻角色的全部資料 → { unit, stats, skills, fx, proj, meta, images }
     kind：custom 或 data。images：{ 部件名稱: Blob, thum140, thum }，圖片讀不到就略過。 */
  async function loadCharacter(kind, id) {
    const dir = kind === "custom" ? "custom/" : "data/";
    const [index, stats, skills, fxAll, projAll] = await Promise.all([
      fetchJson(dir + "units.json", []), fetchJson(dir + "stats.json", {}), fetchJson(dir + "skills.json", {}),
      fetchJson(dir + "skill_fx.json", {}), fetchJson(dir + "projectiles.json", {}),
    ]);
    let meta;
    if (kind === "custom") meta = await fetchJson(`custom/units/${id}.json`);
    else { try { meta = await fetchGzJson(`data/units/${id}.json.gz`); } catch { meta = await fetchJson(`data/units/${id}.json`); } }
    const images = {};
    await Promise.all(Object.entries(meta.parts || {}).map(async ([k, p]) => {
      try { images[k] = await fetchBlob(dir + p.png); } catch { /* 沒有圖：預覽會跳過這個部件 */ }
    }));
    for (const [key, file] of [["thum140", `${id}-thum-140.png`], ["thum", `${id}-thum.png`]]) {
      try { images[key] = await fetchBlob(`${dir}res/${id}/${file}`); } catch {}
    }
    // 技能圖標：只寫檔名＝官方圖標（data/res/skill_icon/），有「/」＝相對於 custom/ 的路徑
    const sk = deepCopy(skills[id] || []);
    for (let s = 0; s < 2; s++) {
      const icon = sk[s] && sk[s].icon;
      if (!icon) continue;
      try { images["icon" + (s + 1)] = await fetchBlob(icon.includes("/") ? "custom/" + icon : "data/res/skill_icon/" + icon); } catch {}
    }
    return {
      unit: deepCopy(index.find((r) => r.id === id) || { id }), stats: deepCopy(stats[id] || null), skills: sk,
      fx: deepCopy(fxAll[id] || null), proj: deepCopy(projAll[id] || null), grade: fxAll._grade ? fxAll._grade[id] || null : null,
      meta, images,
    };
  }

  return { get base() { return base; }, url, fetchJson, fetchGzJson, fetchBlob, customIndex, officialIndex, loadCharacter };
})();
