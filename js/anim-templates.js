/* ---------- 自動動作範本：照部件名稱認出「頭、上身、近側手…」，做出一組基本動作當起點 ----------
   用簡單的骨架帶動（FK）：上身動 → 頭、手、披風跟著動；近側手動 → 武器跟著動（武器只轉不縮放）。
   範本的出手格都放在一半左右；技能舉手時，近側手畫到頭後面（不擋臉）。 */
"use strict";

const AnimTemplates = (() => {
  // 部件名稱 → 角色（role）
  const ROLES = [["cape", /披風|燕尾|斗篷|cape/i], ["face", /五官|臉|眼|face|eye/i], ["head", /頭|head|hair|髮/i], ["weapon", /武器|劍|刀|槍|杖|weapon|sword/i],
    ["armB", /遠側手|後手|armB|arm_b|backarm/i], ["armF", /近側手|前手|armF|arm_f|frontarm|手|arm|hand/i],
    ["legB", /遠側腳|後腳|legB|leg_b/i], ["legF", /近側腳|前腳|legF|leg_f|腳|leg|foot/i], ["torso", /上身|身體|身|衣|torso|body|chest/i]];
  const PARENT = { head: "torso", face: "head", armF: "torso", armB: "torso", cape: "torso", weapon: "armF" };
  const roleOf = (label) => (ROLES.find(([, re]) => re.test(label)) || [null])[0];

  // 每段動畫：格數、出手（準備段長度）、關鍵影格 [格, { 角色: { dr 旋轉, dx, dy, back 畫到頭後面 } }]（root＝整隻，繞腳底轉）
  const T = {
    idle: { n: 40, keys: [[0, {}], [20, { torso: { dy: 2 }, head: { dr: -2 }, armF: { dr: 5 }, armB: { dr: -5 }, cape: { dr: 4 } }], [39, {}]] },
    walk: { n: 24, keys: [[0, { legF: { dr: 24 }, legB: { dr: -24 }, armF: { dr: -18 }, armB: { dr: 18 } }], [6, { torso: { dy: -2 } }],
      [12, { legF: { dr: -24 }, legB: { dr: 24 }, armF: { dr: 18 }, armB: { dr: -18 } }], [18, { torso: { dy: -2 } }], [23, { legF: { dr: 22 }, legB: { dr: -22 }, armF: { dr: -16 }, armB: { dr: 16 } }]] },
    attack: { n: 16, keys: [[0, {}], [5, { armF: { dr: -75 }, torso: { dr: -4, dx: -2 } }], [8, { armF: { dr: 65 }, torso: { dr: 6, dx: 5 } }], [12, { armF: { dr: 40 }, torso: { dr: 3, dx: 3 } }], [15, {}]] },
    s_attack: { n: 24, ready: 8, keys: [[0, {}], [8, { armF: { dr: -165, back: 1 }, armB: { dr: -150 }, torso: { dy: -4 }, head: { dr: -6 } }],
      [12, { armF: { dr: 50 }, torso: { dr: 8, dx: 6, dy: 2 } }], [18, { armF: { dr: 25 }, torso: { dr: 3, dx: 3 } }], [23, {}]] },
    s2_attack: { n: 30, ready: 11, keys: [[0, {}], [6, { root: { dy: 4 }, legF: { dr: -10 }, legB: { dr: 10 } }], [12, { root: { dy: -36 }, armF: { dr: -150, back: 1 } }],
      [16, { root: { dy: 0 }, armF: { dr: 80 }, torso: { dr: 10 } }], [24, { armF: { dr: 30 } }], [29, {}]] },
    knockback: { n: 24, keys: [[0, {}], [4, { root: { dx: -12, dr: -14 }, head: { dr: -10 } }], [12, { root: { dx: -16, dr: -18 }, head: { dr: -6 } }], [23, {}]] },
  };

  /* 用基本姿勢（每個圖層第 0 格）＋範本，產生一段動畫的關鍵影格 */
  function apply(clip, name, imgs) {
    const t = T[name]; if (!t) return false;
    const base = clip.tracks.map((tr) => Object.assign({}, AnimModel.stateAt(tr, 0) || tr.keys[0]));
    const role = clip.tracks.map((tr, i) => roleOf(Parts.partLabel((imgs[base[i].img] || {}).name || "")));
    const idx = (r) => role.indexOf(r);
    const headZ = idx("head") >= 0 ? base[idx("head")].z : null;
    clip.n = t.n; clip.ready = t.ready ?? null;
    clip.tracks.forEach((tr) => (tr.keys = []));
    for (const [f, d] of t.keys) {
      const world = new Array(base.length);
      const solve = (i) => {        // 骨架：算出第 i 個圖層這一格的位置與角度
        if (world[i]) return world[i];
        const b = base[i], own = d[role[i]] || {}, pr = PARENT[role[i]], pi = pr ? idx(pr) : -1;
        let x = b.x + (own.dx || 0), y = b.y + (own.dy || 0), r = b.r + (own.dr || 0);
        if (pi >= 0 && pi !== i) {
          const P = solve(pi), pb = base[pi], dr = (P.r - pb.r) * Math.PI / 180, vx = b.x - pb.x, vy = b.y - pb.y;
          x = P.x + vx * Math.cos(dr) - vy * Math.sin(dr) + (own.dx || 0); y = P.y + vx * Math.sin(dr) + vy * Math.cos(dr) + (own.dy || 0); r = b.r + (P.r - pb.r) + (own.dr || 0);
        }
        return (world[i] = { x, y, r });
      };
      const root = d.root || {}, rr = (root.dr || 0) * Math.PI / 180;
      clip.tracks.forEach((tr, i) => {
        const w = solve(i), own = d[role[i]] || {};
        const x = w.x * Math.cos(rr) - w.y * Math.sin(rr) + (root.dx || 0), y = w.x * Math.sin(rr) + w.y * Math.cos(rr) + (root.dy || 0);
        // 舉手過頭：這一格畫到頭後面（武器跟著手）
        const back = (own.back || (role[i] === "weapon" && (d.armF || {}).back)) && headZ != null;
        tr.keys.push(Object.assign({}, base[i], { f, x: +x.toFixed(2), y: +y.toFixed(2), r: +(w.r + (root.dr || 0)).toFixed(2), z: back ? headZ - 0.5 + (role[i] === "weapon" ? -0.1 : 0) : base[i].z, e: "e" }));
      });
    }
    return true;
  }

  // 認不出角色的部件（範本不會動它們）
  function unknownParts(clip, imgs) {
    return clip.tracks.map((tr) => Parts.partLabel((imgs[(tr.keys[0] || {}).img] || {}).name || "")).filter((n) => !roleOf(n));
  }

  return { T, apply, roleOf, unknownParts, PARENT };
})();
