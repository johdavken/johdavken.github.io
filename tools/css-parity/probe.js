"use strict";

/* CSS parity probe - developer tool, not part of the app.
 *
 * The problem it exists for: this project's CSS is guarded by ~8,200
 * source-level assertions that read stylesheet TEXT. They are good at
 * "does this rule say what we wrote", and blind to "does the page still
 * lay out the same". The Gruvbox/Industrial Slate side-rail divergence
 * sat in the repo unnoticed by all of them, because every rule involved
 * said exactly what it was written to say - they just resized the rail
 * for four themes out of fourteen.
 *
 * So: capture what the browser actually computes, before a change and
 * after it, and diff the two. A refactor that is supposed to change
 * nothing visible must produce an empty diff. That is the whole idea.
 *
 * Usage (the capture step runs in the page, via whatever browser tooling
 * is to hand - it is a plain expression, no driver dependency):
 *
 *   node tools/css-parity/probe.js --print        # expression to evaluate
 *   ...evaluate it in the page, save the JSON result...
 *   node tools/css-parity/probe.js --diff before.json after.json
 *
 * Snapshots are transient - take one before a change, one after, diff,
 * discard. They are not committed: they would churn on every CSS edit and
 * a stale baseline is worse than none.
 */

/* ------------------------------------------------------------------ *
 *   What gets measured
 * ------------------------------------------------------------------ */

// Themes are the axis that matters most here: the whole class of bug this
// catches is "theme X lays out differently from theme Y".
const THEMES = [
  "industrial-slate", "industrial-slate-dark", "gruvbox-dark", "gruvbox-light",
  "ayu-light", "ayu-mirage", "ayu-dark", "nord", "newsprint",
  "rose-pine-dawn", "rose-pine", "everforest", "oled-black", "vaporwave",
];

// Geometry only. Colours are theme-specific by design and would make every
// snapshot differ for the wrong reason; this tool answers "did the layout
// move", not "did the palette change".
const GEOMETRY_PROPS = [
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "marginTop", "marginBottom", "rowGap", "columnGap",
  "fontSize", "fontWeight", "letterSpacing", "lineHeight",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderRadius", "minHeight", "minWidth", "display", "position",
  "outlineWidth", "outlineStyle", "outlineOffset", "strokeWidth",
];

// One entry per thing worth watching. `all: true` records every match's box
// rather than just the first - that is what caught the foldaway rows being
// 8px short in four themes.
const SPECIMENS = [
  { name: "rail",            sel: ".workspaceNav" },
  { name: "rail.rows",       sel: ".workspaceNav .workspaceNavButton", all: true },
  { name: "rail.totals",     sel: '.workspaceNavButton[data-workspace-target="productionSummaryBlock"]' },
  { name: "rail.totals.span", sel: '.workspaceNavButton[data-workspace-target="productionSummaryBlock"] > span' },
  { name: "rail.totals.cap", sel: '.workspaceNavButton[data-workspace-target="productionSummaryBlock"] small' },
  { name: "rail.totals.icon", sel: '.workspaceNavButton[data-workspace-target="productionSummaryBlock"] .workspaceTileIcon' },
  { name: "rail.extra",      sel: ".workspaceNavButton.workspaceNavExtra" },
  { name: "rail.extra.cap",  sel: ".workspaceNavButton.workspaceNavExtra small" },
  { name: "rail.brand",      sel: ".workspaceBrand" },
  { name: "rail.footer",     sel: ".workspaceNavFooter" },
  { name: "statusbar",       sel: ".workspaceStatusBar" },
  { name: "content",         sel: ".workspaceContent" },
  { name: "recipe.grid",     sel: "#splitsArea .splitsMatrix" },
  { name: "recipe.cell",     sel: "#splitsArea .splitMatrixCell" },
  { name: "footer",          sel: ".footerBar" },
];

/* ------------------------------------------------------------------ *
 *   The page-side capture
 * ------------------------------------------------------------------ */

/* The payload is deliberately hierarchical. A full capture is ~200KB of rule
 * text, which is impractical to move around; instead the default result is a
 * few kilobytes of counts and checksums, and `detail` re-runs the same
 * measurement for a single theme when a checksum says something moved. Diff
 * the cheap form first, drill into the theme it names. */
