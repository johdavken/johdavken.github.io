"use strict";

// Wide Touch (a tablet, the unfolded Fold: above the compact breakpoint,
// coarse pointer) runs the phone's mode axis over the reworked, transposed
// grid. Desktop's "always live, click selects, the dot tracks" model needs
// a pointer that can hit a 22px clock; on glass it could not, and the
// always-present toolbar spent a row the tablet did not have to give.
//
// So on Wide Touch: Summary makes the whole cell the tracking target with
// the live fields inert; Edit raises the toolbar and a tap selects (fields
// still type, as on desktop's Edit); the per-cell clock is gone; and the
// page's actions are the phone's icon keys - scan / load / compare / pencil.
// The grid itself - layers left, six positions across, live fields - is the
// same one desktop draws, so no cell changes size.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles } = require("./css-source");
const { occurrences } = require("./css-media");

const app = fs.readFileSync("app.js", "utf8");
const styles = readStyles();

function recipeEditor() {
  const start = app.indexOf("function renderSplitsArea(){");
  const end = app.indexOf("function renderResinCalculator(");
  assert.ok(start > 0 && end > start);
  return app.slice(start, end);
}

function touchRule(anchor) {
  const hits = occurrences(styles, anchor);
  assert.ok(hits.length > 0, `${anchor} should be styled`);
  return hits[hits.length - 1];
}

/* ============================================================
 *   The shell decision
 * ============================================================ */

test("wide touch is the reworked grid on a non-desktop shell, and desktop's modeless grid is the complement", () => {
  const editor = recipeEditor();
  assert.match(editor, /const wideTouch = reworkedGrid && !isDesktopLayout\(\);/);
  assert.match(editor, /const modelessGrid = reworkedGrid && !wideTouch;/);
  // The same query that sets body[data-shell]: width AND a fine pointer.
  assert.match(app, /desktop: window\.matchMedia\("\(min-width: 901px\) and \(pointer: fine\)"\)/);
  assert.match(app, /const shell = desktop \? "desktop" : "touch";/);
});

test("the mode axis: Summary/Edit on every touch surface, only desktop is modeless", () => {
  const editor = recipeEditor();
  assert.match(editor, /const summaryView = modelessGrid \? false : viewMode === "summary";/);
  assert.match(editor, /const trackingView = !isNextRecipePage\(\) && \(modelessGrid \|\| summaryView\);/);
  assert.match(editor, /let bulkMode = modelessGrid \? true : viewMode === "edit";/);
  // Fields stay live on the wide grid (desktop's Edit hybrid), so the
  // layout is unchanged; Summary's inertness is CSS, below.
  assert.match(editor, /const cellsTypeable = reworkedGrid \|\| isDesktopLayout\(\);/);
  assert.match(editor, /const cellFieldsTypeable = cellsTypeable && !summaryView;/);
  // The Edit/Done pencil is hidden only on the desktop shell.
  assert.match(app, /viewToggle\.hidden = isSavedRecipesPage\(\) \|\| isWeightsPage\(\) \|\| isDesktopLayout\(\);/);
});

test("in Summary an inert field is cell surface: a tap that reaches it still tracks", () => {
  const editor = recipeEditor();
  const fn = editor.slice(editor.indexOf("function isOwnCellInteraction(target){"), editor.indexOf("function toggleSelection(keys){"));
  assert.match(fn, /if \(control\.tagName === "LABEL"\) return cellFieldsTypeable;/);
  assert.match(fn, /if \(control\.tagName === "INPUT" && !cellFieldsTypeable && control\.type !== "checkbox"\) return false;/);
  // Desktop's typeable Edit fields and the selector checkbox keep the tap.
  assert.match(fn, /return true;\s*\n\s*\}/);
});

