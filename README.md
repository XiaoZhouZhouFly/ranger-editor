# Ranger 角色編輯器

「Ranger 惡搞工坊」的粉絲角色編輯器，純前端（HTML＋JS），不需要後端。
這是**獨立的 GitHub 專案**，跟網站 repo（ranger-kichiku）分開：這個 repo 的根目錄就是編輯器，開 GitHub Pages 即可使用。

## 資料來源

- 直接讀網站 `https://xiaozhouzhoufly.github.io/ranger-kichiku/` 的 `custom/` 與 `data/`（GitHub Pages 允許跨網站讀取）。網站網址改了，改 `js/io.js` 的 `SITE_URL`。
- 測試時網址可以加 `?base=` 換來源，例如本機開的網站：`index.html?base=http://localhost:8000/`。
- 匯出的 `custom/` 要上傳到**網站的 repo**（ranger-kichiku），不是這個 repo。

## 放到 GitHub

1. 建一個新 repo（例如 `ranger-editor`），把這些檔案放在根目錄（`index.html` 在最上層）。
2. Settings → Pages → Branch 選 `main`、資料夾 `/ (root)`，存檔。
3. 幾分鐘後打開 `https://<帳號>.github.io/<repo 名稱>/`。

編輯中的內容自動存在瀏覽器（IndexedDB），重新打開可以「接續上次」。

## 檔案

| 檔案 | 負責 |
| --- | --- |
| `index.html` | 版面（預覽、分頁、起始畫面） |
| `tutorial.html` | 教學頁：圖片規則、怎麼切部件、中心點、圖層順序，以及圖片工具 |
| `css/editor.css` | 樣式；顏色都是 `:root` 的變數，深色模式自動切換 |
| `js/util.js` | 共用小工具（建立元素、格式化、提示） |
| `js/fx-table.js` | 技能效果決定表，**自動產生**（見下方） |
| `js/fight-calc.js` | 格鬥場換算，照網站原始碼移植 |
| `js/io.js` | 讀網站資料（含 `.json.gz` 解壓縮） |
| `js/state.js` | 專案資料、id 配號、自動暫存 |
| `js/render.js` | 預覽：畫部件、播放動畫 |
| `js/ui-controls.js` | 拉桿、文字框、開關等輸入元件 |
| `js/ui-basic.js` | 基本資料、數值、技能分頁與換算結果 |
| `js/main.js` | 主程式：開啟角色、分頁、預覽控制 |
| `js/atlas.js` | 拼接圖：切開、重新拼（留 2px）、裁掉透明邊 |
| `js/imgtools.js` | 圖片工具視窗：裁切、縮放、去背 |
| `js/parts.js` | 部件分頁：上傳、中心點、組裝基本姿勢、頭像與技能圖標 |
| `js/export.js` | 匯出：合併網站清單、自動檢查、變更說明、zip、片段 |
| `js/zip.js` | 產生 zip（不用外部套件） |
| `js/tutorial.js` | 教學頁的工具 |
| `tools/gen_fx_table.py` | 從網站原始碼產生 `js/fx-table.js` |

## 網站更新時要同步的地方

- **調了格鬥場平衡**（`src/js-18-fight-data.js` 的 `FT`、`BAL`）：把同樣的數字改進 `js/fight-calc.js` 開頭的 `FT`、`BAL`。
- **改了效果決定表**：`python3 tools/gen_fx_table.py <網站 repo 的資料夾>`。
- **新增自製角色的手寫數值**（`FIGHT_PRESET`）：把 id 加進 `js/fight-calc.js` 的 `PRESET_IDS`，編輯器就會標示「網站用手寫值」。

換算已經跟網站 v6.4 對照過：8 隻範例官方角色的體力、減傷、走路、普攻與技能傷害、冷卻全部一致。

## v7.2 規則（編輯器照這些做）

- 編號只用 x003～x100；x001、x002 是網站內建，x101～x199 保留給網站手工角色與擴充包。讀到這些保留編號的角色時，會另存成新角色。
- 召喚物、變形外觀：id 用「本體編號＋sk＋序號」（例 x003sk1-dragon），units.json 加 `"hidden": true`。
- `stats.json` 的 `"fight"`（手寫格鬥場數值）預設不輸出；只有在「數值」分頁打開「手動指定」才寫，而且不寫 `"op"`。
- 匯出只新增或替換自己那一筆，其他角色原樣保留。
