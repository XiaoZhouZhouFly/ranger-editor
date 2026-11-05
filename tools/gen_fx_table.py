# 從網站原始碼產生 editor/js/fx-table.js（網站改了效果決定表後重跑一次）
# 用法：python3 tools/gen_fx_table.py <網站 repo（ranger-kichiku）的資料夾>
import json, re, sys, os
if len(sys.argv) < 2: sys.exit("請指定網站 repo 的資料夾，例如：python3 tools/gen_fx_table.py ../ranger-kichiku")
site = sys.argv[1]
src = lambda n: open(os.path.join(site, "src", n), encoding="utf-8").read()
dfx, eff = src("js-18-fight-data-fx.js"), src("js-18-fight-effects.js")
table = json.loads("{" + re.search(r"const FX_TABLE = \{(.*?)\n  \};", dfx, re.S).group(1).rstrip().rstrip(",") + "}")
maxlv = json.loads(re.search(r"const FX_MAXLEVEL = (\{.*?\});", dfx).group(1))
# 有實作的處理方式（FX_BEHAVIOR 與後續 Object.assign 的 key）與其 form／knockdown
beh = {}
for m in re.finditer(r"^    (\w+): *(.*)$", eff[eff.index("const FX_BEHAVIOR"):eff.index("const FX_CONTROL")], re.M):
    k, rest = m.group(1), m.group(2)
    beh[k] = {"form": "dash" if 'form: "dash"' in rest else None, "knockdown": "knockdown: true" in rest}
control = re.search(r"const FX_CONTROL = new Set\((\[.*?\])\)", eff).group(1)
out = f"""/* 技能效果決定表（自動產生，不要手改）
   來源：網站 src/js-18-fight-data-fx.js（FX_TABLE、FX_MAXLEVEL）、src/js-18-fight-effects.js（有實作的處理方式）
   重新產生：python3 editor/tools/gen_fx_table.py <網站資料夾> */
const FX_TABLE = {json.dumps(table, ensure_ascii=False, indent=0)};
const FX_MAXLEVEL = {json.dumps(maxlv)};
const FX_BEHAVIOR_KEYS = {json.dumps(beh)};
const FX_CONTROL = new Set({control});
"""
open(os.path.join(os.path.dirname(__file__), "..", "js", "fx-table.js"), "w", encoding="utf-8").write(out)
print(len(table), "effects;", len(beh), "behaviors")
