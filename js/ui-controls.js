/* ---------- 共用的輸入元件 ----------
   sliderRow：拉桿＋數字框＋說明＋即時提示，大部分數值都用它。
   log：數值範圍很大（體力、攻擊）時用對數刻度，拉桿每一段代表「乘幾倍」而不是「加多少」。 */
"use strict";

let __ctlId = 0;
function sliderRow(o) {
  const id = o.id || "ctl" + ++__ctlId;
  const N = 1000;
  // 拉桿位置 ↔ 數值
  const toPos = (v) => {
    if (!o.log) return v;
    if (v <= 0) return 0;
    return clamp(Math.round(Math.log(v / o.min) / Math.log(o.max / o.min) * N), o.allowZero ? 1 : 0, N);
  };
  const fromPos = (p) => {
    if (!o.log) return +p;
    if (o.allowZero && p <= 0) return 0;
    const v = o.min * Math.pow(o.max / o.min, p / N);
    const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));  // 只留兩位有效數字，數字比較好讀
    return Math.round(v / mag) * mag;
  };
  const range = el("input", { type: "range", id, min: o.log ? 0 : o.min, max: o.log ? N : o.max, step: o.log ? 1 : o.step || 1, "aria-label": o.label });
  const num = el("input", { type: "number", id: id + "-n", min: o.allowZero ? 0 : o.min, step: o.step || "any", class: "num", "aria-label": o.label + "（數字）" });
  const hint = el("div", { class: "hint" });
  const ticks = o.ref != null ? el("div", { class: "ref-tick", title: "官方中位數", style: `left:${(toPos(o.ref) - (o.log ? 0 : o.min)) / ((o.log ? N : o.max) - (o.log ? 0 : o.min)) * 100}%` }) : null;
  const row = el("div", { class: "srow" }, [
    el("div", { class: "srow-head" }, [el("label", { for: id }, o.label), o.unit ? el("span", { class: "unit" }, o.unit) : null, num]),
    el("div", { class: "track" }, [range, ticks]),
    o.help ? el("p", { class: "help" }, o.help) : null, hint,
  ]);
  const sync = () => {
    const v = o.get();
    range.value = toPos(v ?? 0);
    if (document.activeElement !== num) num.value = v == null ? "" : +(+v).toFixed(o.digits ?? 2);
    hint.innerHTML = o.hint ? o.hint(v) || "" : "";
    row.classList.toggle("off", !!(o.disabled && o.disabled()));
  };
  range.addEventListener("input", () => { o.set(fromPos(+range.value)); sync(); });
  num.addEventListener("change", () => { const v = +num.value; if (Number.isFinite(v)) { o.set(o.allowZero ? Math.max(0, v) : Math.max(o.min, v)); } sync(); });
  row.sync = sync; sync();
  return row;
}

function selectRow(label, options, get, set, id) {
  const s = el("select", { id: id || "sel" + ++__ctlId }, options.map((x) => el("option", { value: x }, x)));
  s.value = get(); s.addEventListener("change", () => set(s.value));
  const row = el("div", { class: "frow" }, [el("label", { for: s.id }, label), s]);
  row.sync = () => { s.value = get(); };
  return row;
}

function textRow(label, get, set, o = {}) {
  const id = o.id || "txt" + ++__ctlId;
  const inp = o.multi ? el("textarea", { id, rows: 3 }) : el("input", { id, type: "text", placeholder: o.placeholder || "", maxlength: o.max || null });
  inp.value = get() || "";
  inp.addEventListener("input", () => set(inp.value));
  const row = el("div", { class: "frow" + (o.multi ? " wide" : "") }, [el("label", { for: id }, label), inp, o.help ? el("p", { class: "help" }, o.help) : null]);
  row.sync = () => { if (document.activeElement !== inp) inp.value = get() || ""; };
  return row;
}

/* 開關（例：技能 2 有沒有） */
function toggleRow(label, get, set, id) {
  const cb = el("input", { type: "checkbox", id: id || "tg" + ++__ctlId, role: "switch" });
  cb.checked = !!get(); cb.addEventListener("change", () => set(cb.checked));
  const row = el("label", { class: "toggle", for: cb.id }, [cb, el("span", { class: "knob" }), el("span", {}, label)]);
  row.sync = () => { cb.checked = !!get(); };
  return row;
}
