"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const index = fs.readFileSync("index.html", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

/* ============================================================
 *   State model: job-specific, not recipe-definition
 * ============================================================ */

test("resinLots and nextRecipeLots start empty and are never read by the recipe-definition payload functions", () => {
  assert.match(app, /resinLots: \{\},/);
  assert.match(app, /nextRecipeLots: \{\}/);
  // The functions that build/consume a reusable recipe payload - Saved
  // Recipes, Next Recipe's own storage - must never reference either field,
  // or a lot could leak into a payload meant to be destination-neutral.
  const payloads = fs.readFileSync("workspace-configuration-payloads.js", "utf8");
  assert.doesNotMatch(payloads, /resinLots|nextRecipeLots|lot_number/);
  const nextRecipe = fs.readFileSync("next-recipe.js", "utf8");
  assert.doesNotMatch(nextRecipe, /resinLots|nextRecipeLots|lot_number/);
});

test("rekeyLotMap normalizes through keyName - the exact function Production Summary buckets its totals by", () => {
  const body = functionBody("rekeyLotMap");
  assert.match(body, /const key = keyName\(code\);/);
  // Defensive: non-object, non-string values, and blank strings are all
  // dropped rather than stored or thrown on.
  assert.match(body, /if \(!raw \|\| typeof raw !== "object" \|\| Array\.isArray\(raw\)\) return out;/);
  assert.match(body, /if \(key && typeof value === "string" && value\.trim\(\)\) out\[key\] = value\.trim\(\);/);
});

/* ============================================================
 *   Applying a recipe: destination-aware, full replace
 * ============================================================ */

test("applyRecipeToActivePage sets the lot map for whichever page the recipe just landed on", () => {
  const body = functionBody("applyRecipeToActivePage");
  const currentBranch = body.slice(0, body.indexOf("const stored="));
  assert.match(currentBranch, /state\.resinLots=rekeyLotMap\(lotByResin\);/);
  const nextBranch = body.slice(body.indexOf("const stored="));
  assert.match(nextBranch, /state\.nextRecipeLots=rekeyLotMap\(lotByResin\);/);
  // Never both on the same apply - only the page actually receiving the
  // recipe gets a lot map update.
  assert.doesNotMatch(currentBranch, /nextRecipeLots/);
  assert.doesNotMatch(nextBranch, /(?<!next)[^.]state\.resinLots\s*=/);
});

test("a Saved Recipe carries no lot data, so loading one clears any previously scanned lots on that page", () => {
  // applyWorkspaceConfiguration calls applyRecipeToActivePage with no
  // lotByResin at all - rekeyLotMap(undefined) is {}, a full clear, matching
  // how the recipe itself is also fully replaced by the load.
  const start = app.indexOf("function applyWorkspaceConfiguration(item){");
  const end = app.indexOf('workspaceConfigurationStatus("Receiver Weight Profile loaded successfully.");', start);
  const saved = app.slice(start, end);
  assert.doesNotMatch(saved, /lotByResin/, "Saved Recipes must never pass lot data through");
});

