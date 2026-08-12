"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

/** The recipe editor's own body - everything the Current/Next pages share. */
function recipeEditor(){
  const start = app.indexOf("    function renderSplitsArea(){");
  const end = app.indexOf("    function renderResinCalculator(){", start);
  assert.ok(start > -1 && end > start, "expected renderSplitsArea");
  return app.slice(start, end);
}

/* ============================================================
 *   One editor, two pages
 * ============================================================ */

test("the editor reads the selected page, never state.layers directly", () => {
  const editor = recipeEditor();
  assert.doesNotMatch(editor, /state\.layers/,
    "the recipe editor must go through recipeLayers() or the two pages share one array");
  assert.ok(editor.includes("recipeLayers()"), "expected the editor to use the accessor");
  assert.match(app, /function recipeLayers\(\)\{\s*\n\s*return isNextRecipePage\(\) \? ensureNextRecipeWorking\(\) : state\.layers;/);
});

test("operational code keeps reading state.layers, so the plan cannot reach the Timeline", () => {
  // Readiness, run-down, tracking totals and production all live outside the
  // editor and must be indifferent to which page is on screen.
  const editor = recipeEditor();
  const operational = app.replace(editor, "");
  assert.ok(operational.includes("state.layers"), "operational code should still read the live recipe");
  assert.doesNotMatch(operational, /recipeLayers\(\)[^;]*\.forEach\(L=>L\.hoppers\.forEach\(\(h,hi\)=>\{ if \(h\.track\)/,
    "tracking collection must not be routed through the page accessor");
});

test("Rearrange is parameterized rather than duplicated per page", () => {
  const editor = recipeEditor();
  // The module already takes a layers array; both pages use the same calls.
  assert.match(editor, /window\.PolynHopperRearrangement\.move\(recipeLayers\(\),/);
  assert.match(editor, /window\.PolynHopperRearrangement\.snapshot\(recipeLayers\(\)\)/);
  assert.doesNotMatch(app, /nextRecipeRearrange|currentRecipeRearrange|rearrangeNext/);
});

/* ============================================================
 *   Page state
 * ============================================================ */

test("Recipe always opens on Current", () => {
  assert.match(app, /let activeRecipePage = "current";/);
  // The selected page is intentionally not persisted with the session.
  const snapshot = app.slice(app.indexOf("function snapshotPayload(){"), app.indexOf("function applySharedActiveJob("));
  assert.doesNotMatch(snapshot, /activeRecipePage/);
});

test("switching pages folds the plan into durable state before the grid moves", () => {
  const body = app.slice(app.indexOf("function setRecipePage("), app.indexOf("function hookRecipePageTabs("));
  assert.match(body, /if \(isNextRecipePage\(\)\) commitNextRecipeWorking\(\);/);
  assert.match(body, /activeRecipePage = next;/);
  assert.match(body, /renderSplitsArea\(\);/);
  // Switching a page must not re-run validation against the plan.
  assert.doesNotMatch(body, /validateAndCompute/);
});

test("every existing save persists the plan, without touching the edit handlers", () => {
  // One commit point inside snapshotPayload, so the ~20 handlers that already
  // call saveSession() keep the plan current for free.
  assert.match(app, /function snapshotPayload\(\)\{[\s\S]{0,300}?commitNextRecipeWorking\(\);/);
});

test("the plan follows the line's layer structure rather than carrying its own", () => {
  const body = app.slice(app.indexOf("function ensureNextRecipeWorking("), app.indexOf("function commitNextRecipeWorking("));
  assert.match(body, /getLayerNamesForType\(state\.lineType\)/);
});

test("the working plan carries no operational or physical values", () => {
  const body = app.slice(app.indexOf("function ensureNextRecipeWorking("), app.indexOf("function commitNextRecipeWorking("));
  assert.match(body, /weight: 0, track: false, pumpOff: false, usableHeight: 0, circumference: 0/);
});

/* ============================================================
 *   Tab UI
 * ============================================================ */

test("the tabs are part of the Recipe panel, directly above the grid", () => {
  const panel = html.slice(html.indexOf('id="splitsBlock"'), html.indexOf("</details>", html.indexOf('id="splitsBlock"')));
  const tabsAt = panel.indexOf('class="recipePageTabs"');
  const gridAt = panel.indexOf('id="splitsArea"');
  assert.ok(tabsAt > -1 && gridAt > tabsAt, "the tab strip should sit immediately above the grid");
  // Flush against the grid rather than floating above it.
  assert.match(styles, /\.recipePageTabs\{[\s\S]*?margin: 0 0 -1px;/);
  assert.match(styles, /\.recipePageTab\.active\{[\s\S]*?border-bottom: 1px solid var\(--panel\);/);
});

test("the tabs use real tab semantics and are keyboard navigable", () => {
  assert.match(html, /class="recipePageTabs" role="tablist"/);
  assert.match(html, /id="recipePageTabCurrent" role="tab" aria-selected="true" aria-controls="splitsArea"/);
  assert.match(html, /id="recipePageTabNext" role="tab" aria-selected="false" aria-controls="splitsArea"/);
  assert.match(html, /id="splitsArea"[^>]*role="tabpanel"/);
  const hook = app.slice(app.indexOf("function hookRecipePageTabs("));
  assert.match(hook, /ArrowRight/);
  assert.match(hook, /ArrowLeft/);
  // Roving tabindex: the strip is a single stop.
  assert.match(app, /tab\.tabIndex = selected \? 0 : -1;/);
  assert.match(styles, /\.recipePageTab:focus-visible\{[\s\S]*?outline: 2px solid var\(--focus-border\);/);
});

test("aria-selected and the panel's label follow the selected page", () => {
  const body = app.slice(app.indexOf("function syncRecipePageUI("), app.indexOf("function setRecipePage("));
  assert.match(body, /tab\.setAttribute\("aria-selected", String\(selected\)\)/);
  assert.match(body, /aria-labelledby", isNextRecipePage\(\) \? "recipePageTabNext" : "recipePageTabCurrent"/);
});

test("a planned recipe is marked quietly, and the marker tracks edits", () => {
  assert.match(html, /<span class="recipePageTabDot" id="recipePageTabNextDot" hidden aria-hidden="true">/);
  // Refreshed whenever the plan is committed, not only when tabs are clicked.
  assert.match(app, /function commitNextRecipeWorking\(\)\{[\s\S]*?syncPlannedRecipeIndicator\(\);/);
  assert.match(app, /planned \? "Next — a recipe is planned" : "Next"/);
  // A 6px dot, not a badge.
  const dot = styles.slice(styles.indexOf(".recipePageTabDot{"), styles.indexOf("}", styles.indexOf(".recipePageTabDot{")));
  assert.match(dot, /width: 6px;/);
});

test("operational controls are not offered on a plan", () => {
  // A plan has no tracking or pump-off to control, by construction.
  assert.match(styles, /body\[data-recipe-page="next"\] \.splitTrackControl,\s*\nbody\[data-recipe-page="next"\] \.splitsInfo\{ display: none; \}/);
  assert.match(app, /document\.body\.dataset\.recipePage = activeRecipePage;/);
});

test("both tabs stay tappable on a phone", () => {
  const mobile = styles.slice(styles.indexOf("@media (max-width: 900px){", styles.indexOf(".recipePageTabDot[hidden]")));
  const block = mobile.slice(0, mobile.indexOf("\n}"));
  assert.match(block, /\.recipePageTab\{ flex: 1 1 0; min-height: 44px;/);
});

test("no duplicated per-page action implementations were introduced", () => {
  for (const forbidden of [/currentRecipeBulkEdit/, /nextRecipeBulkEdit/, /nextRecipePrint/, /renderNextRecipeArea/]){
    assert.doesNotMatch(app, forbidden, `${forbidden} suggests a duplicated implementation`);
  }
});

/* ============================================================
 *   Phase 3: actions follow the selected page
 * ============================================================ */

test("one destination-aware entry point serves both Saved Recipes and Scan", () => {
  assert.match(app, /function applyRecipeToActivePage\(payload,\{kind\}=\{\}\)\{/);
  // Saved Recipes routes recipes through it...
  const saved = app.slice(app.indexOf("function applyWorkspaceConfiguration("), app.indexOf("function applyRecipeToActivePage("));
  assert.match(saved, /applyRecipeToActivePage\(item\.payload,\{kind:"load-workspace-configuration"\}\)/);
  // ...and so does Scan.
  const scan = app.slice(app.indexOf("function applyScannedRecipePayload("), app.indexOf("function openWorkspaceConfigurationDialog("));
  assert.match(scan, /applyRecipeToActivePage\(payload, \{ kind:"apply-recipe-scan" \}\)/);
});

test("writing a plan never publishes an active job or re-runs readiness", () => {
  const router = app.slice(app.indexOf("function applyRecipeToActivePage("), app.indexOf("function recipePageLabel("));
  const planBranch = router.slice(router.indexOf("const stored="));
  assert.doesNotMatch(planBranch, /notifyActiveJobMutation/, "a plan is not the running job");
  assert.doesNotMatch(planBranch, /validateAndCompute/, "a plan must not drive operational readiness");
  // The grid is rebuilt from the plan just stored, not the one it replaced.
  assert.match(planBranch, /nextRecipeWorking=null;\s*\n\s*ensureNextRecipeWorking\(\);/);
});

test("loading a saved recipe names its destination before replacing anything", () => {
  const preview = app.slice(app.indexOf("function previewWorkspaceConfiguration("), app.indexOf("function applyWorkspaceConfiguration("));
  assert.match(preview, /const intoNext=recipe && isNextRecipePage\(\);/);
  assert.match(preview, /This will replace the planned Next Recipe/);
  assert.match(preview, /The current recipe being run is not changed/);
  assert.match(preview, /confirm\.textContent=recipe\?\(intoNext\?"Load into Next":"Load Recipe"\)/);
});

test("a saved recipe for a different layer count is called out when planning", () => {
  const preview = app.slice(app.indexOf("function previewWorkspaceConfiguration("), app.indexOf("function applyWorkspaceConfiguration("));
  assert.match(preview, /The planned recipe follows this line's \$\{state\.lineType\}-layer structure/);
});

test("Print prints the page on screen and says which one it is", () => {
  const print = app.slice(app.indexOf("function printRecipeSheet(){"), app.indexOf("Recipe pages: Current and Next"));
  assert.match(print, /title\.textContent = recipePageLabel\(\);/);
  assert.match(print, /recipeLayers\(\)\.forEach/);
  // Screen chrome stays off the sheet.
  assert.doesNotMatch(print, /splitTrackControl|splitCellSelector|recipePageTab/);
});

test("planning totals are muted, and the warning voice is reserved for the running recipe", () => {
  assert.match(app, /const planning = isNextRecipePage\(\);/);
  assert.match(app, /const shortfall = planning \? "of 100% planned" : "— expected 100%";/);
  assert.match(styles, /\.splitColumnTotal\.planning,\s*\n\.splitsMatrixSummary\.planning\{ color: var\(--muted\)/);
});

test("Bulk Edit needed no per-page code - it already edits the selected page", () => {
  // Bulk Edit lives inside the editor and mutates the hopper objects it was
  // handed, so routing the editor through recipeLayers() covered it.
  const editor = recipeEditor();
  assert.ok(editor.includes("recipeLayers()"));
  assert.doesNotMatch(app, /bulkEditTarget|bulkApplyTo\(/);
});
