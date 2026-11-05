/* ---------- 共用小工具 ----------
   所有檔案都會用到的函式：選取元素、建立元素、數字限制與格式化、提示訊息。 */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const deepCopy = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

/* 建立元素：el("div", { class: "x", onclick: fn }, [子元素或文字…]) */
function el(tag, attrs, kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(kids || [])) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

/* 數字顯示：大數字加千分位，小數保留 digits 位（去掉多餘的 0） */
function fmt(v, digits = 0) {
  if (v == null || !Number.isFinite(+v)) return "—";
  const n = +(+v).toFixed(digits);
  return n.toLocaleString("zh-TW", { maximumFractionDigits: digits });
}
const pct = (x) => `${x >= 1 ? "+" : ""}${Math.round((x - 1) * 100)}%`;

/* 右下角的短暫提示 */
function toast(msg, kind) {
  const box = $("#toasts");
  const t = el("div", { class: "toast " + (kind || ""), role: "status" }, msg);
  box.append(t);
  setTimeout(() => t.classList.add("out"), 2600);
  setTimeout(() => t.remove(), 3100);
}

/* 連續觸發時只執行最後一次（例：拉桿拖動時的自動暫存） */
function debounce(fn, ms) {
  let h = 0;
  return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
}

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`; };

/* 選檔按鈕：外觀是按鈕，裡面就是真正的檔案選擇框（不用程式去「按」它，手機瀏覽器才不會擋）
   fileButton("上傳", { class: "btn", accept: "image/*", multiple: true }, (files) => …) */
function fileButton(label, o, onFiles) {
  const inp = el("input", { type: "file", class: "vh", accept: o.accept || "image/*", multiple: o.multiple || null });
  inp.addEventListener("change", () => { const fs = [...inp.files]; inp.value = ""; if (fs.length) onFiles(fs); });
  return el("label", { class: (o.class || "btn") + " filebtn" }, [inp, label]);
}

/* 讀取中：全螢幕灰色遮罩＋轉圈，擋住其他操作。可以巢狀呼叫（全部結束才收起來）
   await busy("讀取中…", async () => { … }) */
let __busyN = 0;
async function busy(msg, fn) {
  let ov = document.getElementById("busyOv");
  if (!ov) {
    ov = el("div", { id: "busyOv", class: "busy-ov", hidden: true, role: "alert", "aria-live": "assertive" }, [el("div", { class: "spinner", "aria-hidden": "true" }), el("p", { id: "busyMsg" })]);
    document.body.append(ov);
  }
  __busyN++; document.getElementById("busyMsg").textContent = msg || "處理中…"; ov.hidden = false;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));   // 先讓遮罩畫出來
  try { return await fn(); }
  finally { if (--__busyN <= 0) { __busyN = 0; ov.hidden = true; } }
}
