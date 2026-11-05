/* ---------- 匯出：合併網站清單、自動檢查、變更說明、zip、片段模式 ----------
   原則（v7.2）：custom/ 底下的清單檔已經有別的角色，匯出時只「新增或替換自己那一筆」，其他角色原樣保留。
   兩種交付方式：
     1. zip：解壓縮是 custom/ 資料夾，清單檔是「網站現有內容＋這隻」合併後的完整檔，直接拖進 GitHub。
     2. 片段：每個檔案給「只含這隻的片段」和「貼在哪裡」，方便用手機的 GitHub 網頁貼上。 */
"use strict";

const Export = (() => {
  const LISTS = ["units.json", "stats.json", "skills.json", "skill_fx.json", "projectiles.json"];
  const j = (o) => JSON.stringify(o, null, 1);   // 跟網站的清單檔一樣用 1 格縮排

  // 讀網站現在的 custom/ 清單（不用快取，拿最新的）
  async function siteLists() {
    const out = {}, missing = [];
    await Promise.all(LISTS.map(async (n) => {
      try { const r = await fetch(IO.url("custom/" + n), { cache: "no-store" }); if (!r.ok) throw 0; out[n] = await r.json(); }
      catch { out[n] = n === "units.json" ? [] : {}; missing.push(n); }
    }));
    return { lists: out, missing };
  }

  /* 整理出這隻角色要寫的每一筆資料與檔案 */
  async function build(site) {
    const p = Store.P, id = p.unit.id, res = `res/${id}/`, files = [], images = [];
    // 每組部件重新拼圖（確保 rotated 一律 false、路徑跟新 id 一致）
    const meta = { unit_id: id, parts: {} }, atlas = {};
    for (const [k] of Parts.GROUPS) {
      const pt = p.meta.parts[k]; if (!pt || !pt.images.length) continue;
      await Parts.ensureSliced(k);
      const used = {}; for (const im of pt.images) if (p.sprites[k][im.name]) used[im.name] = p.sprites[k][im.name];
      const r = await Atlas.pack(used);
      const png = `${res}${id}-${k}.png`;
      meta.parts[k] = Object.assign(deepCopy(pt), { png, sprites: Object.fromEntries(Object.entries(r.rects).map(([n, rect]) => [n, { rect, rotated: false }])) });
      atlas[k] = r; images.push({ path: png, blob: r.blob, label: k === "body" ? "本體拼接圖" : "投射物拼接圖 " + k });
    }
    if (p.images.thum140) images.push({ path: `${res}${id}-thum-140.png`, blob: p.images.thum140, label: "頭像 140×140" });
    if (p.images.thum) images.push({ path: `${res}${id}-thum.png`, blob: p.images.thum, label: "頭像（備用）" });

    // 清單檔的這一筆
    const unit = Object.assign({}, p.unit, { id, custom: true }); if (!unit.hidden) delete unit.hidden;
    const stats = deepCopy(p.stats); stats.s = unit.star;
    if (!p.fightOn || !stats.fight || !Object.keys(stats.fight).length) delete stats.fight;
    else delete stats.fight.op;   // 不寫「超模」標示
    const skills = deepCopy(p.skills).map((sk, s) => {
      if (!sk) return null;
      if (p.images["icon" + (s + 1)]) { sk.icon = `${res}${id}-icon${s + 1}.png`; images.push({ path: sk.icon, blob: p.images["icon" + (s + 1)], label: `技能 ${s + 1} 圖標` }); }
      return sk;
    });
    while (skills.length && skills[skills.length - 1] == null) skills.pop();
    const fx = p.fx && p.fx.some(Boolean) ? [p.fx[0] || null, p.fx[1] || null] : null;
    const entries = { "units.json": unit, "stats.json": stats, "skills.json": skills, "skill_fx.json": fx, "projectiles.json": p.proj || null };

    // 合併：只新增或替換自己那一筆
    const merged = {}, others = {};
    for (const n of LISTS) {
      const cur = deepCopy(site.lists[n]), e = entries[n];
      if (n === "units.json") {
        const i = cur.findIndex((r) => r.id === id);
        if (i >= 0) cur[i] = e; else cur.push(e);
        others[n] = cur.filter((r) => r.id !== id).map((r) => r.id);
      } else {
        if (e == null) { if (!(id in cur)) { merged[n] = null; continue; } delete cur[id]; }
        else cur[id] = e;
        others[n] = Object.keys(cur).filter((k) => k !== id && !k.startsWith("_"));
      }
      merged[n] = cur;
    }
    files.push({ path: `units/${id}.json`, text: JSON.stringify(meta) });
    for (const n of LISTS) if (merged[n]) files.push({ path: n, text: j(merged[n]) });
    return { id, meta, atlas, entries, merged, others, files, images };
  }

  /* ---- 自動檢查（CHARACTER_FORMAT.md 第十節＋v7.2） ---- */
  function check(B, site) {
    const p = Store.P, id = B.id, out = [], add = (lvl, msg) => out.push([lvl, msg]);
    const m = /^x(\d{3})(sk\d+)?-([a-z][a-z0-9]*)$/.exec(id);
    if (!m) add("fail", `id「${id}」格式不對：要是 x＋三位數字＋英文小寫名，例如 x003-dragon`);
    else if (!Store.numOk(+m[1])) add("fail", `編號 x${m[1]} 不在 x003～x100（x001、x002 是網站內建，x101 以後保留給網站）`);
    else add("ok", `id ${id} 在 x003～x100 之間`);
    const exists = site.lists["units.json"].find((r) => r.id === id);
    const editing = p.src.kind === "custom" && p.src.id === id;
    if (exists && !editing) add("fail", `網站上已經有 ${id}（${exists.name}），匯出會蓋掉它。請到「基本資料」換編號`);
    else if (editing) add("ok", `修改現有角色 ${id}（替換它在清單檔裡的那一筆）`);
    else add("ok", "id 沒有跟網站上的角色重複");
    const n = B.others["units.json"].length;
    add("ok", `清單檔已跟網站現有內容合併：保留其他 ${n} 隻（${B.others["units.json"].join("、") || "無"}）`);
    if (site.missing.length) add("warn", `網站上還沒有 ${site.missing.join("、")}，會新建`);
    if (m && m[2] && !p.unit.hidden) add("fail", `${id} 是召喚物／變形外觀（名字有 sk），units.json 要加 "hidden": true（「基本資料」最下面的開關）`);
    else if (p.unit.hidden) add("ok", `有 "hidden": true（不會出現在選角清單）`);
    const body = B.meta.parts.body;
    if (!body) add("fail", "沒有本體部件（body），請到「部件」上傳圖片");
    for (const [k, pt] of Object.entries(B.meta.parts)) {
      if (!B.images.some((im) => im.path === pt.png)) add("fail", `${k} 的 png 路徑 ${pt.png} 沒有對應的圖片`);
      const names = new Set(Object.keys(pt.sprites));
      const lost = pt.images.filter((im) => !names.has(im.name)).map((im) => im.name);
      if (lost.length) add("fail", `${k}：sprites 少了 ${lost.slice(0, 3).join("、")}${lost.length > 3 ? " 等 " + lost.length + " 個" : ""}`);
      for (const [an, a] of Object.entries(pt.animations)) {
        if (a.frames.length !== a.frame_count) add("fail", `${k} 的動畫 ${an}：frames 有 ${a.frames.length} 格，frame_count 寫 ${a.frame_count}`);
        const bad = a.frames.some((fr) => fr.some((it) => it[1] < 0 || it[1] >= pt.images.length));
        if (bad) add("fail", `${k} 的動畫 ${an}：有部件編號超出 images 範圍`);
      }
      if (B.atlas[k] && B.atlas[k].tooBig) add("warn", `${k} 拼接圖 ${B.atlas[k].w}×${B.atlas[k].h} 超過 2048，部分手機可能顯示不出來`);
    }
    if (body) {
      add(Object.values(B.meta.parts).every((pt) => Object.values(pt.animations).every((a) => a.frames.length === a.frame_count)) ? "ok" : "fail", "每段動畫的 frames 數量等於 frame_count");
      for (const need of ["idle", "attack"]) if (!body.animations[need]) add("fail", `本體沒有 ${need} 動畫（必要）`);
      if (p.autoAnim) add("warn", "動作還是靜止的基本姿勢（階段 3 做動畫）。可以先上傳測試，格鬥場選得到");
    }
    add(p.images.thum140 ? "ok" : "fail", p.images.thum140 ? `有頭像 ${id}-thum-140.png` : "沒有頭像 <id>-thum-140.png（「部件」最下面上傳或從預覽擷取）");
    if (B.entries["stats.json"].fight) add("warn", `stats.json 有手寫格鬥場數值 "fight"（${Object.keys(B.entries["stats.json"].fight).join("、")}），不會照公式平衡`);
    if (p.officialSource) add("warn", `圖片來自官方角色 ${p.officialSource}（LY Corporation 的素材），上傳到你的 repo 前請自行斟酌`);
    return out;
  }

  /* ---- 變更說明（跟網站上這隻的舊資料比較） ---- */
  function report(B, site, checks) {
    const p = Store.P, id = B.id, old = site.lists["stats.json"][id], oldU = site.lists["units.json"].find((r) => r.id === id);
    const lines = [`# 變更說明：${p.unit.name}（${id}）`, "", `產生時間：${new Date().toLocaleString("zh-TW")}　編輯器：Ranger 角色編輯器`, ""];
    lines.push(oldU ? "## 修改現有角色" : p.src.kind === "data" ? `## 新增角色（從官方角色 ${p.src.id} 改的）` : p.src.kind === "custom" ? `## 新增角色（從自製角色 ${p.src.id} 另存）` : "## 新增角色", "");
    lines.push("### 檔案", "");
    for (const n of LISTS) if (B.merged[n]) lines.push(`- custom/${n}：${(n === "units.json" ? oldU : site.lists[n][id]) ? "替換" : "新增"} ${id} 這一筆（其他 ${B.others[n].length} 筆不動）`);
    lines.push(`- custom/units/${id}.json：動畫與部件（${Object.keys(B.meta.parts).join("、")}）`);
    for (const im of B.images) lines.push(`- custom/${im.path}：${im.label}`);
    if (old) {
      const diff = [];
      const v0 = (x) => (Array.isArray(x) ? x[0] : x);
      const NAMES = { hp: "體力", pa: "物攻", ma: "魔攻", pd: "物防", md: "魔防", ai: "攻擊間隔", mv: "移速", rg: "射程" };
      for (const [k, n] of Object.entries(NAMES)) if (v0(old[k]) !== v0(p.stats[k])) diff.push(`- ${n}：${v0(old[k])} → ${v0(p.stats[k])}`);
      (p.stats.sk || []).forEach((sk, s) => { const o = old.sk && old.sk[s]; if (!o !== !sk) diff.push(`- 技能 ${s + 1}：${sk ? "新增" : "移除"}`); else if (sk && o.cd !== sk.cd) diff.push(`- 技能 ${s + 1} 冷卻：${o.cd} → ${sk.cd} 秒`); });
      lines.push("", "### 數值變更", "", ...(diff.length ? diff : ["- 沒有改"]));
    }
    const fs = Editor.fs();
    lines.push("", "### 格鬥場換算（編輯器算的）", "", `- 體力 ${fs.hp}、減傷 ${Math.round(fs.dr * 100)}%、走路 ${fs.walk}、普攻 ${fs.atk.dmg}（${Fight.FORM_LABEL[fs.atk.form]}）`);
    fs.sk.forEach((o, s) => lines.push(o ? `- 技能 ${s + 1}：${Fight.FORM_LABEL[o.form]}・傷害 ${o.dmg}・冷卻 ${o.cd.toFixed(1)} 秒` : `- 技能 ${s + 1}：沒有`));
    const icon = { ok: "✅", warn: "⚠️", fail: "❌" };
    lines.push("", "### 自動檢查", "", ...checks.map(([l, m]) => `- ${icon[l]} ${m}`), "");
    lines.push("### 上傳方式", "", "把解壓縮出來的 custom 資料夾整個拖進網站 repo（ranger-kichiku）的 Add file → Upload files（放在 repo 根目錄），同名檔案會被取代。", "");
    return lines.join("\n");
  }

  /* ---- 片段：只含這隻的那一段＋貼在哪裡 ---- */
  function snippets(B, site) {
    const id = B.id, out = [];
    for (const n of LISTS) {
      const e = B.entries[n]; if (e == null) continue;
      const has = n === "units.json" ? site.lists[n].some((r) => r.id === id) : id in site.lists[n];
      const isNew = site.missing.includes(n);
      let text, where;
      if (n === "units.json") {
        text = j(e).replace(/^/gm, " ");
        where = has ? `找到 "id": "${id}" 那一整段 { … }，整段換成下面這段。` : isNew ? `建立新檔 custom/${n}，內容是 [ 下面這段 ]。` : `檔案最後是「]」。在最後一個「}」後面加一個逗號，再把下面這段貼在「]」前面。`;
      } else {
        text = ` ${JSON.stringify(id)}: ${j(e).replace(/\n/g, "\n ")}`;
        where = has ? `找到 "${id}": 開頭的那一整段，整段換成下面這段。` : isNew ? `建立新檔 custom/${n}，內容是 { 下面這段 }。` : `檔案最後是「}」。在倒數第二個「}」（上一隻角色的結尾）後面加一個逗號，再把下面這段貼在最後的「}」前面。`;
      }
      out.push({ file: `custom/${n}`, where, text, full: j(B.merged[n]) });
    }
    out.push({ file: `custom/units/${id}.json`, where: `新檔（已經有就整份取代）。GitHub：進到 custom/units/，Add file → Create new file，檔名打 ${id}.json，貼上下面整段。`, text: JSON.stringify(B.meta), full: null });
    return out;
  }

  /* ================= 匯出分頁 ================= */
  let last = null;
  function download(blob, name) {
    const a = el("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); btn.textContent = "已複製"; }
    catch { const t = btn.parentElement.parentElement.querySelector("textarea"); if (t) { t.select(); } btn.textContent = "請手動複製（已選取）"; }
    setTimeout(() => (btn.textContent = "複製"), 1800);
  }

  async function render() {
    const box = $("#tab-export"); if (!box) return;
    box.replaceChildren(el("section", { class: "card" }, [el("p", { class: "help" }, "正在讀取網站上的 custom/ 清單並檢查…")]));
    let site, B;
    try { await busy("正在讀取網站清單並檢查…", async () => { site = await siteLists(); B = await build(site); }); }
    catch (e) { box.replaceChildren(el("section", { class: "card" }, [el("p", { class: "bad" }, "整理資料時出錯：" + e.message)])); return; }
    const checks = check(B, site), fails = checks.filter((c) => c[0] === "fail").length, md = report(B, site, checks);
    last = { B, site, md };
    const icon = { ok: "✓", warn: "!", fail: "✕" };
    box.replaceChildren(
      el("section", { class: "card" }, [
        el("div", { class: "skill-head" }, [el("h3", {}, "匯出前檢查"), el("button", { class: "btn small ghost", onclick: render }, "重新檢查")]),
        el("ul", { class: "checks" }, checks.map(([l, m]) => el("li", { class: l }, [el("span", { class: "ck" }, icon[l]), el("span", {}, m)]))),
        fails ? el("p", { class: "bad" }, `有 ${fails} 項沒通過，先修好再上傳（還是可以下載來看）。`) : el("p", { class: "ok" }, "全部通過，可以上傳。"),
      ]),
      el("section", { class: "card" }, [
        el("h3", {}, "方法一：下載 zip（電腦）"),
        el("p", { class: "help" }, `解壓縮後是 custom/ 資料夾，清單檔已經是「網站現有內容＋${B.id}」合併好的完整檔。到網站的 repo（ranger-kichiku，不是編輯器的 repo），把整個 custom 資料夾拖進 Add file → Upload files 即可，別的角色不會被蓋掉。zip 裡另外附一份「變更說明」。`),
        el("div", { class: "row-actions" }, [
          el("button", { class: "btn", onclick: () => busy("正在打包 zip…", async () => {
            const zfiles = [...B.files.map((f) => ({ path: "custom/" + f.path, data: f.text })), ...B.images.map((im) => ({ path: "custom/" + im.path, data: im.blob })), { path: `變更說明-${B.id}.md`, data: md }];
            download(await Zip.makeZip(zfiles), `${B.id}.zip`);
          }) }, `下載 ${B.id}.zip`),
          el("button", { class: "btn ghost", onclick: () => download(new Blob([md], { type: "text/markdown" }), `變更說明-${B.id}.md`) }, "只下載變更說明"),
        ]),
      ]),
      el("section", { class: "card" }, [
        el("h3", {}, "方法二：一段一段貼（手機）"),
        el("p", { class: "help" }, "在 GitHub 網頁打開網站 repo（ranger-kichiku）的每個檔案，按鉛筆圖示編輯，照說明貼上，最後按 Commit changes。不確定逗號放哪裡，可以改用「整份取代」：全選檔案內容刪掉，貼上合併好的整份。"),
        ...snippets(B, site).map((s) => {
          const ta = el("textarea", { readonly: true, rows: 6, class: "mono snip", "aria-label": s.file }); ta.value = s.text;
          const b1 = el("button", { class: "btn small", onclick: (e) => copy(s.text, e.target) }, "複製");
          return el("details", { class: "snip-box" }, [el("summary", {}, [el("b", { class: "mono" }, s.file)]),
            el("p", { class: "help" }, s.where), ta,
            el("div", { class: "row-actions" }, [b1, s.full ? el("button", { class: "btn small ghost", onclick: (e) => { copy(s.full, e.target); } }, "複製整份（已合併）") : null])]);
        }),
        el("h3", {}, "圖片"),
        el("p", { class: "help" }, `圖片要放在 custom/res/${B.id}/。手機上如果還沒有這個資料夾：在 custom/res/ 按 Add file → Create new file，檔名打「${B.id}/.keep」建立資料夾，再進去 Upload files。`),
        el("div", { class: "imglist" }, B.images.map((im) => el("div", { class: "imgrow" }, [
          el("img", { src: URL.createObjectURL(im.blob), alt: "" }), el("div", {}, [el("b", {}, im.label), el("small", { class: "mono" }, "custom/" + im.path)]),
          el("button", { class: "btn small ghost", onclick: () => download(im.blob, im.path.split("/").pop()) }, "下載")]))),
      ]),
      el("section", { class: "card" }, [el("h3", {}, "變更說明（預覽）"), el("pre", { class: "md" }, md)]),
    );
  }

  return { render, build, check, siteLists, get last() { return last; } };
})();