test("Scan Recipe threads lotByResin from the scan straight through, for either page", () => {
  const body = functionBody("applyScannedRecipePayload");
  assert.match(body, /function applyScannedRecipePayload\(payload, lotByResin\)\{/);
  assert.match(body, /applyRecipeToActivePage\(payload, \{ kind:"apply-recipe-scan", lotByResin \}\)/);
});

/* ============================================================
 *   Load Next Recipe: lots travel with the promoted plan
 * ============================================================ */

test("promoting Next carries its scanned lots into Current, replacing Current's own", () => {
  const body = functionBody("loadNextRecipeIntoCurrent");
  assert.match(body, /state\.resinLots = \{ \.\.\.\(state\.nextRecipeLots \|\| \{\}\) \};/);
  // Next's own copy is untouched by promotion, same as state.nextRecipe
  // itself - the plan (and what it carries) survives being loaded.
  assert.doesNotMatch(body, /state\.nextRecipeLots\s*=(?!=)/);
});

/* ============================================================
 *   Reset points: cleared only where the recipe itself is wiped
 * ============================================================ */

test("Bulk Edit's Reset all clears the active page's own lot map, never the other page's", () => {
  const start = app.indexOf('toolbar.querySelector("#resetAllSplits").addEventListener("click"');
  const end = app.indexOf("applyButton.addEventListener", start);
  const body = app.slice(start, end);
  assert.match(body, /if \(isNextRecipePage\(\)\) state\.nextRecipeLots = \{\}; else state\.resinLots = \{\};/);
});

test("the whole-app Reset all clears Current's lots, leaving Next's untouched - same scope as everything else it resets", () => {
  const body = functionBody("resetAll");
  assert.match(body, /state\.resinLots = \{\};/);
  assert.doesNotMatch(body, /nextRecipeLots/, "resetAll never touches Next, so it must not touch Next's lots either");
});

test("RT Sync no longer exposes a New Job action", () => {
  assert.doesNotMatch(app, /function newJobPayload\(\)/);
  assert.doesNotMatch(fs.readFileSync("index.html", "utf8"), /id="lineSyncNewJobBtn"/);
});

/* ============================================================
 *   Persistence: local session + RT Sync restore
 * ============================================================ */

test("both lot maps are part of the local session snapshot", () => {
  const body = functionBody("snapshotPayload");
  assert.match(body, /resinLots: state\.resinLots,/);
  assert.match(body, /nextRecipeLots: state\.nextRecipeLots,/);
});

test("restoring a payload re-normalizes both maps through rekeyLotMap - a session with neither field simply restores to {}", () => {
  const body = functionBody("applyPayload");
  assert.match(body, /state\.resinLots = rekeyLotMap\(payload\.resinLots\);/);
  assert.match(body, /state\.nextRecipeLots = rekeyLotMap\(payload\.nextRecipeLots\);/);
});

/* ============================================================
 *   Production Summary
 * ============================================================ */

test("a scanned lot renders in the dedicated lane; a resin without one gets the desktop-only empty-lane label", () => {
  const body = functionBody("renderResinCalculator");
  assert.match(body, /const lot = state\.resinLots\?\.\[keyName\(r\.displayName\)\] \|\| "";/);
  assert.match(body, /productionSummaryLotLane\$\{lot \? " hasLot" : ""\}/);
  assert.match(body, /\$\{lot \? `<div class="calcLot mono" data-resin-lot><\/div>` : `<span class="productionSummaryLotEmpty">No scanned lot<\/span>`\}/);
  assert.match(body, /if \(lot\) row\.querySelector\("\[data-resin-lot\]"\)\.textContent = lot;/);
  assert.match(styles, /\.productionSummaryLotEmpty\{display:none\}/);
  assert.match(styles, /@media \(min-width:701px\)\{[\s\S]*?\.productionSummaryLotEmpty\{[\s\S]*?display:block;/);
});

test("Production Summary always describes Current, never Next - the aggregation loop itself is untouched", () => {
  const body = functionBody("renderResinCalculator");
  assert.match(body, /state\.layers\.forEach\(\(L\)=>\{/, "aggregation must read state.layers directly, not recipeLayers()");
  assert.doesNotMatch(body, /recipeLayers\(\)/);
  assert.doesNotMatch(body, /nextRecipe/i);
});

test("the lot lookup does not touch the weight/lbs math at all", () => {
  const body = functionBody("renderResinCalculator");
  const beforeTotals = body.slice(0, body.indexOf("const totalEl"));
  assert.doesNotMatch(beforeTotals, /resinLots/, "lot lookup must happen at render time, not during aggregation");
  assert.match(beforeTotals, /const lbs = total \* layerFrac \* hopperFrac;/);
});

test("repeated occurrences of the same resin code still produce exactly one Production Summary row - unchanged aggregation", () => {
  const body = functionBody("renderResinCalculator");
  assert.match(body, /const k = keyName\(name\);/);
  assert.match(body, /if \(!totals\.has\(k\)\) totals\.set\(k, \{ displayName: name, lbs: 0 \}\);/);
  assert.match(body, /totals\.get\(k\)\.lbs \+= lbs;/);
});

test("fmtLb output is unchanged by this feature - the weight column still reads exactly as before", () => {
  assert.match(app, /<div class="mono calcValue">\$\{fmtLb\(r\.lbs\)\} lb<\/div>/);
});

/* ============================================================
 *   Styling: secondary text, no new chrome, mobile-safe
 * ============================================================ */

function cssRule(selector){
  const at = styles.indexOf(`\n${selector}{`);
  assert.notEqual(at, -1, `expected a ${selector} rule`);
  return styles.slice(at, styles.indexOf("}", at) + 1);
}

test(".calcLot reuses existing tokens - no hard-coded colors, no card/chip/border", () => {
  const rule = cssRule(".calcLot");
  assert.match(rule, /color:var\(--muted\)/);
  assert.match(rule, /font-size:var\(--font-small\)/);
  assert.doesNotMatch(rule, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.doesNotMatch(rule, /border|background|box-shadow|border-radius/);
});

test(".calcLot sits between the anchors without disturbing them - grows to fill space, truncates instead of wrapping or growing the row", () => {
  const rule = cssRule(".calcLot");
  assert.match(rule, /flex:1 1 0%/);
  assert.match(rule, /min-width:0/);
  assert.match(rule, /white-space:nowrap/);
  assert.match(rule, /text-overflow:ellipsis/);
  // The row height itself is untouched beyond the width/min-width fix below -
  // no change to .productionSummaryMaterialRow's min-height on either
  // breakpoint.
  assert.match(styles, /\.productionSummaryMaterialRow\{min-height:38px;padding:7px 10px;border-radius:var\(--control-radius\);width:100%;min-width:0\}/);
  assert.match(styles, /\.productionSummaryMaterialRow\{min-height:36px;padding:6px 9px\}/);
});

// --- Regression: found live in the browser, not by the source-pinning
// tests above. Two related bugs, both only visible with an unusually long
// lot number:
//
//  1. The row itself grew wider than its grid container (silently clipped
//     off-screen by an ancestor's overflow-x:hidden instead of ellipsizing),
//     because .calcTable's implicit grid track sizes from its widest row.
//  2. Even after pinning the row's width, a naive `flex:1 1 auto` on
//     .calcLot still let its own long content nudge the shrink calculation
//     by a fraction of a pixel, which was enough to visibly ellipsize the
//     resin CODE - exactly backwards from "resin code is primary, lot is
//     secondary." Verified visually, not just by measuring rects: scrollWidth
//     (integer) vs getBoundingClientRect (exact float) disagree by well under
//     a pixel for text in this font regardless of this feature, so the
//     screenshot - not the numeric comparison - was what actually caught it.

test("the row is pinned to its own grid track, not sized from its widest content", () => {
  const rule = cssRule(".productionSummaryMaterialRow");
  assert.match(rule, /width:100%/);
  assert.match(rule, /min-width:0/);
});

test("the lot's flex-basis is 0%, not auto - its own long content must never factor into how much space the resin code or weight receive", () => {
  const lotRule = cssRule(".calcLot");
  assert.match(lotRule, /flex:1 1 0%/, "a basis of auto would still let long content compete for space by a fraction of a pixel, which is enough to visibly ellipsize the resin code");
  // The weight keeps its own pre-existing, separate guarantee.
  assert.match(styles, /\.productionSummaryMaterialRow \.calcValue\{flex:0 0 auto;white-space:nowrap\}/);
});

test("a genuinely long resin NAME (independent of any lot) still ellipsizes exactly as it always has - calcLeft can still shrink, just only when there's truly nowhere else for the deficit to come from", () => {
  const nameRule = cssRule(".productionSummaryMaterialRow .calcLeft");
  assert.doesNotMatch(nameRule, /flex:0 0 auto/, "flex-shrink:0 here would have reintroduced the pre-existing long-name overflow this fix must not cause");
});

test("the lot gets a noticeably smaller font specifically on mobile, without a second row-height override", () => {
  const mobileBlock = styles.slice(styles.indexOf("@media (max-width:600px){", styles.indexOf(".calcLot{")));
  const block = mobileBlock.slice(0, mobileBlock.indexOf("\n}"));
  assert.match(block, /\.calcLot\{font-size:var\(--font-tiny\)\}/);
});

/* ============================================================
 *   Card copy stays accurate to what actually gets saved
 * ============================================================ */

test("the Save Recipe dialog's own description is unaffected - it already promises only recipe-definition fields, which lots were never part of", () => {
  assert.match(app, /This will save line type, layer percentages, resin assignments, and hopper percentages\. It will not save receiver weights, tracking, pump-off, timeline, or runtime state\./);
});

/* ============================================================
 *   index.html: nothing new required here
 * ============================================================ */

test("Production Summary's markup host is unchanged - lot rows are built entirely in JS, matching every other material row", () => {
  assert.match(index, /id="resinCalcResults" class="calcTable"/);
});
