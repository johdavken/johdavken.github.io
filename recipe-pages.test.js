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
 *   One editor, two recipe data pages plus the Saved Recipes library
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
 *   Next Recipe: "show current resin" overlay
 * ============================================================ */

test("the current-resin overlay is Next-only, pointer-only, and off by default", () => {
  const editor = recipeEditor();
  // Off by default (crossed-out eye), module level so it survives re-renders,
  // and never persisted with the session.
  assert.match(app, /let nextRecipeShowCurrentResinOverlay = false;/);
  const snapshot = app.slice(app.indexOf("function snapshotPayload(){"), app.indexOf("function applySharedActiveJob("));
  assert.doesNotMatch(snapshot, /nextRecipeShowCurrentResinOverlay/);
  // Availability is gated on the Next page AND a typeable (pointer) grid.
  assert.match(editor, /const currentOverlayAvailable = isNextRecipePage\(\) && cellsTypeable;/);
  assert.match(editor, /area\.dataset\.currentOverlay = \(currentOverlayAvailable && nextRecipeShowCurrentResinOverlay\) \? "on" : "off";/);
});

test("the overlay reads the live recipe through its own accessor, not the page array", () => {
  const editor = recipeEditor();
  // currentRecipeLayers() is the one deliberate cross-reference: the plan is
  // compared against what is loaded now. It must not reach for recipeLayers()
  // (that is the Next working copy on this page).
  assert.match(app, /function currentRecipeLayers\(\)\{\s*\n\s*return state\.layers;/);
  assert.match(editor, /currentRecipeLayers\(\)\?\.\[li\]\?\.hoppers\?\.\[hi\]\?\.resinName/);
  assert.match(editor, /currentOverlay\.className = "splitCellCurrentResin"/);
});

test("the eye toggle flips the overlay without a re-render", () => {
  const editor = recipeEditor();
  // The corner (row-gutter) button replaces the "Select row" caption on Next.
  assert.match(editor, /overlayToggle\.className = "splitCurrentOverlayToggle"/);
  assert.match(editor, /corner\.appendChild\(overlayToggle\);/);
  assert.match(editor, /\} else \{\s*\n\s*corner\.textContent = summaryView \? "" : "Select row";/);
  // Click only flips the flag + the data attribute + the button state -
  // no renderSplitsArea() in the handler body, so the grid is never rebuilt.
  const clickHandler = editor.slice(
    editor.indexOf('overlayToggle.addEventListener("click"'),
    editor.indexOf("corner.appendChild(overlayToggle);")
  );
  assert.match(clickHandler, /nextRecipeShowCurrentResinOverlay = !nextRecipeShowCurrentResinOverlay;/);
  assert.match(clickHandler, /area\.dataset\.currentOverlay = nextRecipeShowCurrentResinOverlay \? "on" : "off";/);
  assert.doesNotMatch(clickHandler, /renderSplitsArea/);
});

test("overlay CSS: hidden until the toggle is on, and the eye icon swaps with it", () => {
  assert.match(styles, /\.splitCellCurrentResin\{[^}]*display:none;/);
  assert.match(styles, /#splitsArea\[data-current-overlay="on"\] \.splitCellCurrentResin\{display:flex\}/);
  assert.match(styles, /\.splitCurrentOverlayToggle \.eyeOpen\{display:none\}/);
  assert.match(styles, /\.splitCurrentOverlayToggle\.on \.eyeOpen\{display:block\}/);
  assert.match(styles, /\.splitCurrentOverlayToggle\.on \.eyeSlash\{display:none\}/);
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
  assert.match(body, /if \(activeRecipePage === "next"\) commitNextRecipeWorking\(\);/);
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
  // Bound on the next panel, not the first </details> - the summary bar's
  // #recipeInfoLegend is itself a nested <details> that closes before the tabs.
  const panel = html.slice(html.indexOf('id="splitsBlock"'), html.indexOf('id="resultsBlock"'));
  const tabsAt = panel.indexOf('class="recipePageTabs"');
  const gridAt = panel.indexOf('id="splitsArea"');
  assert.ok(tabsAt > -1 && gridAt > tabsAt, "the tab strip should sit immediately above the grid");
  // Sitting on the section's top divider rather than floating above it.
  assert.match(styles, /\.recipePageTabs\{[\s\S]*?margin: 0 0 -1px;/);
  assert.match(styles, /\.recipePageTabs\{[\s\S]*?border-bottom: 1px solid var\(--row-border\);/);
});

test("the tabs keep their own height whatever the grid does - 1, 3 or 5 layers", () => {
  // .blockBody is a grid; its default align-content:stretch shared spare panel
  // height between the tab row and the grid row, so the strip grew and shrank
  // with the recipe beside it. Both guards are kept: the rows pack to the top,
  // and the strip declines to stretch inside its own row.
  assert.match(styles, /#splitsBlock \.blockBody\{ align-content: start; \}/);
  assert.match(styles, /\.recipePageTabs\{[\s\S]*?align-self: start;/);
  // Nothing about the strip is expressed in terms of the grid's size.
  const strip = styles.slice(styles.indexOf(".recipePageTabs{"), styles.indexOf("}", styles.indexOf(".recipePageTabs{")));
  assert.doesNotMatch(strip, /width|height/);
});

test("Current, Next, and Recipe Book read as document tabs sitting on the section divider, not filled buttons", () => {
  const inactive = styles.slice(styles.indexOf(".recipePageTab{"), styles.indexOf("}", styles.indexOf(".recipePageTab{")));
  // Quiet at rest - a clickable label on the divider, not a bordered/filled
  // button. Rounded top corners only, so even the shape reads as a tab.
  assert.match(inactive, /border: 1px solid transparent;/);
  assert.match(inactive, /background: transparent;/);
  assert.match(inactive, /border-radius: var\(--control-radius\) var\(--control-radius\) 0 0;/);
  // Compact: the control is a page selector inside Recipe, not app navigation.
  assert.match(inactive, /min-height: 30px;/);
  const active = styles.slice(styles.indexOf(".recipePageTab.active{"), styles.indexOf("}", styles.indexOf(".recipePageTab.active{")));
  // "Grows out of the divider": real border in the panel's own border
  // colour, background matching the workspace content - not the filled
  // --btn-primary treatment app buttons use, so it never competes with them.
  assert.match(active, /border-color: var\(--row-border\);/);
  assert.match(active, /background: var\(--panel\);/);
  assert.match(active, /color: var\(--title\);/);
  assert.match(active, /font-weight: 900;/);
  // The seam that visually erases the divider under the active tab - exactly
  // the divider's own 1px width, painted in the content colour.
  assert.match(active, /box-shadow: 0 1px 0 0 var\(--panel\);/);
  // Restrained: no glow or animation was introduced.
  assert.doesNotMatch(active.replace(/\/\*[\s\S]*?\*\//g, ""), /animation|transform/);
});

test("mobile/tablet tabs share desktop's compact document-tab styling, not a separate boxed full-width treatment", () => {
  const anchor = styles.indexOf(".recipeWeightsTabFull{ display:none; }");
  const start = styles.lastIndexOf("@media", anchor);
  const block = styles.slice(start, styles.indexOf("\n}\n", anchor));
  assert.doesNotMatch(block, /\.recipePageTab\{[^}]*flex/);
  assert.doesNotMatch(block, /\.recipePageTab\.active\{/);
  // The label-shortening swap ("Hopper Weights" -> "Weights") is the only
  // thing this breakpoint still changes about the tabs.
  assert.match(block, /\.recipeWeightsTabFull\{ display:none; \}/);
  assert.match(block, /\.recipeWeightsTabCompact\{ display:inline; \}/);
});

test("the tabs use real tab semantics and are keyboard navigable", () => {
  assert.match(html, /class="recipePageTabs" role="tablist"/);
  assert.match(html, /id="recipePageTabCurrent" role="tab" aria-selected="true" aria-controls="splitsArea"/);
  assert.match(html, /id="recipePageTabNext" role="tab" aria-selected="false" aria-controls="splitsArea"/);
  assert.match(html, /id="recipePageTabSaved" role="tab" aria-selected="false" aria-controls="splitsArea" data-recipe-page="saved" hidden><span class="recipeTabLabel">Recipe Book<\/span>/);
  assert.match(html, /id="splitsArea"[^>]*role="tabpanel"/);
  const hook = app.slice(app.indexOf("function hookRecipePageTabs("));
  assert.match(hook, /ArrowRight/);
  assert.match(hook, /ArrowLeft/);
  // Roving tabindex: the strip is a single stop.
  assert.match(app, /tab\.tabIndex = selected \? 0 : -1;/);
  assert.match(styles, /\.recipePageTab:focus-visible\{[\s\S]*?outline: 2px solid var\(--focus-border\);/);
});

test("aria-selected, the panel label, and the view control follow every workspace page", () => {
  const body = app.slice(app.indexOf("function syncRecipePageUI("), app.indexOf("function setRecipePage("));
  assert.match(body, /tab\.setAttribute\("aria-selected", String\(selected\)\)/);
  assert.match(body, /const labelledBy = isSavedRecipesPage\(\)[\s\S]*?"recipePageTabSaved"[\s\S]*?isWeightsPage\(\)[\s\S]*?"recipePageTabWeights"[\s\S]*?"recipePageTabNext" : "recipePageTabCurrent"/);
  assert.match(body, /viewToggle\.hidden = isSavedRecipesPage\(\) \|\| isWeightsPage\(\);/);
  assert.match(body, /headerControls\.hidden = isSavedRecipesPage\(\);/);
});

test("Recipe Book is a real tab at every width, and crossing the phone/tablet boundary no longer bounces it back to Current", () => {
  const sync = app.slice(app.indexOf("function syncRecipePageUI("), app.indexOf("function setRecipePage("));
  assert.match(sync, /if \(savedTab\) savedTab\.hidden = false;/);
  const layout = app.slice(app.indexOf("function syncLayoutMode("), app.indexOf("function watchLayoutMode("));
  assert.doesNotMatch(layout, /activeRecipePage = "current";\s*\n\s*splitsSavedRecipesOpen = false;/);
  assert.match(styles, /\.recipePageTab\[hidden\],\.recipeViewToggle\[hidden\],\.recipeHeaderControls\[hidden\]\{ display:none!important; \}/);
  // The matrix-hiding swap is unconditional now; only the panel's own
  // sizing still forks by width.
  assert.match(styles, /body\[data-recipe-page="saved"\] #splitsArea > :not\(\.splitsSavedRecipesPanel\)\{\s*display: none!important;\s*\}/);
  assert.match(styles, /@media \(min-width: 701px\)\{[\s\S]*?body\[data-recipe-page="saved"\] #splitsArea > \.splitsSavedRecipesPanel\{[\s\S]*?width: min\(100%, var\(--recipe-five-layer-rail, 1062px\)\);/);
});

test("Recipe Book replaces the desktop matrix without masquerading as Current or Next", () => {
  assert.doesNotMatch(app, /lastRecipeDataPage/);
  assert.match(app, /function isNextRecipePage\(\)\{ return activeRecipePage === "next"; \}/);
  const setter = app.slice(app.indexOf("function setRecipePage("), app.indexOf("function hookRecipePageTabs("));
  assert.match(setter, /splitsSavedRecipesOpen = next === "saved";/);
  assert.match(styles, /body\[data-recipe-page="saved"\] #splitsArea > :not\(\.splitsSavedRecipesPanel\)\{\s*display: none!important;/);
  assert.match(styles, /body\[data-recipe-page="saved"\] #splitsArea > \.splitsSavedRecipesPanel\{[\s\S]*?display: block;[\s\S]*?order: 0;/);
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
  assert.match(styles, /body\[data-recipe-page="next"\] \.splitTrackControl\{ display: none; \}/);
  assert.match(app, /document\.body\.dataset\.recipePage = activeRecipePage;/);
});

test("no width/height rule anywhere reintroduces the old boxed, equal-width phone tab", () => {
  assert.doesNotMatch(styles, /flex: 1 1 0; min-height: 40px/);
});

test("no duplicated per-page action implementations were introduced", () => {
  for (const forbidden of [/currentRecipeBulkEdit/, /nextRecipeBulkEdit/, /nextRecipePrint/, /renderNextRecipeArea/]){
    assert.doesNotMatch(app, forbidden, `${forbidden} suggests a duplicated implementation`);
  }
});

/* ============================================================
 *   Phase 3: actions follow the selected page
 * ============================================================ */

test("one destination-aware entry point serves both Recipe Book and Scan", () => {
  assert.match(app, /function applyRecipeToActivePage\(payload,\{kind,lotByResin,destination\}=\{\}\)\{/);
  // Saved Recipes routes recipes through it (with no lot data of its own)...
  const saved = app.slice(app.indexOf("function applyWorkspaceConfiguration("), app.indexOf("function applyRecipeToActivePage("));
  assert.match(saved, /applyRecipeToActivePage\(item\.payload,\{kind:"load-workspace-configuration",destination\}\)/);
  // ...and so does Scan, threading through whatever a Heat Sheet scan read.
  const scan = app.slice(app.indexOf("function applyScannedRecipePayload("), app.indexOf("function openWorkspaceConfigurationDialog("));
  assert.match(scan, /function applyScannedRecipePayload\(payload, lotByResin\)\{/);
  assert.match(scan, /applyRecipeToActivePage\(payload, \{ kind:"apply-recipe-scan", lotByResin \}\)/);
});

test("writing a plan never publishes an active job or re-runs readiness", () => {
  const router = app.slice(app.indexOf("function applyRecipeToActivePage("), app.indexOf("function recipePageLabel("));
  const planBranch = router.slice(router.indexOf("const stored="));
  assert.doesNotMatch(planBranch, /notifyActiveJobMutation/, "a plan is not the running job");
  assert.doesNotMatch(planBranch, /validateAndCompute/, "a plan must not drive operational readiness");
  // The grid is rebuilt from the plan just stored, not the one it replaced.
  assert.match(planBranch, /nextRecipeWorking=null;\s*\n\s*ensureNextRecipeWorking\(\);/);
});

test("loading from Recipe Book offers explicit Current and Next destinations", () => {
  const preview = app.slice(app.indexOf("function previewWorkspaceConfiguration("), app.indexOf("function applyWorkspaceConfiguration("));
  assert.match(html, /id="workspaceConfigurationLoadCurrent" value="load-current"[^>]*hidden>Load into Current<\/button>/);
  assert.match(html, /id="workspaceConfigurationConfirmLoad" value="load-next"[^>]*>Load into Next<\/button>/);
  assert.match(preview, /loadCurrent\.hidden=!recipe;/);
  assert.match(preview, /dialog\.returnValue==="load-current"\) applyWorkspaceConfiguration\(item,"current"\)/);
  assert.match(preview, /dialog\.returnValue==="load-next"\) applyWorkspaceConfiguration\(item,"next"\)/);
  assert.doesNotMatch(preview, /isNextRecipePage/);
  const router = app.slice(app.indexOf("function applyRecipeToActivePage("), app.indexOf("function recipePageLabel("));
  assert.match(router, /const intoNext=destination \? destination==="next" : isNextRecipePage\(\);/);
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

test("planning issues keep their own voice, and never speak for the running recipe", () => {
  // Neither page prints its totals in the grid any more. The distinction moved
  // with them into the bell, where the plan has its own section, its own entry
  // ids and its own wording.
  const attention = fs.readFileSync("attention-center.js", "utf8");
  assert.match(attention, /nextRecipe: "Next Recipe"/);
  assert.match(attention, /"next-recipe\.layer-total"/);
  assert.match(attention, /"next-recipe\.hopper-totals"/);
  assert.match(attention, /The planned recipe is not finished/);
  // An unfinished plan is never an error, only ever an attention item.
  const planning = attention.slice(attention.indexOf("function nextRecipeEntries("), attention.indexOf("function timelineEntries("));
  assert.doesNotMatch(planning, /SEVERITY\.error/);
});

test("the plan's facts are read from the working copy, so the bell keeps up with live editing", () => {
  const hook = app.slice(app.indexOf("readNextRecipeFacts = function(){"), app.indexOf("/* ---- Load Next Recipe"));
  // The working copy first: state.nextRecipe is only rebuilt on save, so
  // reading it alone would report the previous keystroke's plan.
  assert.match(hook, /const layers = nextRecipeWorking\s*\n\s*\|\| \(window\.PolynNextRecipe\?\.normalize\(state\.nextRecipe\)/);
  // The same tolerance and the same comparison the running recipe uses.
  assert.match(hook, /Math\.abs\(layerTotal - 100\) <= 0\.0001/);
  assert.match(hook, /Math\.abs\(L\.totalPct - 100\) > 0\.0001/);
});

test("the plan is reported without the Next page ever having been opened", () => {
  // A plan restored from a session or arriving over RT Sync has no working
  // copy yet, so the durable payload is the fallback rather than a blank.
  const hook = app.slice(app.indexOf("readNextRecipeFacts = function(){"), app.indexOf("/* ---- Load Next Recipe"));
  assert.match(hook, /normalize\(state\.nextRecipe\)\?\.layers \|\| \[\]/);
});

test("a plan nobody has started is silent - the bell does not nag about an empty Next page", () => {
  const attention = fs.readFileSync("attention-center.js", "utf8");
  assert.match(attention, /if \(next\.planned !== true\) return \[\];/);
  // `planned` is the existing isMeaningful rule, not a second definition of
  // what counts as a plan.
  assert.match(app, /if \(!window\.PolynNextRecipe\?\.isMeaningful\(payload\)\)\{/);
});

test("the plan's readiness never touches the running recipe's readiness", () => {
  // The Recipe pill and the sidebar status are computed from state.layers in
  // updateCollapsedSummaries; nothing there reads the plan.
  const summaries = app.slice(app.indexOf('const splitsStatus = $("splitsSummaryStatus");'), app.indexOf('const timelineStatus = $("timelineSummaryStatus");'));
  assert.doesNotMatch(summaries, /nextRecipe|isNextRecipePage|recipeLayers/);
  assert.match(summaries, /const ready = errorCount === 0 && state\.layers\.length > 0;/);
});

test("Bulk Edit needed no per-page code - it already edits the selected page", () => {
  // Bulk Edit lives inside the editor and mutates the hopper objects it was
  // handed, so routing the editor through recipeLayers() covered it.
  const editor = recipeEditor();
  assert.ok(editor.includes("recipeLayers()"));
  assert.doesNotMatch(app, /bulkEditTarget|bulkApplyTo\(/);
});

/* ============================================================
 *   Phase 4: Load Next Recipe
 * ============================================================ */

function loadNextWiring(){
  const start = app.indexOf("function renderLoadNextRecipeSummary(");
  assert.notEqual(start, -1, "expected the Load Next Recipe wiring");
  return app.slice(start, app.indexOf("function syncRecipePageUI(", start));
}

test("Load Next Recipe is offered on Current only, and never on the plan itself", () => {
  const editor = recipeEditor();
  assert.match(editor, /if \(!isNextRecipePage\(\)\)\{[\s\S]*?loadNextRecipeBtn/);
});

test("the action is hidden with no plan and disabled until the plan is complete", () => {
  const editor = recipeEditor();
  assert.match(editor, /loadNextButton\.hidden = !planned;/);
  assert.match(editor, /loadNextButton\.disabled = !promotable;/);
  assert.match(editor, /const promotable = !!window\.PolynNextRecipe\?\.isPromotable\(state\.nextRecipe\);/);
  // Disabled rather than hidden, with a reason - the button explains itself.
  assert.match(editor, /percentages need to total 100%/);
});

test("promotion cannot be reached without confirmation", () => {
  const wiring = loadNextWiring();
  assert.match(wiring, /dialog\.showModal\(\)/);
  assert.match(wiring, /if \(dialog\.returnValue === "load"\) loadNextRecipeIntoCurrent\(\);/);
  // Guarded again at the dialog, not only by the button's disabled state.
  assert.match(wiring, /if \(!window\.PolynNextRecipe\?\.isPromotable\(state\.nextRecipe\)\) return;/);
  assert.match(html, /<dialog id="loadNextRecipeDialog"/);
  assert.match(html, /This replaces the current recipe with the planned Next Recipe\./);
  assert.match(html, /Line setup, receiver hopper weights, tracking, and pump-off state are not changed\./);
});

test("promotion reuses the saved-recipe apply, inheriting its documented semantics", () => {
  const wiring = loadNextWiring();
  // Not a bespoke copy loop: the same guarded call Saved Recipes makes, which
  // carries weight / track / pumpOff / Smart Hopper dimensions forward and
  // recalculates H1.
  assert.match(wiring, /window\.PolynWorkspaceConfigurationPayloads\?\.applyRecipePayload\(state, plan\)/);
  assert.doesNotMatch(wiring, /hopper\.weight\s*=|hopper\.track\s*=|hopper\.pumpOff\s*=/);
  assert.match(wiring, /notifyActiveJobMutation\(\{ immediate:true, kind:"load-next-recipe" \}\)/);
  assert.match(app, /"load-next-recipe": "Next Recipe loaded"/);
});

test("the plan survives promotion", () => {
  const wiring = loadNextWiring();
  assert.doesNotMatch(wiring, /state\.nextRecipe\s*=\s*null/, "loading must not destroy the plan");
  assert.match(wiring, /state\.nextRecipe is untouched by applyRecipePayload/);
});

test("the confirmation summarizes the scale of the change rather than diffing everything", () => {
  const wiring = loadNextWiring();
  assert.match(wiring, /summarizeChange\(\s*\n?\s*window\.PolynNextRecipe\.fromCurrent\(state\),\s*\n?\s*state\.nextRecipe/);
  assert.match(wiring, /resin change\$\{summary\.resinChanges === 1 \? "" : "s"\}/);
  assert.match(wiring, /percentage change\$\{summary\.percentageChanges === 1 \? "" : "s"\}/);
  // An identical plan says so instead of showing an empty summary.
  assert.match(wiring, /The planned recipe matches the current one/);
});

/* ============================================================
 *   Layer-count lock vs. an incoming recipe
 *
 *   Regression cover for the 2026-08-12 RT Sync write storm. A scanned
 *   heat sheet reaches applyRecipePayload, which assigns state.lineType
 *   straight from the payload - so a sheet from the wrong line could put a
 *   device permanently out of step with the layer count RT Sync derives for
 *   it, and renderLineSync's enforcement then fought the recipe forever.
 * ============================================================ */

function currentPageBranch(){
  const router = app.slice(app.indexOf("function applyRecipeToActivePage("), app.indexOf("function recipePageLabel("));
  return router.slice(0, router.indexOf("const stored=window.PolynNextRecipe"));
}

test("a recipe whose layer count disagrees with the locked line is refused, and changes nothing", () => {
  const branch = currentPageBranch();
  const guardAt = branch.indexOf("const required=derivedRequiredLayerCount();");
  const applyAt = branch.indexOf("applyRecipePayload(state,payload)");
  assert.ok(guardAt > -1, "expected the layer-count guard");
  assert.ok(guardAt < applyAt, "the guard must run before anything is applied");
  assert.match(branch, /if\(required!==null && Number\(payload\?\.line_type\)!==required\)\{\s*\n\s*return \{ ok:false, message:/);
});

test("the refusal says which layer counts disagree, rather than failing silently", () => {
  const branch = currentPageBranch();
  assert.match(branch, /This recipe is set up for \$\{payload\?\.line_type\} layers, but this line runs \$\{required\}\. Nothing was changed\./);
  // Scan surfaces the router's message rather than a generic one.
  const scan = app.slice(app.indexOf("function applyScannedRecipePayload("), app.indexOf("function openWorkspaceConfigurationDialog("));
  assert.match(scan, /result\.ok \? \{ ok:true \} : \{ ok:false, message: result\.message \|\| /);
});

test("an unlocked line still accepts any layer count - the guard is the RT Sync lock, not a new rule", () => {
  const branch = currentPageBranch();
  // required === null is precisely "no recognized line linked", the same
  // condition applyLayerCountLock uses to leave manual selection available.
  assert.match(branch, /required!==null &&/);
  assert.match(app, /function derivedRequiredLayerCount\(syncState = lineSync\?\.getState\?\.\(\)\)\{/);
});

test("the plan is unaffected - Next already conforms to the line's own structure", () => {
  const router = app.slice(app.indexOf("function applyRecipeToActivePage("), app.indexOf("function recipePageLabel("));
  const nextBranch = router.slice(router.indexOf("const stored=window.PolynNextRecipe"));
  assert.doesNotMatch(nextBranch, /derivedRequiredLayerCount/);
  // Next never writes state.lineType, so it cannot create the disagreement.
  assert.doesNotMatch(nextBranch, /state\.lineType\s*=/);
});

/* ============================================================
 *   Per-layer hopper running totals - restored, always rendered
 * ============================================================ */

test("the running total is created once per layer header, and updated at every mutation point that can change a hopper's percentage", () => {
  const editor = recipeEditor();
  assert.match(editor, /const hopperTotal = document\.createElement\("div"\);\s*\n\s*hopperTotal\.id = `hopperTotal_\$\{L\.name\}`;\s*\n\s*hopperTotal\.className = "splitColumnTotal";\s*\n\s*th\.appendChild\(hopperTotal\);/);
  // Layer % edit, hopper % edit, hopper Clear, and Bulk Edit Apply all call
  // it - the same four points the removed inline total used to update at.
  const callSites = editor.match(/updateHopperTotals\(\);/g) || [];
  assert.ok(callSites.length >= 5, `expected the initial render call plus 4 edit-path calls, saw ${callSites.length}`);
});

test("the initial render seeds real totals immediately - a freshly built table is never blank until the first edit", () => {
  const editor = recipeEditor();
  const fnStart = editor.indexOf("function updateHopperTotals(){");
  const setBulkModeAt = editor.indexOf("setBulkMode(bulkMode);");
  assert.ok(fnStart > -1 && setBulkModeAt > fnStart, "expected the function definition before the render's reapply step");
  const between = editor.slice(fnStart, setBulkModeAt);
  // The definition's closing brace is immediately followed by a bare,
  // unconditional call - the first render call, not just an edit-path one.
  assert.match(between, /\n\s*\}\n\s*updateHopperTotals\(\);\n/);
});

test("the total reads recipeLayers(), not state.layers directly - Current and Next each see their own totals", () => {
  const editor = recipeEditor();
  const fnStart = editor.indexOf("function updateHopperTotals(){");
  const fnBody = editor.slice(fnStart, editor.indexOf("updateHopperTotals();\n", fnStart));
  assert.match(fnBody, /recipeLayers\(\)\.forEach\(L=>\{/);
  assert.doesNotMatch(fnBody, /state\.layers/);
});