function buildProbe(options) {
  const detail = (options && options.detail) || null;
  // Serialised wholesale so the page-side code and the constants above can
  // never drift apart.
  return `(() => {
  const DETAIL = ${JSON.stringify(detail)};
  // FNV-1a: stable across runs and browsers, which is all that is needed to
  // answer "is this byte-identical to last time".
  const sum = (str) => { let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, "0"); };
  const THEMES = ${JSON.stringify(THEMES)};
  const PROPS = ${JSON.stringify(GEOMETRY_PROPS)};
  const SPECIMENS = ${JSON.stringify(SPECIMENS)};

  const round = (n) => Math.round(n * 100) / 100;
  const box = (el) => { const r = el.getBoundingClientRect();
    return [round(r.width), round(r.height)].join("x"); };
  const styleOf = (el) => { const cs = getComputedStyle(el); const out = {};
    for (const p of PROPS) if (cs[p] !== undefined && cs[p] !== "") out[p] = cs[p];
    return out; };

  // Every CSS rule, with its at-rule condition. A refactor that moves rules
  // between files or merges @media blocks must not lose or duplicate any of
  // them, and this is what proves it. NOTE: a CSSStyleRule also exposes an
  // (empty) .cssRules under CSS Nesting, so recursion must test .length -
  // testing truthiness alone silently skips every style rule.
  const rules = [];
  const walk = (list, cond) => { for (const r of list) {
    if (typeof r.selectorText === "string") rules.push((cond || "-") + " :: " + r.selectorText.replace(/\\s+/g, " "));
    if (r.cssRules && r.cssRules.length) walk(r.cssRules, (cond ? cond + " && " : "") + (r.conditionText || r.name || ""));
  } };
  let sheets = 0;
  for (const sheet of document.styleSheets) {
    let list; try { list = sheet.cssRules; } catch (e) { continue; }
    sheets++; walk(list, "");
  }
  rules.sort();

  // Outline declarations, kept separate because the focus ring is a
  // cross-cutting concern that no single specimen would notice.
  const outlines = [];
  const walkOutline = (list, cond) => { for (const r of list) {
    if (typeof r.selectorText === "string" && r.cssText && /(?<![\\w-])outline\\s*:/.test(r.cssText)) {
      const v = r.cssText.match(/(?<![\\w-])outline\\s*:\\s*([^;}]+)/);
      const o = r.cssText.match(/outline-offset\\s*:\\s*([^;}]+)/);
      outlines.push([cond || "-", r.selectorText.replace(/\\s+/g, " "), v[1].trim(), o ? o[1].trim() : "-"].join(" :: "));
    }
    if (r.cssRules && r.cssRules.length) walkOutline(r.cssRules, (cond ? cond + " && " : "") + (r.conditionText || r.name || ""));
  } };
  for (const sheet of document.styleSheets) {
    let list; try { list = sheet.cssRules; } catch (e) { continue; }
    walkOutline(list, "");
  }
  outlines.sort();

  const htmlTheme = document.documentElement.getAttribute("data-theme");
  const bodyTheme = document.body.getAttribute("data-theme");
  const themes = {};
  for (const theme of THEMES) {
    document.documentElement.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
    const snap = {};
    for (const spec of SPECIMENS) {
      if (spec.all) {
        const els = [...document.querySelectorAll(spec.sel)];
        snap[spec.name] = els.length ? els.map(box) : null;
      } else {
        const el = document.querySelector(spec.sel);
        snap[spec.name] = el ? { box: box(el), style: styleOf(el) } : null;
      }
    }
    themes[theme] = snap;
  }
  // Leave the page as it was found.
  if (htmlTheme) document.documentElement.setAttribute("data-theme", htmlTheme);
  if (bodyTheme) document.body.setAttribute("data-theme", bodyTheme);

  // Offsets are called out separately: they are the one outline property a
  // refactor is most likely to disturb by accident, and a histogram is small.
  const offsets = {};
  for (const o of outlines) { const k = o.split(" :: ").pop(); offsets[k] = (offsets[k] || 0) + 1; }

  const themeSums = {};
  for (const [t, snap] of Object.entries(themes)) themeSums[t] = sum(JSON.stringify(snap));

  const out = {
    viewport: window.innerWidth + "x" + window.innerHeight,
    sheets,
    ruleCount: rules.length,
    rulesSum: sum(rules.join("\n")),
    outlineCount: outlines.length,
    outlinesSum: sum(outlines.join("\n")),
    offsets,
    themeSums,
  };
  // Drill-down: the full measurement for one theme, plus the rule list, only
  // when explicitly asked for.
  if (DETAIL === "rules") out.rules = rules;
  else if (DETAIL === "outlines") out.outlines = outlines;
  else if (DETAIL && themes[DETAIL]) out.detail = { theme: DETAIL, snapshot: themes[DETAIL] };
  return out;
})()`;
}

