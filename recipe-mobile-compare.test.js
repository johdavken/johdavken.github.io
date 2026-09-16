"use strict";

// Compare mode on the compact phone recipe grid.
//
// The desktop grid has long been able to read Current and Next against each
// other: a corner toggle reveals, in every cell, the other page's resin for
// that position. It was gated off on phones - the surface operators actually
// carry - on the assumption there was no room. There is, on one condition:
// only in Summary (tap = track), never in Edit, which already fills the cell
// with its own marks, and only for the hoppers that actually change.
//
// So the phone gets an eye key beside the Load key, and a differing hopper
// gets a band across the foot of its cell saying "NEXT <code>" (or "CURRENT
// <code>" on the Next page). Same-resin hoppers render exactly as before. A
// hopper emptied in the other recipe reads "NEXT —". Everything reuses the
// pointer grid's flag, attribute and accessor, so the two surfaces can never
// disagree about what is being compared.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles } = require("./css-source");
const { ruleIn, occurrences, PHONE } = require("./css-media");

const app = fs.readFileSync("app.js", "utf8");
const styles = readStyles();

function recipeEditor() {
  const start = app.indexOf("function renderSplitsArea(){");
  const end = app.indexOf("function renderResinCalculator(");
  assert.ok(start > 0 && end > start, "renderSplitsArea() should precede renderResinCalculator()");
  return app.slice(start, end);
}

function compactHeaderBranch() {
  const editor = recipeEditor();
  const start = editor.indexOf("if (compactMobileRecipe){\n        scanRecipeButton.classList.remove(");
  assert.ok(start > 0, "the compact header branch should relocate the Scan key");
  const end = editor.indexOf("}else{", start);
  return editor.slice(start, end);
}

function phoneBody(anchor) {
  const hit = ruleIn(styles, anchor, PHONE);
  assert.ok(hit, `${anchor} should have a rule inside the phone block`);
  return hit.body;
}

/* Every mention of `fragment` in the stylesheet sits under a phone media
 * query - the phone blocks are several, so "outside" is checked per
 * occurrence rather than by subtracting one block. */
function phoneOnly(fragment) {
  const hits = occurrences(styles, fragment, { anywhere: true });
  assert.ok(hits.length > 0, `${fragment} should be styled somewhere`);
  for (const hit of hits) assert.ok(hit.condition && PHONE.test(hit.condition), `${fragment} styled outside the phone block at ${hit.index}`);
}

/* ============================================================
 *   Availability: compact Summary only
 * ============================================================ */

test("compare is available on the compact grid in Summary only, through the shared overlay flag", () => {
  const editor = recipeEditor();
  assert.match(editor, /const crossOverlayCompact = compactMobileRecipe && summaryView;/);
  assert.match(editor, /const crossOverlayAvailable = reworkedGrid \|\| cellsTypeable \|\| crossOverlayCompact;/);
  // Edit never builds it: the attribute is derived from availability, so a
  // flag left on from Summary reveals nothing in Edit and comes back on
  // return - no second flag, no persistence.
  assert.match(editor, /area\.dataset\.crossOverlay = \(crossOverlayAvailable && recipeShowCrossResinOverlay\) \? "on" : "off";/);
  assert.match(app, /let recipeShowCrossResinOverlay = false;/);
  const snapshot = app.slice(app.indexOf("function snapshotPayload(){"), app.indexOf("function applySharedActiveJob("));
  assert.doesNotMatch(snapshot, /recipeShowCrossResinOverlay/);
  assert.doesNotMatch(app, /recipeShowCrossResinOverlay[^\n]*(localStorage|writeJson|setItem)/);
});

