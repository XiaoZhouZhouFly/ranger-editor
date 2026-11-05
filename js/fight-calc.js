/* ---------- 格鬥場換算（照網站原始碼移植） ----------
   來源（網站 v6.4／平衡 v5.4）：
     src/js-18-fight-norm.js   normUnit（資料 → 標準化）
     src/js-18-fight-data.js   FT、BAL、fightBudget、fightAtkDmg、fightSkDmg、fightStats
     src/js-11-duel-engine.js  hitFrac（出手時機）
   網站調了平衡（改 BAL 或 FT）時，同步改這個檔的 FT、BAL 即可；效果表用 tools/gen_fx_table.py 重新產生。
   跟網站不同的地方：網站讀全域的 S.stats 等，這裡改成直接吃專案資料 P。 */
"use strict";

const Fight = (() => {
  const FT = {
    CH: 170, MELEE_RG: 200, DR_MAX: 0.2,
    RG_REACH: 0.6, REACH_MIN: 70, REACH_MAX: 150, DLINE_MIN: 150, DLINE_MAX: 560,
    RG_CAST: 1.4, CAST_MIN: 220, CAST_MAX: 700, RG_LOB: 1.2, LOB_MIN: 260, LOB_MAX: 620,
    AR_WIDTH: 0.5, WIDTH_MIN: 90, WIDTH_MAX: 260, WIDTH_DEF: 160,
    SPEED_K: 20, SPEED_MIN: 300, SPEED_MAX: 1000, SPEED_DEF: 600,
    LOB_TIME: 0.8, LOB_V0: 20, LOB_TMIN: 0.55, LOB_TMAX: 1.1,
    DASH_K: 2, DASH_DEF: 300, DASH_MAX: 700, ACTIVE: 4 / 60, STEP: 1 / 60,
  };
  const BAL = {
    REF: { off: 7682, tank: 12.14, defHp: 0.042, mv: 92, rg: 220 },
    W: { off: 0.30, dur: 0.25, mob: 0.15, rng: 0.15, ctl: 0.15 },
    CAP: [0.5, 1.5], TILT: 0.4, CTL_PER: 0.15, EHP: 900, WALK: 230, ATK_BASE: 47,
    SK_BASE: [155, 155], SK_CLAMP: [60, 320],
    FORM: { melee: 0.85, dline: 0.9, line: 1.0, shot: 1.0, dash: 1.1, lob: 1.1, target: 1.15, rect: 1.15 },
    CTL_DMG: 0.8, DR_TAX: 0.5, NO_SK: 0.25,
  };
  // 網站的 CLIPS（動作 → 依序找哪些動畫名稱），見 src/js-00-core.js
  const CLIPS = {
    idle: ["idle", "wait"], move: ["walk"], attack: ["attack_all", "attack", "attack_a", "attack_b"],
    skill1: ["s_attack_all", "s_action_attack_all", "s_attack", "s_attack_a", "s_attack_b", "s_action_attack_2", "s_action_attack_3"],
    skill2: ["s2_attack_all", "s2_attack", "s2_attack_a", "s2_attack_b", "skill"], knockback: ["knockback"],
  };
  // 自製角色寫在網站程式裡的手寫數值（只有這兩隻；新角色都用公式）
  const PRESET_IDS = new Set(["x001-cube", "x002-orb"]);

  const FORM_LABEL = { dash: "突進", melee: "近戰", dline: "瞬間直線", line: "直線投射物", lob: "拋物線", target: "指定位置打擊", self: "自身", buff: "輔助（代替）" };
  const FORM_KIND = { atk: { melee: "melee", dline: "dline", line: "shot", lob: "lob" }, sk: { dash: "dash", target: "rect", line: "line", lob: "lob", self: "self", buff: "buff" } };

  // 效果模組：決定表裡、而且網站有實作處理方式的代碼＝已支援
  const FIGHT_FX = {};
  for (const [code, row] of Object.entries(FX_TABLE)) {
    const B = FX_BEHAVIOR_KEYS[row.b];
    if (B) FIGHT_FX[code] = { to: row.to, b: row.b, form: B.form };
  }
  const fxName = (c) => (FX_TABLE[c] && FX_TABLE[c].name) || ({ DMG: "傷害", DOT: "持續傷害" }[c]) || c;
  const fxSup = (c) => (FIGHT_FX[c] ? "ok" : FX_TABLE[c] && FX_TABLE[c].b === "none" ? "none" : "todo");
  const isControl = (c) => !!(FIGHT_FX[c] && FX_CONTROL.has(FIGHT_FX[c].b));

  const fclamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const bclamp = (x) => fclamp(x, BAL.CAP[0], BAL.CAP[1]);
  const first = (v) => (Array.isArray(v) ? +v[0] : +v);
  function field(obj, key, def) {
    const raw = obj && obj[key] != null ? (Array.isArray(obj[key]) ? obj[key][0] : obj[key]) : undefined;
    if (raw === undefined) return { v: def, st: "missing" };
    const v = +raw;
    if (!Number.isFinite(v)) return { v: def, st: "bad" };
    return { v, st: v === 0 ? "zero" : "ok" };
  }

  // 出手時機（佔動作長度的比例）：有 *_ready 就依它算，沒有就是一半
  function hitFrac(part, anim) {
    const a = part && part.animations[anim];
    if (!a) return 0.5;
    if (anim.endsWith("_all")) {
      const ready = part.animations[anim.replace(/_all$/, "_ready")] || part.animations[anim.replace(/attack_all$/, "attack_ready")];
      if (ready) return Math.max(0.2, Math.min(0.9, (ready.frame_count + (a.frame_count - ready.frame_count) * 0.3) / a.frame_count));
    }
    return 0.5;
  }

  const moving = (c) => !!(c && c.v > 0 && c.e);
  function delivery(cfg, rg, isAtk) {
    const m = cfg ? String(cfg.m || "NONE") : null;
    const near = (note) => ({ form: rg < FT.MELEE_RG ? "melee" : "dline", note });
    if (!cfg) return isAtk ? near("沒有投射物設定，依射程判斷") : { form: "target" };
    if ((m === "LINEAR" || m === "CURVE") && moving(cfg)) return { form: m === "LINEAR" ? "line" : "lob" };
    if (m === "LINEAR" || m === "CURVE") return isAtk ? near("投射物不會移動，當成直接命中") : { form: "target", note: "投射物不會移動，當成指定位置打擊" };
    if (m === "DIRECT" || m === "NONE") return isAtk ? near() : { form: "target" };
    return { form: isAtk ? "line" : "target", note: `${m} 未支援` };
  }

  /* 標準化（同網站 normUnit 的邏輯）。issues：[等級, 位置, 說明]；等級 unfit／todo／guess／info */
  function norm(P) {
    const st = P.stats, pj = P.proj, fxAll = P.fx, part = P.meta && P.meta.parts && P.meta.parts.body;
    const anims = new Set(part ? Object.keys(part.animations || {}).filter((n) => part.animations[n].frames && part.animations[n].frames.length) : []);
    const clips = {}; for (const k in CLIPS) clips[k] = CLIPS[k].find((n) => anims.has(n)) || null;
    const N = { f: {}, clips, issues: [], sk: [] };
    const issue = (l, w, m) => N.issues.push([l, w, m]);
    const grade = P.grade; N.lvMax = grade ? FX_MAXLEVEL[grade[0] + "|" + grade[1]] || 0 : 0;
    for (const [k, def] of [["hp", null], ["pd", 0], ["md", 0], ["rg", 150], ["mv", 90], ["ai", 1.2], ["pa", 0], ["ma", 0]]) N.f[k] = field(st, k, def);
    if (!clips.idle && !clips.attack) issue("unfit", "動作", "還沒有待機和普攻動畫（格鬥場選不到）");
    const rg = N.f.rg.v;
    const d = delivery(pj && pj.n, rg, true);
    N.atk = { form: d.form, cfg: (pj && pj.n) || null, clip: clips.attack };
    if (d.note) issue("guess", "普攻", d.note);
    if (!N.atk.clip && clips.idle) issue("guess", "普攻", "沒有普攻動畫（用待機代替）");
    for (const s of [0, 1]) {
      const where = `技能${s + 1}`, base = st && st.sk && st.sk[s], fxs = fxAll && fxAll[s];
      if (!base && !fxs) { N.sk.push({ s, exists: false }); continue; }
      const k = { s, exists: true, clip: clips[s ? "skill2" : "skill1"], clipSub: false, fx: [], cfg: (pj && pj[s ? "s2" : "s1"]) || null };
      if (!k.clip) { k.clip = clips.attack; k.clipSub = true; if (clips.attack) issue("guess", where, "沒有技能動畫（用普攻動畫代替）"); }
      if (fxs && Array.isArray(fxs.fx)) {
        k.fx = fxs.fx.map((e) => {
          const c = String(e.c || ""), m = e.m || {}, dd = e.d || {}, sec = +dd.seconds || 0;
          const val = [m.value, m.percent, m.amount].find((x) => typeof x === "number");
          const durLv = dd.kind === "levelFormula" ? +dd.amount || 0 : dd.kind === "gradeCalculated" && sec > 0 && sec < 1 ? sec : 0;
          return { c, label: fxName(c), sup: fxSup(c), dur: durLv ? 0 : sec, durLv, r: +e.r || 0, val: val == null ? null : val, mk: m.kind || null };
        });
      } else if (base) {
        k.fx = (base.e || []).map((e) => (e.t === "dot" ? { c: "DOT", label: "持續傷害", sup: "ok", dur: +e.d || 0, r: 0, val: null } : { c: "DMG", label: "傷害", sup: "ok", dur: 0, r: 0, val: null }));
      }
      k.cd = field(base, "cd", null); if (k.cd.st === "missing" && fxs && fxs.cd != null) k.cd = { v: +fxs.cd, st: "ok" };
      const fxR = Math.max(0, ...k.fx.map((e) => e.r));
      k.effectRange = base && +base.ar > 0 ? +base.ar : fxR > 0 ? fxR : null;
      const to = (e) => FIGHT_FX[e.c] && FIGHT_FX[e.c].to;
      k.damaging = k.fx.some((e) => e.c === "DMG" || e.c === "DOT" || ((e.c === "STUN" || e.c === "KNOCKBACK") && e.mk === "statPercent"));
      const toEnemy = k.fx.some((e) => to(e) === "enemy"), toSelf = k.fx.some((e) => to(e) === "self");
      if (k.fx.some((e) => FIGHT_FX[e.c] && FIGHT_FX[e.c].form === "dash")) k.form = "dash";
      else if (k.damaging || toEnemy) { const dd = delivery(k.cfg, rg, false); k.form = dd.form; if (dd.note) issue("guess", where, dd.note); }
      else if (toSelf) k.form = "self";
      else { k.form = "buff"; issue("todo", where, "效果全都還沒支援，格鬥場暫時用「加攻＋回血」代替"); }
      if (k.form === "target" && !k.effectRange) issue("guess", where, "沒有作用範圍，用預設寬度 160");
      const todo = [...new Set(k.fx.filter((e) => e.sup === "todo").map((e) => e.label))];
      if (todo.length) issue("todo", where, todo.join("、") + " 格鬥場未支援");
      N.sk.push(k);
    }
    return N;
  }

  // 五種能力分預算（同網站 fightBudget）
  function budget(F, sk) {
    const R = BAL.REF, off = (F.pa.v + F.ma.v) / Math.max(0.5, F.ai.v || 1.2);
    const t = off > 0 && F.hp.st === "ok" ? fclamp(Math.log(F.hp.v / off / R.tank), -1.2, 1.2) : 0;
    const ctl = sk.reduce((n, k) => n + (k ? k.enemyFx.filter((e) => isControl(e.c)).length : 0), 0);
    const q = { off: Math.exp(-BAL.TILT * t), dur: Math.exp(BAL.TILT * t), mob: bclamp(Math.pow((F.mv.v || R.mv) / R.mv, 0.7)),
      rng: bclamp(Math.pow((F.rg.v || R.rg) / R.rg, 0.5)), ctl: 1 + BAL.CTL_PER * ctl };
    const sum = Object.keys(BAL.W).reduce((a, k) => a + BAL.W[k] * q[k], 0);
    const hp = F.hp.st === "ok" ? F.hp.v : 0;
    return { off: bclamp(q.off / sum), dur: bclamp(q.dur / sum), walk: BAL.WALK * q.mob, ctl, q, sum, t, offRaw: off,
      dr: hp > 0 ? +(FT.DR_MAX * fclamp((F.pd.v + F.md.v) / hp / R.defHp, 0, 1)).toFixed(3) : 0 };
  }

  /* 主函式：專案 → 格鬥場數值（同網站 fightStats，不含手寫數值） */
  function stats(P) {
    const N = norm(P), F = N.f, part = P.meta && P.meta.parts && P.meta.parts.body;
    const rg = F.rg.v, ai = F.ai.v || 1.2;
    const clipLen = (clip) => (clip && part && part.animations[clip] ? part.animations[clip].frame_count / (part.anim_rate || 24) : null);
    const dur = (clip, lo, hi) => { const x = clipLen(clip); return fclamp(x == null ? lo : x, lo, hi); };
    const a = N.atk, ad = dur(a.clip, 0.3, 0.6);
    const atk = { form: a.form, kind: FORM_KIND.atk[a.form], clip: a.clip, raw: clipLen(a.clip), dur: ad,
      cd: Math.max(ad, fclamp(ai * 0.45, 0.35, 0.8)), hitAt: ad * (a.clip ? hitFrac(part, a.clip) : 0.5),
      reach: fclamp(rg * FT.RG_REACH, FT.REACH_MIN, FT.REACH_MAX),
      range: a.form === "lob" ? fclamp(rg * FT.RG_LOB, FT.LOB_MIN, FT.LOB_MAX) : fclamp(rg * FT.RG_REACH, FT.DLINE_MIN, FT.DLINE_MAX),
      speed: a.cfg && a.cfg.v > 0 ? fclamp(a.cfg.v * FT.SPEED_K, FT.SPEED_MIN, FT.SPEED_MAX) : FT.SPEED_DEF };
    const sk = N.sk.map((k, s) => {
      if (!k.exists) return null;
      const d = dur(k.clip, 0.4, 1.0);
      const dashFx = k.fx.find((x) => FIGHT_FX[x.c] && FIGHT_FX[x.c].form === "dash");
      const o = { s, form: k.form, kind: FORM_KIND.sk[k.form], clip: k.clip, clipSub: k.clipSub, raw: clipLen(k.clip), dur: d, hitAt: d * hitFrac(part, k.clip),
        cdRaw: k.cd.v, cd: s ? fclamp(k.cd.v || 12, 8, 15) : fclamp(k.cd.v || 6, 4, 10),
        range: k.form === "lob" ? fclamp(rg * FT.RG_LOB, FT.LOB_MIN, FT.LOB_MAX) : k.form === "dash" ? Math.min(FT.DASH_MAX, (dashFx && dashFx.val > 0 ? dashFx.val : FT.DASH_DEF) * FT.DASH_K) : fclamp(rg * FT.RG_CAST, FT.CAST_MIN, FT.CAST_MAX),
        width: k.effectRange ? fclamp(k.effectRange * FT.AR_WIDTH, FT.WIDTH_MIN, FT.WIDTH_MAX) : FT.WIDTH_DEF, fx: k.fx };
      const seen = new Set(), sup = k.fx.filter((e) => FIGHT_FX[e.c] && e.c !== "DMG" && !seen.has(e.c) && seen.add(e.c));
      o.enemyFx = sup.filter((e) => FIGHT_FX[e.c].to === "enemy" || (e.c.startsWith("SUMMON") && k.form !== "self" && k.form !== "buff"));
      o.selfFx = sup.filter((e) => !o.enemyFx.includes(e));
      o.damaging = k.damaging; o.mul = (k.fx.find((e) => e.c === "DMG" && e.val > 0) || {}).val || 0;
      return o;
    });
    const B = budget(F, sk), nSk = sk.filter(Boolean).length;
    atk.dmg = Math.round(BAL.ATK_BASE * Math.pow(atk.cd / 0.55, 0.6) * (BAL.FORM[atk.kind] || 1) * B.off * (1 + BAL.NO_SK * (2 - nSk)));
    const m = sk.map((o) => (o && o.mul) || 0), r = m[0] && m[1] ? fclamp(Math.pow(m[1] / m[0], 0.3), 0.5, 2) : 1;
    sk.forEach((o, s) => {
      if (!o) return;
      const ratio = s ? Math.sqrt(r) : 1 / Math.sqrt(r);
      const wF = o.kind === "rect" ? fclamp(Math.pow(160 / o.width, 0.25), 0.8, 1.2) : 1;
      const cF = o.enemyFx.some((e) => isControl(e.c)) ? BAL.CTL_DMG : 1;
      const x = BAL.SK_BASE[s] * Math.pow(o.cd / 7, 0.4) * Math.pow(o.dur / 0.8, 0.3) * (BAL.FORM[o.kind] || 1) * wF * cF * ratio * B.off;
      o.factors = { cd: Math.pow(o.cd / 7, 0.4), dur: Math.pow(o.dur / 0.8, 0.3), form: BAL.FORM[o.kind] || 1, width: wF, ctl: cF, ratio, off: B.off };
      o.dmg = o.damaging === false ? 0 : Math.round(fclamp(x, BAL.SK_CLAMP[0], BAL.SK_CLAMP[1]));
    });
    let dr = B.dr;
    /* v7.2：stats.json 的 "fight" 手寫數值（只蓋過有寫的欄位）。編輯器預設不輸出，使用者打開「手動指定」才算 */
    const ov = P.fightOn && P.stats && P.stats.fight;
    if (ov) {
      if (ov.dr != null) dr = ov.dr;
      if (ov.atk) Object.assign(atk, ov.atk);
      (ov.sk || []).forEach((o, s) => { if (o && sk[s]) Object.assign(sk[s], o); });
    }
    const frames = (k, melee) => { const act = melee ? FT.ACTIVE : FT.STEP; const f = (x) => Math.round(x * 60); return [f(k.hitAt), f(act), Math.max(0, f(k.dur - k.hitAt - act))]; };
    const hp = Math.round(BAL.EHP * B.dur * (1 - dr) * (1 - BAL.DR_TAX * dr)), walk = Math.round(fclamp(B.walk, 150, 345));
    return {
      hp: ov && ov.hp != null ? ov.hp : hp, dr, walk: ov && ov.walk != null ? ov.walk : walk, formula: { hp, dr: B.dr, walk },
      atk, sk, B, N, frames, preset: PRESET_IDS.has(P.unit.id) && !ov, manual: !!ov,
    };
  }

  return { stats, FT, BAL, FORM_LABEL, FIGHT_FX, fxName, fxSup, isControl, CLIPS, hitFrac };
})();
