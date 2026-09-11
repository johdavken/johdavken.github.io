"use strict";

/* A CSS state rule cannot reveal an element that still carries [hidden].
 *
 * styles.css states the display rule for the hidden attribute once, globally:
 *
 *     [hidden]{display:none!important}
 *
 * That !important outranks any ordinary display, which is the point - one rule
 * instead of the ~20 per-selector copies that kept reappearing. The cost is a
 * trap: if the app reveals something by toggling a class on an ancestor while
 * the element itself still has the attribute, the reveal silently no-ops.
 *
 * That is not hypothetical. It shipped. The status bar's Changeover and Output
 * readouts turned into inputs via .statusEditableItem.editing .statusEditInput
 * {display:block}, the inputs kept their hidden attribute, and for two weeks
 * clicking either one blanked the field instead of editing it - with the time
 * picker opening against a 0x0 box at the viewport origin. No test noticed,
 * because every rule involved said exactly what it was written to say.
 *
 * So this enumerates the shape rather than the instance: a rule with an
 * ancestor state part, setting a non-none display, without !important, whose
 * target is something that ships with the hidden attribute. Each one is either
 * safe because JS clears the attribute, or it is the next version of that bug.
 * The list below is what was audited; a new entry has to be checked, not
 * appended blindly.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles } = require("./css-source");

const html = fs.readFileSync("index.html", "utf8");
const css = readStyles() + "\n" + fs.readFileSync("desktop.css", "utf8") +
            "\n" + fs.readFileSync("button-styling.css", "utf8");

/* Audited 2026-09-10, every one confirmed safe in the live cascade at 1600
 * desktop and 390 touch, at rest and with the Recipe panel open in edit and
 * bulk-edit. "Safe" means: no element matching the selector carries the
 * attribute when the rule is meant to apply. */
const AUDITED = new Map([
  [".statusEditableItem.editing .statusEditInput",
   "REAL - and this is the bug that prompted the audit. Fixed: app.js clears hidden before focus and restores it on blur."],
  ["body.native-pump-off-alarm .pumpOffAlarmSoundRow",
   "REAL, native only. Safe: app.js sets soundRow.hidden = !nativeAvailable in the same function that toggles the body class, so attribute and class move together."],
  [".splitsBulkModeBar button.secondary",
   "class collision on .secondary. The bar takes the attribute (modeBar.hidden = bulkMode || rearranging); its buttons never do."],
  [".workspaceStatusBar .workspaceStatusItem.statusChangeoverCountdown",
   "class collision on .workspaceStatusItem, which #workspaceProductionEstimateStatus carries while hidden. The countdown item itself never is."],
  [".appDockControl > span:not(.mobileNotificationsBadge)",
   "collision on a bare span. The spans this matches never carry the attribute."],
  ["#splitsArea > #splitsBulkBar :is(.recipeHistoryAction, .splitsEditRowSecondary .bulkTextAction, .splitsEditRowSecondary .splitsRearrangeAction, .splitsEditRowSecondary #resetAllSplits.danger)",
   "class collision on .danger. #resetAllSplits is built in JS and is not in index.html at all, so it ships no attribute."],
]);

/** Ids and classes that appear on an element shipping the hidden attribute. */
function shipsHidden(){
  const ids = new Set(), classes = new Set();
  // `hidden` as its own attribute. \bhidden\b also matches inside
  // aria-hidden="true" - "-" is a word boundary - which silently swept in
  // hundreds of elements that do not carry the attribute at all.
  const HIDDEN_ATTR = /(?:^|\s)hidden(?=[\s>=]|$)/;
  for (const m of html.matchAll(/<([a-z][a-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi)){
    if (!HIDDEN_ATTR.test(m[2].replace(/(?:aria|data)-hidden\s*=\s*"[^"]*"/gi, ""))) continue;
    const id = (/\bid="([^"]+)"/.exec(m[2]) || [])[1];
    if (id) ids.add(id);
    for (const c of ((/\bclass="([^"]+)"/.exec(m[2]) || [])[1] || "").split(/\s+/).filter(Boolean)) classes.add(c);
  }
  return { ids, classes };
}

/* Split a selector list on top-level commas only.
 *
 * A plain .split(",") tears :is(.a, .b) in half and hands back fragments with
 * a dangling ")" - which is how an earlier pass of this audit produced a
 * selector that does not exist. Same naive-parsing mistake as slicing CSS by
 * offset; worth not repeating inside the test that exists to catch a subtler
 * version of it. */
function splitSelectorList(text){
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0){ parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Rules that try to reveal, from ancestor state, something that ships hidden. */
function stateDrivenReveals(){
  const { ids, classes } = shipsHidden();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Set();
  for (const rule of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
    const display = /(?:^|[;\s])display\s*:\s*([^;!]+)(!important)?/.exec(rule[2]);
    if (!display) continue;
    if (display[1].trim() === "none") continue;
    if (display[2]) continue;                       // !important can outrank [hidden]
    for (const one of splitSelectorList(rule[1])){
      const sel = one.trim().replace(/\s+/g, " ");
      if (!/[\s>+~]/.test(sel)) continue;           // needs an ancestor to carry the state
      const target = sel.split(/\s*[>+~]\s*|\s+/).pop().replace(/::[a-z-]+.*$/, "");
      const id = (/#([A-Za-z0-9_-]+)/.exec(target) || [])[1];
      const hitsHidden = (id && ids.has(id)) ||
        [...target.matchAll(/\.([A-Za-z0-9_-]+)/g)].some(c => classes.has(c[1]));
      if (!hitsHidden) continue;
      const ancestor = sel.slice(0, sel.length - target.length);
      if (!/[.[]/.test(ancestor)) continue;         // a plain container is not state
      found.add(sel);
    }
  }
  return found;
}

test("the global [hidden] rule is what makes this test necessary", () => {
  // Comments must come out first. The stylesheet mentions this exact rule
  // twice in prose - once explaining why it exists, once explaining a
  // deliberate exception - so matching the raw text would pass even if the
  // rule itself were deleted. The assertion has to see the cascade, not the
  // commentary about it.
  const rules = readStyles().replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(rules, /\[hidden\]\{display:none!important\}/,
    "without the !important there is no trap and this whole file can go");
  assert.equal((rules.match(/^\[hidden\]\{display:none!important\}/gm) || []).length, 1,
    "stated once, globally - a second copy is the duplication this replaced");
});

test("no unaudited CSS state rule tries to reveal something that ships hidden", () => {
  const found = stateDrivenReveals();
  const unaudited = [...found].filter(sel => !AUDITED.has(sel));
  assert.deepEqual(unaudited, [],
    "These rules reveal by toggling a class or attribute on an ancestor, but their " +
    "target ships with the hidden attribute, and [hidden]{display:none!important} " +
    "outranks them. Check each in the browser: if the app clears hidden when the " +
    "state turns on, it is safe - add it to AUDITED with the reason. If it only " +
    "toggles the class, the reveal does nothing and that is the bug this file " +
    "exists for.");
});

test("the audited list has not gone stale - every entry is still a real rule", () => {
  // A selector that no longer exists should be dropped, not left implying
  // coverage the stylesheet no longer needs.
  const found = stateDrivenReveals();
  const gone = [...AUDITED.keys()].filter(sel => !found.has(sel));
  assert.deepEqual(gone, [],
    "these audited selectors are gone from the stylesheets - remove them from AUDITED");
});

test("every audited entry records why it is safe", () => {
  for (const [sel, why] of AUDITED){
    assert.ok(why && why.length > 12, `${sel} needs a reason, not a placeholder`);
  }
});