test("the pointer grid's corner toggle is not built for the compact grid", () => {
  const editor = recipeEditor();
  assert.match(editor, /if \(crossOverlayAvailable && !crossOverlayCompact\)\{\s*\n\s*const overlayToggle = document\.createElement\("button"\);/);
});

/* ============================================================
 *   The eye key
 * ============================================================ */

test("the eye key is built on every compact render, after Load and before the pencil", () => {
  const branch = compactHeaderBranch();
  assert.match(branch, /compareButton\.id = "mobileCompareRecipeButton";/);
  assert.match(branch, /compareButton\.className = "recipeHeaderMobileAction mobileCompareAction";/);
  // Built outside the page conditionals - Current and Next alike, Edit
  // included - so the key row never reflows when the mode flips.
  const build = branch.indexOf("const compareButton = document.createElement");
  const loadAppend = branch.lastIndexOf("headerActions?.append(loadCurrentButton);");
  assert.ok(build > loadAppend, "the eye follows the Load key");
  assert.match(branch, /headerActions\?\.append\(compareButton\);\s*$/);
  // Header keys are appended in document order; the pencil is static markup
  // that follows #recipeHeaderActions, so "before the pencil" holds by
  // construction (see #recipeHeaderActionPill in index.html).
  const html = fs.readFileSync("index.html", "utf8");
  assert.ok(html.indexOf('data-recipe-view="edit"') < html.indexOf('id="recipeHeaderActions"'));
  assert.match(styles, /#splitsBlock \.recipeHeaderRow \.recipeHeaderActions\{[^}]*order:-1;/);
});

test("the eye is an eye: one almond, one pupil, stroked like the other keys", () => {
  const branch = compactHeaderBranch();
  const markup = branch.slice(branch.indexOf("compareButton.innerHTML ="), branch.indexOf("const compareUsable"));
  assert.match(markup, /<svg class="recipeActionIcon" viewBox="0 0 24 24" aria-hidden="true">/);
  assert.equal((markup.match(/<path /g) || []).length, 1);
  assert.equal((markup.match(/<circle /g) || []).length, 1);
  assert.doesNotMatch(markup, /<rect /);
});

test("the eye is disabled in Edit and on Current without a plan; Next always has the live recipe to compare", () => {
  const branch = compactHeaderBranch();
  assert.match(branch, /const compareUsable = crossOverlayCompact && \(isNextRecipePage\(\) \|\| hasPlannedRecipe\(\)\);/);
  assert.match(branch, /compareButton\.disabled = !compareUsable;/);
  assert.match(branch, /compareButton\.setAttribute\("aria-disabled", String\(!compareUsable\)\);/);
  // The disabled look already exists for every header key.
  assert.match(styles, /#splitsBlock \.recipeHeaderActions \.recipeHeaderMobileAction:disabled\{ opacity:\.5; cursor:default; \}/);
});

test("the eye's label names the counterpart recipe and its click reveals rather than re-renders", () => {
  const branch = compactHeaderBranch();
  assert.match(branch, /const label = `\$\{on \? "Hide" : "Show"\} \$\{crossOverlayLabel\} resin`;/);
  assert.match(branch, /compareButton\.setAttribute\("aria-pressed", String\(on\)\);/);
  const click = branch.slice(branch.indexOf('compareButton.addEventListener("click"'), branch.indexOf("headerActions?.append(compareButton);"));
  assert.match(click, /if \(!compareUsable\) return;/);
  assert.match(click, /recipeShowCrossResinOverlay = !recipeShowCrossResinOverlay;/);
  assert.match(click, /area\.dataset\.crossOverlay = recipeShowCrossResinOverlay \? "on" : "off";/);
  assert.doesNotMatch(click, /renderSplitsArea/);
  // Pressed reads as a pressed key, the same treatment the open Scan popup gets.
  assert.match(styles, /#splitsBlock \.recipeHeaderActions \.recipeHeaderMobileAction\[aria-expanded="true"\],\s*\n\s*#splitsBlock \.recipeHeaderActions \.mobileCompareAction\[aria-pressed="true"\]\{/);
});

test("four keys fit beside four tabs: the Current/Next pages step the keys and tab padding down, at 700 and again at 384", () => {
  const key = '#splitsBlock .recipeHeaderActions > .recipeHeaderMobileAction{';
  const wide = occurrences(styles, 'body[data-recipe-page="next"] ' + key, { anywhere: true });
  assert.equal(wide.length, 2, "one rule in the phone block, one in the narrow-phone block");
  const [phone, narrow] = wide;
  assert.match(phone.condition, PHONE);
  assert.match(phone.body, /width:44px;\s*\n\s*min-width:44px;/);
  assert.match(narrow.condition, /max-width:\s*384px/);
  assert.match(narrow.body, /width:42px;\s*\n\s*min-width:42px;/);
  const tab = occurrences(styles, 'body[data-recipe-page="next"] #splitsBlock .recipePageTab{', { anywhere: true });
  assert.deepEqual(tab.map(t => t.body.replace(/[{}]/g, "").trim()), ["padding-inline:10px;", "padding-inline:7px;"]);
  // Weights and Recipe Book never show four keys and keep the established 48px.
  assert.doesNotMatch(styles, /data-recipe-page="(weights|saved)"\][^{]*recipeHeaderMobileAction/);
});

/* ============================================================
 *   The per-cell band
 * ============================================================ */

test("every surface carries the line only where the other recipe differs, by keyName on both sides", () => {
  const editor = recipeEditor();
  assert.match(editor, /const crossDiffers = crossOverlayAvailable && keyName\(crossResin\) !== keyName\(hopper\.resinName\);/);
  assert.match(editor, /let crossOverlay = null;\s*\n\s*if \(crossDiffers\)\{/);
  // keyName trims, collapses whitespace and uppercases: a case-only
  // respelling is not a change; an emptied or newly filled hopper is.
  assert.match(app, /function keyName\(s\)\{ return normName\(s\)\.toUpperCase\(\); \}/);
});

test("the compact band's tag is an arrow - to on Current, from on Next - and the code takes the room", () => {
  const editor = recipeEditor();
  assert.match(editor, /tag\.textContent = crossOverlayLabel;/);
  assert.match(editor, /if \(crossOverlayCompact\) tag\.textContent = crossOverlayLabel === "current" \? "\\u2190" : "\\u2192";/);
  const code = phoneBody("#splitsArea[data-recipe-cells=\"static\"] .splitsMatrix.compactMobileRecipe .splitCellCrossResin--foot b{");
  assert.match(code, /flex:1 1 auto;/);
  assert.match(code, /text-align:right;/);
  const tag = phoneBody("#splitsArea[data-recipe-cells=\"static\"] .splitsMatrix.compactMobileRecipe .splitCellCrossResin--foot em{");
  assert.doesNotMatch(tag, /text-transform/);
});

test("where the code would still ellipsise beside the arrow, the band goes tight and the arrow is dropped", () => {
  const editor = recipeEditor();
  assert.match(editor, /function fitCompactCompareBands\(\)\{\s*\n\s*if \(!crossOverlayCompact \|\| area\.dataset\.crossOverlay !== "on"\) return;/);
  assert.match(editor, /if \(code && code\.scrollWidth > code\.clientWidth\) band\.classList\.add\("is-tight"\);/);
  // Measured on the eye's click and once after a render that shows bands; never a re-render.
  const click = editor.slice(editor.indexOf('compareButton.addEventListener("click"'), editor.indexOf("headerActions?.append(compareButton);"));
  assert.match(click, /fitCompactCompareBands\(\);/);
  assert.match(editor, /area\.append\(interactionHint\);\s*\n\s*if \(crossOverlayCompact && recipeShowCrossResinOverlay\) requestAnimationFrame\(fitCompactCompareBands\);/);
  const fit = editor.slice(editor.indexOf("function fitCompactCompareBands(){"), editor.indexOf("// Which parts of a cell keep an interaction"));
  assert.doesNotMatch(fit, /renderSplitsArea/);
  const tight = phoneBody("#splitsArea[data-recipe-cells=\"static\"] .splitsMatrix.compactMobileRecipe .splitCellCrossResin--foot.is-tight em{");
  assert.match(tight, /display:none;/);
});

test("an emptied hopper reads as the empty cell's own placeholder", () => {
  const editor = recipeEditor();
  assert.match(editor, /value\.textContent = crossResin \|\| "\\u2014";/);
  assert.match(editor, /\$\{crossResin \|\| "nothing"\}/);
});

test("the compact band is the cell grid's implicit third row, not a header chip", () => {
  const editor = recipeEditor();
  assert.match(editor, /if \(!crossOverlayCompact\) cellHeader\.append\(crossOverlay\);/);
  assert.match(editor, /cellInner\.append\(cellHeader, editor\);\s*\n[\s\S]{0,400}?if \(crossOverlay && crossOverlayCompact\) cellInner\.append\(crossOverlay\);/);
  const band = phoneBody("#splitsArea[data-recipe-cells=\"static\"] .splitsMatrix.compactMobileRecipe .splitCellCrossResin--foot{");
  assert.match(band, /grid-column:1 \/ -1;/);
  // No declared third track: while the overlay is off the span is
  // display:none, so no row-gap is spent and the grid is exactly as before.
  const inner = phoneBody("#splitsArea[data-recipe-cells=\"static\"] .splitsMatrix.compactMobileRecipe .splitCellInner{");
  assert.match(inner, /"badge pct"\s*\n\s*"resin resin";/);
  assert.doesNotMatch(inner, /other|compare|cross/);
  assert.match(styles, /\.splitCellCrossResin\{[^}]*display:none;/);
  assert.match(styles, /#splitsArea\[data-cross-overlay="on"\] \.splitCellCrossResin\{display:flex\}/);
});

test("the band is accent-tinted and bleeds to the cell's padding edge; never warn", () => {
  const band = phoneBody("#splitsArea[data-recipe-cells=\"static\"] .splitsMatrix.compactMobileRecipe .splitCellCrossResin--foot{");
  assert.match(band, /background:color-mix\(in srgb, var\(--focus-border\) 14%, transparent\);/);
  assert.match(band, /margin:0 -3px -5px;/);
  assert.match(band, /max-width:none;/);
  assert.doesNotMatch(band, /--warn|--bad/);
  const cell = phoneBody("#splitsArea[data-recipe-cells=\"static\"] .splitsMatrix.compactMobileRecipe td.splitMatrixCell{");
  assert.match(cell, /padding:5px 3px;/, "the band's negative margins mirror the cell padding");
  const tag = phoneBody("#splitsArea[data-recipe-cells=\"static\"] .splitsMatrix.compactMobileRecipe .splitCellCrossResin--foot em{");
  assert.match(tag, /color:var\(--focus-border\);/);
  const code = phoneBody("#splitsArea[data-recipe-cells=\"static\"] .splitsMatrix.compactMobileRecipe .splitCellCrossResin--foot b{");
  assert.match(code, /font-size:10px;/);
  assert.match(code, /color:var\(--title\);/);
});

test("the differs class is styled nowhere outside the phone block, and the compact grid keeps its 52px cell", () => {
  phoneOnly("splitCellCrossResin--foot");
  if (styles.includes("cross-differs")) phoneOnly("cross-differs");
  const cell = phoneBody("#splitsArea[data-recipe-cells=\"static\"] .splitsMatrix.compactMobileRecipe .splitMatrixCell{");
  assert.match(cell, /min-height:52px;/);
});

/* ============================================================
 *   The pointer grid's chip (tablet and desktop)
 * ============================================================ */

test("on the pointer grid the differing hopper's line is an accent chip inside the badge slot - same accent, no size change", () => {
  const { occurrences } = require("./css-media");
  const base = occurrences(styles, ".splitCellCrossResin{").find(o => !o.condition);
  assert.ok(base, "the base rule lives outside any media query");
  assert.match(base.body, /padding:2px 5px;/);
  assert.match(base.body, /border-radius:5px;/);
  assert.match(base.body, /background:color-mix\(in srgb, var\(--focus-border\) 14%, transparent\);/);
  assert.match(base.body, /box-shadow:inset 0 0 0 1px color-mix\(in srgb, var\(--focus-border\) 30%, transparent\);/);
  assert.match(base.body, /line-height:1;/);
  assert.doesNotMatch(base.body, /--warn|--bad|min-height|(^|[^-])height:/);
  const tag = occurrences(styles, ".splitCellCrossResin em{").find(o => !o.condition);
  assert.match(tag.body, /font-size:7\.5px;/);
  assert.match(tag.body, /color:var\(--focus-border\);/);
  const code = occurrences(styles, ".splitCellCrossResin b{").find(o => !o.condition);
  assert.match(code.body, /font-size:9\.5px;/);
  assert.match(code.body, /color:var\(--title\);/);
  // The phone band squares the chip off again - it is a band, not a pill.
  const band = phoneBody("#splitsArea[data-recipe-cells=\"static\"] .splitsMatrix.compactMobileRecipe .splitCellCrossResin--foot{");
  assert.match(band, /border-radius:0;/);
});

/* ============================================================
 *   Nothing else moved
 * ============================================================ */

test("the interaction hint and the tracking tap are untouched", () => {
  const editor = recipeEditor();
  assert.match(editor, /interactionHint\.className = "recipeInteractionHint";/);
  assert.match(editor, /interactionCount\.textContent = ` - \$\{count\} selected`;/);
  assert.match(editor, /if \(!trackingView \|\| bulkMode \|\| hopperRearrangement\?\.active\) return;/);
});
