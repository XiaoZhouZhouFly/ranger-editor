/* ---------- 編輯器主程式：開啟角色、分頁、預覽控制 ---------- */
"use strict";

const Editor = (() => {
  let fsCache = null, customIdx = [], officialIdx = null, player = null;
  const fs = () => fsCache;
  const usedNums = () => Store.usedNumbers(customIdx);

  // 動畫名稱 → 中文（沒列到的照原名顯示）
  const CLIP_LABEL = { idle: "待機", wait: "待機", walk: "走路", attack: "普攻", attack_ready: "普攻・準備", attack_all: "普攻・完整", s_attack: "技能1", s_attack_ready: "技能1・準備",
    s_attack_all: "技能1・完整", s2_attack: "技能2", s2_attack_ready: "技能2・準備", s2_attack_all: "技能2・完整", knockback: "被擊退", target: "瞄準",
    s_action_attack_all: "技能1・完整", s_action_attack_1: "技能1・段1", s_action_attack_2: "技能1・段2", s_action_attack_3: "技能1・段3" };
  const CLIP_ORDER = ["idle", "wait", "walk", "attack_ready", "attack", "attack_all", "s_attack_ready", "s_attack", "s_attack_all", "s_action_attack_1", "s_action_attack_2", "s_action_attack_3", "s_action_attack_all", "s2_attack_ready", "s2_attack", "s2_attack_all", "knockback"];

  /* ---- 資料變了：重算換算 → 更新畫面 ---- */
  function onChange(what) {
    const P = Store.P; if (!P) return;
    fsCache = Fight.stats(P);
    UI.renderResult(); UI.syncAll(); UI.refreshId();
    $("#charName").textContent = P.unit.name;
    $("#charId").textContent = P.unit.id;
    // 手機底部的摘要列
    $("#mini").innerHTML = `<div><span>體力</span><b>${fsCache.hp}</b></div><div><span>減傷</span><b>${Math.round(fsCache.dr * 100)}%</b></div><div><span>走路</span><b>${fsCache.walk}</b></div><div><span>普攻</span><b>${fsCache.atk.dmg}</b></div>`;
    if (what === "all" || what === "meta" || what === "images") loadPreview();
    // 新角色還沒有動畫：技能開關變了，靜止動作的清單也要跟著變
    if (what === "skill" && P.autoAnim && P.meta.parts.body.images.length) { Parts.autoAnimate("body"); loadPreview(); }
  }

  /* ---- 預覽 ---- */
  async function loadPreview() {
    const P = Store.P, body = P.meta && P.meta.parts && P.meta.parts.body;
    await player.setPart(body || null, P.images && P.images.body);
    const box = $("#clips"); box.replaceChildren();
    if (body) {
      const names = Object.keys(body.animations).sort((a, b) => (CLIP_ORDER.indexOf(a) + 1 || 99) - (CLIP_ORDER.indexOf(b) + 1 || 99));
      for (const n of names) box.append(el("button", { class: "clip" + (n === player.anim ? " on" : ""), "data-n": n, onclick: () => { player.setAnim(n); player.playing = true; markClips(); } },
        [CLIP_LABEL[n] || n, el("small", {}, `${body.animations[n].frame_count} 格`)]));
    }
    const th = $("#thumb"); th.replaceChildren();
    if (P.images && P.images.thum140) th.append(el("img", { src: URL.createObjectURL(P.images.thum140), alt: "頭像" }));
    markClips();
  }
  function markClips() {
    $$("#clips .clip").forEach((b) => b.classList.toggle("on", b.dataset.n === player.anim));
    $("#scrub").max = Math.max(0, player.frameCount - 1);
    $("#playBtn").textContent = player.playing ? "暫停" : "播放";
  }
  // 這一格是不是格鬥場的「出手」那一格
  function isHitFrame(anim, f) {
    const s = fsCache; if (!s) return false;
    const moves = [s.atk, ...s.sk.filter(Boolean)];
    return moves.some((m) => m.clip === anim && f === Math.floor(Fight.hitFrac(Store.P.meta.parts.body, anim) * player.frameCount));
  }

  function bindPreview() {
    player = new Player($("#cv"));
    player.marker = isHitFrame;
    player.onFrame = (f) => {
      const sc = $("#scrub"); if (document.activeElement !== sc) sc.value = f;
      $("#frameNo").textContent = player.frameCount ? `${f + 1} / ${player.frameCount} 格・${(player.frameCount / player.rate).toFixed(2)} 秒` : "—";
    };
    $("#playBtn").onclick = () => { player.playing = !player.playing; markClips(); };
    $("#scrub").oninput = (e) => { player.seek(+e.target.value); markClips(); };
    $("#speed").oninput = (e) => { player.speed = +e.target.value; $("#speedOut").textContent = `×${player.speed}`; };
    $("#zoom").oninput = (e) => { player.zoom = +e.target.value; };
    $("#bgSel").onchange = (e) => { player.bg = e.target.value === "checker" ? "checker" : e.target.value; };
  }

  /* ---- 分頁 ---- */
  function bindTabs() {
    $$(".tabs button").forEach((b) => b.addEventListener("click", () => {
      $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
      $$(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + b.dataset.tab));
      try { localStorage.setItem("rk-editor-tab", b.dataset.tab); } catch {}
      if (Store.P && b.dataset.tab === "parts") Parts.render();
      if (Store.P && b.dataset.tab === "export") Export.render();
    }));
    let t = null; try { t = localStorage.getItem("rk-editor-tab"); } catch {}
    ($(`.tabs button[data-tab="${t}"]`) || $(".tabs button")).click();
  }
  function buildTabs() {
    UI.reset();
    UI.buildBasic($("#tab-basic")); UI.buildStats($("#tab-stats")); UI.buildSkills($("#tab-skills"));
    const cur = $(".tabs button[aria-selected=true]");
    if (cur && cur.dataset.tab === "parts") Parts.render();
    if (cur && cur.dataset.tab === "export") Export.render();
  }

  /* ---- 開啟角色（起始畫面） ---- */
  const thumbUrl = (kind, id) => IO.url(`${kind === "custom" ? "custom" : "data"}/res/${id}/${id}-thum-140.png`);
  function card(kind, r) {
    return el("button", { class: "pick", onclick: () => open(kind, r.id) }, [
      el("img", { src: thumbUrl(kind, r.id), alt: "", loading: "lazy", onerror: (e) => (e.target.style.visibility = "hidden") }),
      el("span", { class: "pick-name" }, r.name || r.id), el("span", { class: "pick-id mono" }, r.id)]);
  }
  async function showPicker() { return busy("正在讀取角色清單…", showPicker0); }
  async function showPicker0() {
    const dlg = $("#picker");
    dlg.hidden = false; document.body.classList.add("picking");
    const cl = $("#customList"); cl.replaceChildren(el("p", { class: "help" }, "讀取中…"));
    try { customIdx = await IO.customIndex(); cl.replaceChildren(...customIdx.map((r) => card("custom", r))); }
    catch { cl.replaceChildren(el("p", { class: "bad" }, `讀不到 ${IO.url("custom/units.json")}。請確認網路連線，或網站網址是否有改（js/io.js 的 SITE_URL）。`)); }
    const resume = await Store.restore();
    const rb = $("#resumeBtn");
    rb.hidden = !resume;
    if (resume) { rb.querySelector("span").textContent = `${resume.unit.name}（${resume.unit.id}）`; rb.onclick = () => { Store.set(resume); closePicker(); }; }
    await searchOfficial("");
  }
  async function searchOfficial(q) {
    const ol = $("#officialList");
    if (!officialIdx) { ol.replaceChildren(el("p", { class: "help" }, "讀取官方角色清單…")); try { officialIdx = (await IO.officialIndex()).filter((r) => r.name); } catch { ol.replaceChildren(el("p", { class: "bad" }, "讀不到官方角色清單（data/units.json）。")); return; } }
    q = q.trim().toLowerCase();
    const hits = officialIdx.filter((r) => !q || r.name.toLowerCase().includes(q) || r.id.includes(q));
    ol.replaceChildren(...hits.slice(0, 48).map((r) => card("data", r)), hits.length > 48 ? el("p", { class: "help" }, `還有 ${hits.length - 48} 隻，請輸入更多關鍵字`) : null);
  }
  function closePicker() { $("#picker").hidden = true; document.body.classList.remove("picking"); }

  async function open(kind, id) { return busy(kind === "new" ? "正在建立新角色…" : `正在讀取 ${id}…`, () => open0(kind, id)); }
  async function open0(kind, id) {
    const busy = $("#pickBusy"); busy.hidden = true;
    try {
      let p;
      if (kind === "new") p = Store.newProject();
      else p = Store.fromLoaded(kind, id, await IO.loadCharacter(kind, id));
      if (kind === "custom" && p.num) p.srcNum = p.num;
      else {
        p.num = Store.nextFreeNumber(customIdx);
        if (p.num == null) { busy.hidden = false; busy.textContent = "x003～x100 的編號都用完了，請先刪掉不要的自製角色。"; return; }
        if (kind === "custom") toast(`${id} 是網站保留的編號，會另存成新角色`);
      }
      p.unit.id = Store.makeId(p.num, p.slug); if (p.meta) p.meta.unit_id = p.unit.id;
      Store.set(p); closePicker();
      toast(kind === "data" ? `已讀取官方角色，會另存成新的自製角色 ${p.unit.id}` : kind === "custom" ? `已讀取 ${id}，修改後會覆蓋這隻` : `新角色 ${p.unit.id}`);
    } catch (e) { busy.hidden = false; busy.textContent = `讀取失敗：${e.message}`; return; }
    busy.hidden = true;
  }

  function boot() {
    bindPreview(); bindTabs();
    Store.on((what) => { if (what === "all") buildTabs(); onChange(what); });
    $("#openBtn").onclick = showPicker;
    $("#closePick").onclick = () => { if (Store.P) closePicker(); };
    $("#newBtn").onclick = () => open("new");
    $("#offSearch").oninput = debounce((e) => searchOfficial(e.target.value), 200);
    showPicker();
  }

  return { boot, fs, usedNums, snapshot: () => player.snapshot() };
})();

document.addEventListener("DOMContentLoaded", Editor.boot);
