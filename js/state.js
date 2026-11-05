/* ---------- 專案資料（正在編輯的這隻角色） ----------
   P（目前的專案）：
     src      { kind: new／custom／data, id }  從哪裡開始的
     unit     units.json 的那一筆（id、name、star、type、element、date、custom）
     stats    stats.json 的那一筆（hp、pa、ma、pd、md、ai、mv、rg、sk…）
     skills   skills.json 的那一筆（兩個技能的名稱、說明…）
     fx       skill_fx.json 的那一筆（可以是 null）
     proj     projectiles.json 的那一筆（可以是 null）
     meta     units/<id>.json（部件、圖片拼接、動畫）
     images   { body, bul, bul2, bul3, thum140, thum, icon1, icon2 }：Blob
   編輯中的內容自動存在瀏覽器（IndexedDB），重新打開頁面可以接著做。 */
"use strict";

const Store = (() => {
  let P = null;
  const listeners = new Set();

  // 改了資料就通知畫面更新（what：哪一類資料變了，例如 "stats"、"meta"）
  function changed(what) {
    for (const fn of listeners) fn(what);
    autosave();
  }
  const on = (fn) => listeners.add(fn);

  /* ---- 新角色的預設值（約等於官方的中位數角色） ---- */
  function blankStats() {
    return {
      s: "自製測試", hp: [91000, 9100, 9100], pa: [9000, 900, 900], ma: [0, 0, 0], pd: [1100, 110, 110], md: [720, 72, 72],
      cr: 0, cd: 100, hit: 0, dg: 0, sh: 0, sdg: 0, ai: 1.2, mv: 92, rg: 150, sr: 0,
      sk: [{ r: 30, cd: 6, e: [{ t: "hit", c: 2.0, b: "atk", d: 0 }], ar: 300 }, { r: 20, cd: 10, e: [{ t: "hit", c: 3.5, b: "atk", d: 0 }], ar: 300 }],
    };
  }
  // 技能效果（skill_fx.json）：新角色預設只有傷害；倍率 percent 200＝攻擊力 × 200%
  const blankFx = (cd, percent) => ({ cd, rate: 30, trig: "SEARCH", fx: [{ c: "DMG", m: { kind: "statPercent", stat: "ATK", percent } }] });
  const blankSkill = (n) => ({ name: `技能${n}`, rate: n === 1 ? "30.0%" : "20.0%", trigger: "前方敵人", cooldown: n === 1 ? "6.0秒" : "10.0秒", desc: "" });

  // 一組部件（body、bul…）的空白結構
  const blankPart = () => ({ anim_rate: 30, png: "", images: [], sprites: {}, animations: {} });

  function newProject() {
    return {
      v: 1, src: { kind: "new", id: null },
      unit: { id: "", name: "【自製】新角色", star: "自製測試", type: "力量型", element: "無", date: todayStr(), custom: true },
      slug: "hero", num: null,
      stats: blankStats(), skills: [blankSkill(1), blankSkill(2)], fx: [blankFx(6, 200), blankFx(10, 350)], proj: null, grade: null,
      // 新角色：還沒有動畫，先用「基本姿勢」自動產生靜止的動作（autoAnim），階段 3 再做真正的動畫
      meta: { unit_id: "", parts: { body: blankPart() } }, images: {}, sprites: {}, pose: [], autoAnim: true,
      fightOn: false,   // 手寫格鬥場數值（stats.json 的 "fight"）：預設不輸出，讓網站照公式換算
    };
  }

  /* 從網站讀進來的角色 → 專案。官方角色會變成「另存的新自製角色」：換新 id、名稱加【自製】 */
  function fromLoaded(kind, id, d) {
    const p = newProject();
    p.src = { kind, id };
    Object.assign(p, { stats: d.stats || blankStats(), skills: d.skills && d.skills.length ? d.skills : p.skills, fx: d.fx, proj: d.proj, grade: d.grade, meta: d.meta, images: d.images, autoAnim: false, pose: [] });
    // v7.2：stats.json 的 "fight"（手寫格鬥場數值）。讀進來就保留並打開開關；"op"（超模標示）一律拿掉
    if (p.stats.fight) { p.fightOn = true; if (p.stats.fight.op) { delete p.stats.fight.op; p.droppedOp = true; } }
    while (p.skills.length < 2) p.skills.push(null);
    Object.assign(p.unit, d.unit || {}, { custom: true });
    const m = /^x(\d{3})(?:sk\d*)?-([a-z0-9]+)$/.exec(id) || /^u\d+[a-z]*-([a-z0-9]+)$/.exec(id);
    // 編輯器只能覆蓋 x003～x100 的角色；網站內建（x001、x002）與手工角色（x101～x199）會另存成新角色
    if (kind === "custom" && m && numOk(+m[1])) { p.num = +m[1]; p.slug = m[2]; }
    else {
      p.slug = m ? m[m.length - 1] : "hero";
      p.unit.name = "【自製】" + (d.unit && d.unit.name ? d.unit.name : id).replace(/^【自製】/, "");
      p.unit.star = "自製測試"; p.unit.date = todayStr();
      if (kind === "data") p.officialSource = id;   // 匯出時提醒：圖片是官方素材
    }
    return p;
  }

  /* ---- id：x＋三位數字＋英文小寫名（避開已經用過的號碼）
     v7.2：編輯器做的角色只用 x003～x100；x001、x002 是網站內建測試角色，x101～x199 保留給網站手工角色與擴充包。
     召喚物＝本體編號＋sk＋序號，例如 x003sk1-dragon。 ---- */
  const NUM_MIN = 3, NUM_MAX = 100;
  const numOk = (n) => Number.isInteger(n) && n >= NUM_MIN && n <= NUM_MAX;
  function usedNumbers(customIndex) {
    const used = new Set();
    for (const r of customIndex) { const m = /^x(\d{3})/.exec(r.id); if (m) used.add(+m[1]); }
    return used;
  }
  function nextFreeNumber(customIndex, keep) {
    const used = usedNumbers(customIndex);
    if (keep && numOk(keep) && !used.has(keep)) return keep;
    let n = NUM_MIN; while (used.has(n) && n <= NUM_MAX) n++;
    return n <= NUM_MAX ? n : null;   // null＝x003～x100 都用完了
  }
  const makeId = (num, slug) => `x${String(num).padStart(3, "0")}-${slug}`;
  const slugOk = (s) => /^[a-z][a-z0-9]{0,23}$/.test(s);
  const summonId = (num, n, slug) => `x${String(num).padStart(3, "0")}sk${n}-${slug}`;

  /* ---- 自動暫存（IndexedDB；不能用時就只存在記憶體裡） ---- */
  const DB = "ranger-editor", OS = "projects";
  function idb() {
    return new Promise((res, rej) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(OS);
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
  }
  async function idbDo(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => { const tx = db.transaction(OS, mode); const q = fn(tx.objectStore(OS)); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); });
  }
  const autosave = debounce(async () => {
    if (!P) return;
    try { await idbDo("readwrite", (os) => os.put(P, "current")); $("#saveState") && ($("#saveState").textContent = "已自動暫存 " + new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })); }
    catch { $("#saveState") && ($("#saveState").textContent = "這個瀏覽器不能暫存"); }
  }, 800);
  async function restore() { try { return (await idbDo("readonly", (os) => os.get("current"))) || null; } catch { return null; } }

  return {
    get P() { return P; }, set(p) { P = p; changed("all"); }, changed, on,
    newProject, fromLoaded, blankSkill, blankFx, blankStats, blankPart, numOk, summonId, NUM_MIN, NUM_MAX, nextFreeNumber, usedNumbers, makeId, slugOk, restore,
  };
})();