test("the toolbar is raised by Edit on touch and always present only on desktop; the hint uses the phone's wording", () => {
  const editor = recipeEditor();
  assert.match(editor, /toolbar\.classList\.toggle\("hide", modelessGrid \? false : !bulkMode\);/);
  assert.match(editor, /const interactionAction = modelessGrid\s*\n?\s*\? \(trackingView \? "select · click its dot to track" : "select"\)/);
  assert.match(editor, /if \(rearranging\) return;\s*\n\s*if \(modelessGrid\)\{/);
  // Summary's tap tracks, Edit's tap selects - the same two handlers the phone uses.
  assert.match(editor, /if \(!trackingView \|\| bulkMode \|\| hopperRearrangement\?\.active\) return;/);
  assert.match(editor, /if\(!bulkMode\|\|hopperRearrangement\?\.active\) return;/);
});

/* ============================================================
 *   Header keys and compare
 * ============================================================ */

test("every touch surface gets the icon-key header - scan, load, compare, pencil - and no corner toggle", () => {
  const editor = recipeEditor();
  assert.match(editor, /const iconKeyHeader = compactMobileRecipe \|\| wideTouch;/);
  assert.match(editor, /if \(iconKeyHeader\)\{\s*\n\s*scanRecipeButton\.classList\.remove\("rearrangeDesktopOnly", "recipeScanHideDesktop"\);/);
  assert.match(editor, /const crossOverlayAvailable = iconKeyHeader \? summaryView : \(reworkedGrid \|\| cellsTypeable\);/);
  assert.match(editor, /if \(crossOverlayAvailable && !iconKeyHeader\)\{\s*\n\s*const overlayToggle/);
  assert.match(editor, /const compareUsable = summaryView && \(isNextRecipePage\(\) \|\| hasPlannedRecipe\(\)\);/);
  // The foot band stays a compact-only placement; wide touch keeps the chip.
  assert.match(editor, /const crossOverlayCompact = compactMobileRecipe && summaryView;/);
});

/* ============================================================
 *   CSS: the wide-touch grid
 * ============================================================ */

test("wide touch drops the per-cell clock and makes Summary's live fields inert, outranking the transposed pointer rules", () => {
  const clock = touchRule('body[data-shell="touch"] #splitsArea[data-recipe-layout="transposed"] .splitTrackControl{');
  assert.match(clock.body, /display:none;/);
  const inert = touchRule('body[data-shell="touch"] #splitsArea[data-recipe-layout="transposed"][data-recipe-view="summary"] .splitMatrixCell input,');
  assert.match(inert.body, /pointer-events:none;/);
  assert.match(inert.body, /border-color:transparent;/);
  // These sit after the transposed rules that re-enable pointer events.
  const reenable = styles.indexOf('body #splitsArea[data-recipe-layout="transposed"] .splitInput{');
  assert.ok(reenable > 0 && clock.index > reenable && inert.index > reenable);
});

test("the resin name is fitted to its column after a render - font stepped down, never below 10px, cell size untouched", () => {
  const editor = recipeEditor();
  const fit = editor.slice(editor.indexOf("function fitWideTouchResinNames(){"), editor.indexOf("function fitCompactCompareBands(){"));
  assert.match(fit, /if \(!wideTouch\) return;/);
  assert.match(fit, /input\.style\.removeProperty\("font-size"\);/);
  assert.match(fit, /size > 10 && input\.scrollWidth > input\.clientWidth/);
  assert.match(fit, /size = Math\.max\(10, size - 0\.5\);/);
  assert.doesNotMatch(fit, /renderSplitsArea|height|width\s*=/);
  assert.match(editor, /if \(wideTouch\) requestAnimationFrame\(fitWideTouchResinNames\);/);
  const pad = touchRule('body[data-shell="touch"] #splitsArea[data-recipe-layout="transposed"] .splitMatrixCell .resinNameInput{');
  assert.match(pad.body, /padding-inline:0;/);
});

test("the percentage field is sized in ems so a decimal never clips", () => {
  const pct = touchRule('body[data-shell="touch"] #splitsArea[data-recipe-layout="transposed"] .splitPctControl input{');
  assert.match(pct.body, /width:2\.9em;/);
  assert.match(pct.body, /min-width:2\.9em;/);
  assert.doesNotMatch(pct.body, /width:30px/);
});

test("the header keys are restated for the touch shell above 700px, same metrics as the phone's", () => {
  const key = touchRule('body[data-shell="touch"] #splitsBlock .recipeHeaderActions > .recipeHeaderMobileAction,');
  assert.match(key.condition, /min-width:\s*701px/);
  assert.match(key.body, /width:48px;[\s\S]*?height:44px;/);
  assert.match(key.body, /font-size:0;/);
  const pencil = touchRule('body[data-shell="touch"] #splitsBlock #recipeHeaderActionPill .recipeViewToggle button[data-recipe-view="edit"]::before{');
  assert.match(pencil.body, /width:19px;/);
  const latched = touchRule('body[data-shell="touch"] #splitsBlock .recipeHeaderActions .mobileCompareAction[aria-pressed="true"],');
  assert.match(latched.body, /background:var\(--btnstyle-ink\);/);
  const actions = touchRule('body[data-shell="touch"] #splitsBlock .recipeHeaderRow .recipeHeaderActions{');
  assert.match(actions.body, /order:-1;/);
});
