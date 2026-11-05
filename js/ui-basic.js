/* ---------- 基本資料、數值、技能三個分頁，以及右側的「格鬥場換算」 ----------
   每個輸入元件都有 sync()：資料變了（例如換角色）就重新讀值。 */
"use strict";

const UI = (() => {
  const P = () => Store.P;
  const rows = [];                         // 目前畫面上的輸入元件（全部 sync 用）
  const keep = (r) => (rows.push(r), r);
  const syncAll = () => rows.forEach((r) => r.sync && r.sync());

  /* ---- 陣列數值 [滿級, 基礎, 每級成長]：只改第 1 個，其他照比例跟著變 ---- */
  const arr0 = (k) => { const v = P().stats[k]; return Array.isArray(v) ? +v[0] : +v || 0; };
  function setArr0(k, v) {
    const st = P().stats, old = st[k];
    if (!Array.isArray(old)) st[k] = [v, v / 10, v / 10];
    else { const o = +old[0]; st[k] = old.map((x, i) => (i === 0 ? v : o > 0 ? Math.round(x * v / o) : Math.round(v / 10))); }
    Store.changed("stats");
  }
  const setNum = (k, v) => { P().stats[k] = v; Store.changed("stats"); };

  /* ================= 基本資料 ================= */
  function buildBasic(box) {
    box.replaceChildren();
    const idOut = el("output", { class: "id-out", id: "idOut" });
    const numRow = keep(sliderRow({ label: "編號", min: Store.NUM_MIN, max: Store.NUM_MAX, step: 1, digits: 0, get: () => P().num, set: (v) => setNumId(v),
      help: "x 後面的三位數字，編輯器只用 x003～x100（x001、x002 是網站內建，x101 以後保留給網站手工角色）。預設是還沒用過的最小號碼。",
      hint: (v) => (Editor.usedNums().has(v) && !(P().src.kind === "custom" && P().srcNum === v) ? `<b class="bad">x${String(v).padStart(3, "0")} 已經有人用了</b>` : "") }));
    const slugRow = keep(textRow("英文名", () => P().slug, (v) => setSlug(v), { placeholder: "例如 dragon", max: 24, help: "英文小寫字母和數字，第一個字是字母。會變成檔名和資料夾名。" }));
    box.append(
      el("section", { class: "card" }, [el("h3", {}, "角色 id"), idOut, numRow, slugRow]),
      el("section", { class: "card" }, [el("h3", {}, "名稱與分類"),
        keep(textRow("名稱", () => P().unit.name.replace(/^【自製】/, ""), (v) => { P().unit.name = "【自製】" + v.replace(/^【自製】/, ""); Store.changed("unit"); }, { help: "前面會自動加上「【自製】」。" })),
        el("div", { class: "grid2" }, [
          keep(selectRow("類型", ["力量型", "敏捷型", "智慧型", "魔法型"], () => P().unit.type, (v) => { P().unit.type = v; Store.changed("unit"); })),
          keep(selectRow("屬性", ["無", "火", "水", "木", "光", "暗"], () => P().unit.element, (v) => { P().unit.element = v; Store.changed("unit"); })),
          keep(textRow("星數文字", () => P().unit.star, (v) => { P().unit.star = v; P().stats.s = v; Store.changed("unit"); }, { help: "角色庫篩選用，例如「自製測試」或「8星」。" })),
          keep(textRow("登場日期", () => P().unit.date, (v) => { P().unit.date = v; Store.changed("unit"); }, { placeholder: "YYYY/MM/DD", help: "角色庫排序用。" })),
        ]),
        keep(toggleRow("不能單獨選（召喚物、變形外觀用）", () => !!P().unit.hidden, (v) => { if (v) P().unit.hidden = true; else delete P().unit.hidden; Store.changed("unit"); }, "hiddenOn")),
        el("p", { class: "help" }, "打開後 units.json 會加上 \"hidden\": true：不會出現在角色庫、搜尋、隨機和格鬥場選角，但召喚時照樣會出現。一般角色不要打開。"),
      ]),
    );
    refreshId();
  }
  function setNumId(v) { P().num = clamp(Math.round(v), Store.NUM_MIN, Store.NUM_MAX); applyId(); }
  function setSlug(v) { P().slugDraft = v; if (Store.slugOk(v)) { P().slug = v; applyId(); } refreshId(); }
  function applyId() { const p = P(); p.unit.id = Store.makeId(p.num, p.slug); if (p.meta) p.meta.unit_id = p.unit.id; Store.changed("unit"); }
  function refreshId() {
    const o = $("#idOut"); if (!o) return;
    const p = P(), bad = p.slugDraft != null && !Store.slugOk(p.slugDraft);
    o.innerHTML = `<span class="mono">${p.unit.id}</span>` + (bad ? ` <b class="bad">英文名格式不對，還在用「${p.slug}」</b>` : "") +
      (p.src.kind === "custom" && p.unit.id === p.src.id ? ` <span class="pill">修改現有角色</span>` : ` <span class="pill new">新角色</span>`);
  }

  /* ================= 數值 ================= */
  function buildStats(box) {
    box.replaceChildren();
    const R = Fight.BAL.REF;
    // 快速調整：攻守傾向（改的是體力，讓「體力 ÷ 攻擊力」落在想要的位置）
    const tilt = keep(sliderRow({ label: "攻守傾向", min: -1.2, max: 1.2, step: 0.05, digits: 2,
      help: "往左＝刀尖舔血（體力少、打得痛），往右＝坦克（耐打、打得輕）。拉這條會自動改體力。",
      get: () => { const fs = Editor.fs(); return fs ? +fs.B.t.toFixed(2) : 0; },
      set: (t) => { const fs = Editor.fs(); const off = fs ? fs.B.offRaw : 0; if (off > 0) setArr0("hp", Math.round(off * R.tank * Math.exp(t))); },
      hint: () => { const fs = Editor.fs(); return fs ? `攻擊 <b>${pct(fs.B.off)}</b>　耐久 <b>${pct(fs.B.dur)}</b>` : ""; } }));
    const g1 = el("section", { class: "card" }, [el("h3", {}, "快速調整"), tilt]);
    const g2 = el("section", { class: "card" }, [el("h3", {}, "體力與攻擊"),
      keep(sliderRow({ label: "體力", min: 1000, max: 400000, log: true, digits: 0, get: () => arr0("hp"), set: (v) => setArr0("hp", v),
        help: "格鬥場只看「體力 ÷ 攻擊力」的比例：越大越耐打、打得越輕。",
        hint: () => { const fs = Editor.fs(); return fs && fs.B.offRaw > 0 ? `體力 ÷ 攻擊力＝<b>${fmt(arr0("hp") / fs.B.offRaw, 2)}</b>（平均 ${R.tank}）` : "攻擊力是 0，比例算不出來"; } })),
      keep(sliderRow({ label: "物理攻擊", min: 50, max: 120000, log: true, allowZero: true, digits: 0, get: () => arr0("pa"), set: (v) => setArr0("pa", v), help: "物攻和魔攻加起來算，格鬥場不分物理或魔法。" })),
      keep(sliderRow({ label: "魔法攻擊", min: 50, max: 120000, log: true, allowZero: true, digits: 0, get: () => arr0("ma"), set: (v) => setArr0("ma", v),
        hint: () => { const fs = Editor.fs(); return fs ? `攻擊力（每秒）＝(物攻＋魔攻) ÷ 攻擊間隔＝<b>${fmt(fs.B.offRaw)}</b>（平均 ${fmt(R.off)}）` : ""; } })),
      keep(sliderRow({ label: "攻擊間隔", unit: "秒", min: 0.5, max: 4, step: 0.05, digits: 2, ref: 1.2, get: () => +P().stats.ai, set: (v) => setNum("ai", v),
        help: "兩次普攻之間的秒數。打得慢的每下比較痛，但總輸出略低。",
        hint: () => { const fs = Editor.fs(); return fs ? `格鬥場攻擊週期＝<b>${fs.atk.cd.toFixed(2)} 秒</b>（×0.45，限 0.35～0.8）` : ""; } })),
    ]);
    const g3 = el("section", { class: "card" }, [el("h3", {}, "防禦"),
      keep(sliderRow({ label: "物理防禦", min: 10, max: 60000, log: true, allowZero: true, digits: 0, get: () => arr0("pd"), set: (v) => setArr0("pd", v) })),
      keep(sliderRow({ label: "魔法防禦", min: 10, max: 60000, log: true, allowZero: true, digits: 0, get: () => arr0("md"), set: (v) => setArr0("md", v),
        help: "（物防＋魔防）÷ 體力 換算成減傷 0～20%。減傷越高，體力會打一點折扣（減傷稅）。",
        hint: () => { const fs = Editor.fs(); const h = arr0("hp"); return fs && h ? `防禦 ÷ 體力＝<b>${fmt((arr0("pd") + arr0("md")) / h, 3)}</b>（到 ${R.defHp} 就是減傷上限）→ 減傷 <b>${Math.round(fs.dr * 100)}%</b>` : ""; } })),
    ]);
    const g4 = el("section", { class: "card" }, [el("h3", {}, "機動與射程"),
      keep(sliderRow({ label: "移動速度", min: 20, max: 250, step: 1, digits: 0, ref: R.mv, get: () => +P().stats.mv, set: (v) => setNum("mv", v),
        help: "刻度上的小三角是官方中位數 92。",
        hint: () => { const fs = Editor.fs(); return fs ? `格鬥場走路速度 <b>${fs.walk}</b>（平均 230，限 150～345）` : ""; } })),
      keep(sliderRow({ label: "射程", min: 20, max: 1000, step: 5, digits: 0, ref: R.rg, get: () => +P().stats.rg, set: (v) => setNum("rg", v),
        help: "沒有投射物時：射程小於 200 是近戰，200 以上是瞬間直線（不飛、直接命中）。",
        hint: () => { const fs = Editor.fs(); if (!fs) return ""; const a = fs.atk; return `普攻：<b>${Fight.FORM_LABEL[a.form]}</b>，` + (a.kind === "melee" ? `距離 ${Math.round(a.reach)}` : `距離 ${Math.round(a.range)}`) + `（場地開場相距 440）`; } })),
    ]);
    box.append(g1, g2, g3, g4, buildManual());
  }

  /* ---- 手動指定格鬥場數值（stats.json 的 "fight"，v7.2）：預設關閉，只輸出有改的欄位，不寫 "op" ---- */
  function fightObj() { const st = P().stats; return st.fight || (st.fight = {}); }
  function setFight(path, v) {
    const f = fightObj(), [a, b, c] = path;
    if (b == null) f[a] = v;
    else if (a === "sk") { f.sk = f.sk || [null, null]; f.sk[b] = Object.assign(f.sk[b] || {}, { [c]: v }); }
    else f[a] = Object.assign(f[a] || {}, { [b]: v });
    Store.changed("stats");
  }
  function buildManual() {
    const fs = () => Editor.fs(), on = () => !!P().fightOn;
    const card = el("section", { class: "card manual" + (on() ? "" : " off") });
    const body = el("div", { class: "manual-body" });
    const fill = () => {
      body.replaceChildren();
      if (!on()) return;
      const f = fs().formula, row = (label, path, o) => keep(sliderRow(Object.assign({ label, digits: 0, disabled: () => !on() }, o, {
        get: () => { const F = P().stats.fight || {}; const [a, b, c] = path; const v = b == null ? F[a] : a === "sk" ? F.sk && F.sk[b] && F.sk[b][c] : F[a] && F[a][b]; return v ?? o.def(); },
        set: (v) => setFight(path, v), hint: () => `公式值 ${o.def()}` })));
      body.append(
        row("體力", ["hp"], { min: 400, max: 1600, step: 10, def: () => f.hp }),
        row("減傷", ["dr"], { min: 0, max: 0.2, step: 0.01, digits: 2, def: () => f.dr }),
        row("走路速度", ["walk"], { min: 150, max: 345, step: 1, def: () => f.walk }),
        row("普攻傷害", ["atk", "dmg"], { min: 10, max: 150, step: 1, def: () => fs().atk.dmg }),
        ...[0, 1].filter((s) => fs().sk[s]).map((s) => row(`技能 ${s + 1} 傷害`, ["sk", s, "dmg"], { min: 0, max: 320, step: 1, def: () => fs().sk[s].dmg })),
      );
    };
    card.append(
      el("div", { class: "skill-head" }, [el("h3", {}, "手動指定格鬥場數值"),
        keep(toggleRow("手動", on, (v) => { P().fightOn = v; if (!v) delete P().stats.fight; card.classList.toggle("off", !v); Store.changed("stats"); fill(); }, "fightOn"))]),
      el("p", { class: "help" }, "不建議打開。預設讓網站照公式換算，角色之間才會平衡。打開後會在 stats.json 加上 \"fight\"，只寫你拉過的欄位。"),
      P().droppedOp ? el("p", { class: "note" }, "這隻原本有 \"op\": true（超模標示），編輯器已經拿掉，匯出時不會寫。") : null, body);
    fill();
    return card;
  }

  /* ================= 技能 ================= */
  const skOf = (s) => P().stats.sk && P().stats.sk[s];
  const fxOf = (s) => P().fx && P().fx[s];
  function dmgPercent(s) {
    const f = fxOf(s); if (f && Array.isArray(f.fx)) { const d = f.fx.find((e) => e.c === "DMG"); return d && d.m ? +d.m.percent || 0 : 0; }
    const k = skOf(s); const h = k && (k.e || []).find((e) => e.t === "hit"); return h ? h.c * 100 : 0;
  }
  // 倍率：同時寫進 stats.json 的 e 和 skill_fx.json 的 DMG（0＝這招沒有傷害）
  function setDmgPercent(s, pctV) {
    const k = skOf(s);
    if (k) { k.e = k.e || []; let h = k.e.find((e) => e.t === "hit"); if (!h) { h = { t: "hit", c: 0, b: "atk", d: 0 }; k.e.unshift(h); } h.c = +(pctV / 100).toFixed(2); }
    if (!P().fx) P().fx = [null, null];
    if (!P().fx[s]) P().fx[s] = Store.blankFx(k ? k.cd : 6, 0);
    const list = P().fx[s].fx = P().fx[s].fx || [];
    let d = list.find((e) => e.c === "DMG");
    if (pctV <= 0) { if (d) list.splice(list.indexOf(d), 1); }
    else { if (!d) { d = { c: "DMG", m: { kind: "statPercent", stat: "ATK" } }; list.unshift(d); } d.m = Object.assign(d.m || {}, { kind: "statPercent", stat: "ATK", percent: Math.round(pctV) }); }
    Store.changed("skill");
  }
  function setCd(s, v) {
    const k = skOf(s); if (k) k.cd = v; if (fxOf(s)) fxOf(s).cd = v;
    if (P().skills[s]) P().skills[s].cooldown = v.toFixed(1) + "秒";
    Store.changed("skill");
  }
  function setRate(s, v) {
    const k = skOf(s); if (k) k.r = v; if (fxOf(s)) fxOf(s).rate = v;
    if (P().skills[s]) P().skills[s].rate = v.toFixed(1) + "%";
    Store.changed("skill");
  }
  function setSkillOn(s, on) {
    const p = P();
    if (!on) { p.stats.sk[s] = null; if (p.fx) p.fx[s] = null; p.skills[s] = null; }
    else { const d = Store.blankStats().sk[s]; p.stats.sk[s] = d; if (!p.fx) p.fx = [null, null]; p.fx[s] = Store.blankFx(d.cd, d.e[0].c * 100); p.skills[s] = Store.blankSkill(s + 1); }
    Store.changed("skill"); buildSkills($("#tab-skills"));
  }

  function buildSkills(box) {
    box.replaceChildren();
    for (const s of [0, 1]) {
      const exists = !!skOf(s) || !!fxOf(s);
      const card = el("section", { class: "card skill" + (exists ? "" : " off") });
      const head = el("div", { class: "skill-head" }, [el("h3", {}, `技能 ${s + 1}`)]);
      if (s === 1) head.append(keep(toggleRow("有技能 2", () => !!skOf(1) || !!fxOf(1), (v) => setSkillOn(1, v), "sk2on")));
      card.append(head);
      if (!exists) { card.append(el("p", { class: "help" }, "沒有技能 2 的角色，普攻會加強 25%（技能少的補償）。")); box.append(card); continue; }
      const sk = () => P().skills[s] || (P().skills[s] = Store.blankSkill(s + 1));
      const fx = fxOf(s), others = fx && fx.fx ? fx.fx.filter((e) => e.c !== "DMG") : [];
      card.append(
        keep(textRow("技能名稱", () => sk().name, (v) => { sk().name = v; Store.changed("skill"); })),
        keep(textRow("說明", () => sk().desc, (v) => { sk().desc = v; Store.changed("skill"); }, { multi: true })),
        keep(sliderRow({ label: "冷卻", unit: "秒", min: 1, max: 30, step: 0.5, digits: 1, get: () => (skOf(s) ? +skOf(s).cd : fx ? +fx.cd : 6), set: (v) => setCd(s, v),
          help: s ? "格鬥場技能 2 限制 8～15 秒。冷卻越長，傷害越高。" : "格鬥場技能 1 限制 4～10 秒。冷卻越長，傷害越高。",
          hint: () => { const o = Editor.fs() && Editor.fs().sk[s]; return o ? `格鬥場冷卻 <b>${o.cd.toFixed(1)} 秒</b>` + (o.cd !== o.cdRaw ? `（超出範圍，被限制了）` : "") : ""; } })),
        keep(sliderRow({ label: "傷害倍率", unit: "%", min: 0, max: 6000, step: 10, digits: 0, get: () => dmgPercent(s), set: (v) => setDmgPercent(s, v),
          help: "攻擊力 × 多少%。在格鬥場只用來比「技能 1、2 誰比較痛」（壓縮過，原作差 10 倍 → 約差 2 倍）。設成 0＝這招沒有傷害。",
          hint: () => { const o = Editor.fs() && Editor.fs().sk[s]; return o ? (o.dmg ? `格鬥場傷害 <b>${o.dmg}</b>` : `<b>沒有傷害</b>`) : ""; } })),
        keep(sliderRow({ label: "作用範圍", min: 0, max: 800, step: 10, digits: 0, get: () => (skOf(s) ? +skOf(s).ar || 0 : 0), set: (v) => { if (skOf(s)) { skOf(s).ar = v; Store.changed("skill"); } },
          help: "指定位置打擊的寬度。範圍越大越好打中，傷害打一點折扣（0.8～1.2 倍）。0＝用預設寬度。",
          hint: () => { const o = Editor.fs() && Editor.fs().sk[s]; return o && o.kind === "rect" ? `格鬥場寬度 <b>${Math.round(o.width)}</b>` : o ? `這招是「${Fight.FORM_LABEL[o.form]}」，不用寬度` : ""; } })),
        keep(sliderRow({ label: "發動率", unit: "%", min: 0, max: 100, step: 1, digits: 0, get: () => (skOf(s) ? +skOf(s).r : fx ? +fx.rate : 30), set: (v) => setRate(s, v),
          help: "顯示用（單人、雙人模式），格鬥場不用。" })),
        keep(textRow("發動條件（顯示用）", () => sk().trigger, (v) => { sk().trigger = v; Store.changed("skill"); }, { placeholder: "前方敵人" })),
      );
      if (others.length) card.append(el("div", { class: "fxlist" }, [el("span", { class: "label" }, "技能效果"),
        ...others.map((e) => el("span", { class: "chip " + Fight.fxSup(e.c), title: e.c }, Fight.fxName(e.c))),
        el("p", { class: "help" }, "效果的新增與參數在階段 4 開放編輯。")]));
      box.append(card);
    }
  }

  /* ================= 格鬥場換算（右側） ================= */
  function radar(q) {
    // 五種能力的分數（平均＝ 1，圖上的虛線圈）；0.5～1.5 對到半徑 20%～100%
    const keys = [["off", "攻擊"], ["dur", "耐久"], ["mob", "機動"], ["rng", "射程"], ["ctl", "控制"]];
    const R = 70, cx = 100, cy = 92, rr = (v) => R * clamp((v - 0.3) / 1.2, 0.05, 1);
    const pt = (i, r) => [cx + r * Math.sin(i * 2 * Math.PI / 5), cy - r * Math.cos(i * 2 * Math.PI / 5)];
    const poly = (f) => keys.map((k, i) => pt(i, f(k, i)).map((x) => x.toFixed(1)).join(",")).join(" ");
    return `<svg viewBox="0 0 200 180" class="radar" role="img" aria-label="五種能力">
      <polygon points="${poly(() => R)}" class="r-grid"/><polygon points="${poly(() => rr(1))}" class="r-avg"/>
      ${keys.map((k, i) => { const [x, y] = pt(i, R); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="r-axis"/>`; }).join("")}
      <polygon points="${poly(([k]) => rr(q[k]))}" class="r-val"/>
      ${keys.map(([k, n], i) => { const [x, y] = pt(i, R + 14); return `<text x="${x}" y="${y + 4}" text-anchor="middle" class="r-label">${n}</text>`; }).join("")}
    </svg>`;
  }
  function renderResult() {
    const box = $("#result"), fs = Editor.fs();
    if (!fs) return;
    const a = fs.atk, B = fs.B, fr = (k, m) => fs.frames(k, m).join("／");
    const clipNote = (o, lo, hi) => (o.raw == null ? `<span class="warn">沒有動畫，先用 ${lo} 秒算</span>` : o.raw < lo || o.raw > hi ? `<span class="warn">動畫 ${o.raw.toFixed(2)} 秒，超出 ${lo}～${hi} 被截成 ${o.dur.toFixed(2)}</span>` : `動畫 ${o.dur.toFixed(2)} 秒`);
    const skRow = (o, s) => !o ? `<div class="mv off"><div class="mv-name">技能 ${s + 1}</div><div class="mv-val">沒有</div></div>` :
      `<div class="mv"><div class="mv-name">技能 ${s + 1}<small>${Fight.FORM_LABEL[o.form]}</small></div>
        <div class="mv-val">${o.form === "self" || o.form === "buff" ? "自身" : o.dmg || "0"}</div>
        <div class="mv-sub">冷卻 ${o.cd.toFixed(1)} 秒・前搖／有效／後搖 ${fr(o, false)} 格・${clipNote(o, 0.4, 1.0)}${o.clipSub ? "（借用普攻動畫）" : ""}</div></div>`;
    const icon = { unfit: "⛔", todo: "⚠", guess: "？", info: "ⓘ" };
    box.innerHTML = `
      ${fs.manual ? `<p class="note">已打開「手動指定格鬥場數值」，部分數字是你手寫的，不是公式算的。</p>` : ""}
      ${fs.preset ? `<p class="note">這隻在網站程式裡有手寫數值，格鬥場目前用手寫的；下面是照公式算的結果（另存成新角色就會用這些）。</p>` : ""}
      <div class="big4">
        <div><span>體力</span><b>${fs.hp}</b></div><div><span>減傷</span><b>${Math.round(fs.dr * 100)}%</b></div>
        <div><span>走路</span><b>${fs.walk}</b></div><div><span>普攻</span><b>${a.dmg}</b></div>
      </div>
      <div class="radar-wrap">${radar(B.q)}
        <div class="mults"><div>攻擊倍率 <b>${pct(B.off)}</b></div><div>耐久倍率 <b>${pct(B.dur)}</b></div><div>控制效果 <b>${B.ctl}</b> 個</div>
        <div class="help">五種能力加權總和 ${B.sum.toFixed(2)}${B.sum > 1.005 ? "，超過 1：攻、守一起打折" : B.sum < 0.995 ? "，低於 1：攻、守一起加強" : ""}</div></div></div>
      <div class="moves">
        <div class="mv"><div class="mv-name">普攻<small>${Fight.FORM_LABEL[a.form]}</small></div><div class="mv-val">${a.dmg}</div>
          <div class="mv-sub">週期 ${a.cd.toFixed(2)} 秒・前搖／有效／後搖 ${fr(a, a.kind === "melee")} 格・${clipNote(a, 0.3, 0.6)}</div></div>
        ${fs.sk.map(skRow).join("")}
      </div>
      ${fs.N.issues.length ? `<ul class="issues">${fs.N.issues.map(([l, w, m]) => `<li class="${l}">${icon[l]} <b>${w}</b>　${m}</li>`).join("")}</ul>` : `<p class="ok">✓ 資料完整，格鬥場可以正常使用</p>`}`;
  }

  return { buildBasic, buildStats, buildSkills, renderResult, syncAll, refreshId, reset: () => (rows.length = 0) };
})();