/* ------------------------------------------------------------------ *
 *   The Node-side diff
 * ------------------------------------------------------------------ */

function diff(before, after) {
  const findings = [];
  const note = (what, a, b) => findings.push({ what, before: a, after: b });

  if (before.viewport !== after.viewport) {
    note("viewport (snapshots are not comparable)", before.viewport, after.viewport);
    return findings;
  }
  for (const key of ["sheets", "ruleCount", "outlineCount"]) {
    if (before[key] !== after[key]) note(key, before[key], after[key]);
  }
  if (before.rulesSum !== after.rulesSum) {
    note("the set of CSS rules changed (re-capture with --print-detail rules to see which)", before.rulesSum, after.rulesSum);
  }
  if (before.outlinesSum !== after.outlinesSum) {
    note("outline declarations changed (re-capture with --print-detail outlines)", before.outlinesSum, after.outlinesSum);
  }
  for (const k of new Set([...Object.keys(before.offsets || {}), ...Object.keys(after.offsets || {})])) {
    const a = (before.offsets || {})[k] || 0;
    const b = (after.offsets || {})[k] || 0;
    if (a !== b) note(`outline-offset ${k} count`, a, b);
  }
  for (const theme of Object.keys(before.themeSums || {})) {
    const a = before.themeSums[theme];
    const b = (after.themeSums || {})[theme];
    if (b === undefined) note(`theme ${theme} missing after`, a, "(absent)");
    else if (a !== b) note(`theme ${theme} layout changed (re-capture with --print-detail ${theme})`, a, b);
  }
  // Both snapshots carry a drill-down for the same theme: name the property.
  if (before.detail && after.detail && before.detail.theme === after.detail.theme) {
    const t = before.detail.theme;
    for (const name of Object.keys(before.detail.snapshot)) {
      const x = before.detail.snapshot[name];
      const y = after.detail.snapshot[name];
      if (JSON.stringify(x) === JSON.stringify(y)) continue;
      if (x === null || y === null) { note(`${t} / ${name} present/absent`, x === null ? "absent" : "present", y === null ? "absent" : "present"); continue; }
      if (Array.isArray(x)) { note(`${t} / ${name} boxes`, x.join(","), (y || []).join(",")); continue; }
      if (x.box !== y.box) note(`${t} / ${name} box`, x.box, y.box);
      for (const prop of Object.keys(x.style)) {
        if (x.style[prop] !== y.style[prop]) note(`${t} / ${name} ${prop}`, x.style[prop], y.style[prop]);
      }
    }
  }
  return findings;
}

/* Themes must lay out identically to one another, not merely be unchanged
 * from before - that is the invariant the side-rail bug violated. */
function themeParity(snapshot) {
  const groups = new Map();
  for (const [theme, sum] of Object.entries(snapshot.themeSums || {})) {
    if (!groups.has(sum)) groups.set(sum, []);
    groups.get(sum).push(theme);
  }
  return [...groups.values()];
}

if (require.main === module) {
  const [flag, a, b] = process.argv.slice(2);
  if (flag === "--print") {
    process.stdout.write(buildProbe() + "\n");
  } else if (flag === "--print-detail" && a) {
    process.stdout.write(buildProbe({ detail: a }) + "\n");
  } else if (flag === "--diff" && a && b) {
    const fs = require("node:fs");
    const before = JSON.parse(fs.readFileSync(a, "utf8"));
    const after = JSON.parse(fs.readFileSync(b, "utf8"));
    const findings = diff(before, after);
    if (!findings.length) {
      console.log(`No difference. ${before.ruleCount} rules, ${Object.keys(before.themeSums).length} themes, viewport ${before.viewport}.`);
    } else {
      console.log(`${findings.length} difference(s):\n`);
      for (const f of findings) console.log(`  ${f.what}\n      before: ${f.before}\n      after:  ${f.after}`);
      process.exitCode = 1;
    }
  } else if (flag === "--parity" && a) {
    const fs = require("node:fs");
    const snap = JSON.parse(fs.readFileSync(a, "utf8"));
    const groups = themeParity(snap);
    console.log(`${groups.length} distinct layout signature(s) across ${Object.keys(snap.themeSums).length} themes:`);
    for (const g of groups) console.log("  " + g.join(", "));
    if (groups.length > 1) process.exitCode = 1;
  } else {
    console.log("usage: probe.js --print | --print-detail <theme|rules|outlines> | --diff before.json after.json | --parity snapshot.json");
    process.exitCode = 2;
  }
}

module.exports = { THEMES, GEOMETRY_PROPS, SPECIMENS, buildProbe, diff, themeParity };
