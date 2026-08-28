"use strict";

// Timeline Hookup planning: a companion Hookups view on the Timeline where the
// physical silo/box-line source for each Current and Next resin is recorded,
// and those short labels appear inline on Timeline rows.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");
const activeJobSrc = fs.readFileSync("active-job.js", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  assert.notEqual(next, -1, `Expected a following function after ${name}`);
  return app.slice(start, next);
}

/* ----------------------------------------------------------------------
 *   1. Timeline / Hookups tabs
 * -------------------------------------------------------------------- */

test("two tabs sit above the row area, using the Recipe panel's tab language, defaulting to Timeline", () => {
  const bb = html.slice(html.indexOf('id="resultsBlock"'), html.indexOf('id="productionSummaryBlock"'));
  assert.match(bb, /<div class="timelineViewTabs" role="tablist"[^>]*aria-label="Timeline view">/);
  assert.match(bb, /class="timelineViewTab active" id="timelineViewTabTimeline"[^>]*aria-selected="true"[^>]*data-timeline-view="timeline">Timeline</);
  assert.match(bb, /class="timelineViewTab" id="timelineViewTabHookups"[^>]*aria-selected="false"[^>]*data-timeline-view="hookups">Hookups</);
  // The schedule and the Hookups area are siblings that get swapped in place -
  // no second permanent panel stacked above or below.
  assert.match(bb, /<div id="timelinePane">[\s\S]*<div id="resultsArea"[^>]*role="tabpanel"/);
  assert.match(bb, /<div id="timelineHookupsArea" class="timelineHookups" role="tabpanel"[^>]*hidden>/);
  // Same tab shape/divider treatment as .recipePageTab.
  assert.match(styles, /\.timelineViewTab\{[\s\S]*?border-radius:var\(--control-radius\) var\(--control-radius\) 0 0;[\s\S]*?\}/);
  assert.match(styles, /\.timelineViewTab\.active\{[\s\S]*?background:var\(--panel\);[\s\S]*?box-shadow:0 1px 0 0 var\(--panel\);/);
});

test("switching tabs swaps the two areas and never both show at once", () => {
  const body = functionBody("setTimelineView");
  assert.match(body, /if \(pane\) pane\.hidden = activeTimelineView !== "timeline";/);
  assert.match(body, /if \(hookups\) hookups\.hidden = activeTimelineView !== "hookups";/);
  assert.match(styles, /#timelinePane\[hidden\],#timelineHookupsArea\[hidden\]\{ display:none; \}/);
  // Not persisted: the Timeline always opens on the schedule.
  assert.match(app, /let activeTimelineView = "timeline";/);
});

test("the desktop panel grid is just tabs + active view, with the old row layout moved into #timelinePane", () => {
  assert.match(desktop, /#resultsBlock > \.blockBody\{display:grid;grid-template-rows:auto minmax\(0,1fr\);/);
  // Three children now (the "sorted by upcoming time" caption was folded into
  // the control bar's own context): control bar, mobile alarm fieldset, list.
  assert.match(desktop, /#timelinePane\{display:grid;grid-template-rows:auto auto minmax\(0,1fr\);/);
  assert.match(desktop, /#timelineHookupsArea\{min-height:0;overflow:auto;/);
});

/* ----------------------------------------------------------------------
 *   2. Hookups view - derived from the recipes, grouped by resin
 * -------------------------------------------------------------------- */

test("the Hookups view is derived from the Current and Next recipes - no manual add/remove rows", () => {
  const body = functionBody("renderTimelineHookups");
  assert.match(body, /hookupRecipePositions\(\)/);
  assert.match(body, /H\.groupByResin\(positions\.current/);
  assert.match(body, /H\.groupByResin\(positions\.next/);
  assert.match(body, /\[\["current", "CURRENT"\], \["next", "NEXT"\]\]/);
  assert.doesNotMatch(body, /addEventListener\("click".*[Aa]dd/);
  // Positions come from the live layers (Current) and the planned recipe (Next,
  // not gated on promotability - the operator is still entering it).
  const positions = functionBody("hookupRecipePositions");
  assert.match(positions, /current: H\.positionsFromLayers\(state\.layers\)/);
  assert.match(positions, /next: plan \? H\.positionsFromLayers\(plan\.layers\) : \[\]/);
});

test("the source input normalizes to uppercase, is compact, and persists on its own", () => {
  const body = functionBody("renderTimelineHookups");
  assert.match(body, /input\.setAttribute\("autocapitalize", "characters"\)/);
  assert.match(body, /input\.maxLength = H\.MAX_SOURCE_LENGTH/);
  assert.match(body, /input\.size = 6/);
  // No Save/Apply button - input persists, change syncs.
  assert.match(body, /input\.addEventListener\("input", \(\)=>\{\s*\n\s*persist\(\);/);
  assert.match(body, /input\.addEventListener\("change", \(\)=>\{\s*\n\s*persist\(\);\s*\n\s*validateAndCompute\(\{ sync: true, kind: "hookup-edit" \}\);/);
  assert.match(body, /H\.applyGroup\(\s*\n\s*state\.hookupSources, recipeKey, group\.keys, group\.resin, H\.normalizeSource\(input\.value\)\s*\n\s*\)/);
  assert.doesNotMatch(html.slice(html.indexOf('id="timelineHookupsArea"'), html.indexOf("</details>", html.indexOf('id="timelineHookupsArea"'))), /Save|Apply/);
  // Forced-uppercase display while typing, matching the stored normalization.
  assert.match(styles, /\.timelineHookupsRow > input\.timelineHookupsInput\{[\s\S]*?text-transform:uppercase;/);
});

test("a grouped resin with differing stored sources is shown as Mixed, not silently collapsed", () => {
  const body = functionBody("renderTimelineHookups");
  assert.match(body, /if \(group\.mixed\)\{/);
  assert.match(body, /input\.placeholder = "Mixed"/);
  assert.match(body, /input\.classList\.add\("timelineHookupsInputMixed"\)/);
  assert.match(styles, /\.timelineHookupsRow > input\.timelineHookupsInputMixed\{ border-bottom-color:var\(--warn\); \}/);
});

/* ----------------------------------------------------------------------
 *   3. Timeline row integration
 * -------------------------------------------------------------------- */

test("a source label rides just after its resin on the Timeline row, or is omitted entirely", () => {
  const render = app.slice(app.indexOf("function renderResultsFlat("), app.indexOf("function resetTracking"));
  // A dedicated chip slot right after the resin chip.
  assert.match(render, /<span data-resin-chip><\/span>\s*\n\s*<span data-source-chip><\/span>/);
  // Only drawn when a (resin-guarded) source exists; no ?/dash/empty pill.
  assert.match(render, /const currentSource = \(sourceMode !== "hide" && h\.resinName && HS\)\s*\n\s*\? HS\.sourceForPosition\(currentSources, posKey, h\.resinName\)\s*\n\s*: "";/);
  assert.match(render, /if \(currentSource\)\{\s*\n\s*sourceChip\.className = "resultSourceBadge";\s*\n\s*sourceChip\.textContent = currentSource;/);
  // The badge is quieter and smaller than the teal hopper badge.
  assert.match(styles, /\.resultSourceBadge\{[\s\S]*?font-size:9px;[\s\S]*?color:var\(--muted\);[\s\S]*?\}/);
  assert.match(styles, /\.resultHopper\{[^}]*font-size:16px/);
});

test("a Next source is only drawn under Current + Next, and never when the Next resin is hidden", () => {
  const render = app.slice(app.indexOf("function renderResultsFlat("), app.indexOf("function resetTracking"));
  assert.match(render, /const nextSource = \(sourceMode === "current-next" && incoming && HS\)/);
  // sourceMode is the *effective* mode, which degrades current-next -> current
  // whenever the Next resin is off.
  const eff = functionBody("effectiveSourceLabelMode");
  assert.match(eff, /if \(mode === "current-next" && !state\.timelineNextResin\) return "current";/);
  assert.match(render, /const sourceMode = effectiveSourceLabelMode\(\);/);
});

test("resin names still never reach the DOM through a template literal", () => {
  // security.test.js enforces this globally; assert the hookup additions keep it.
  const render = app.slice(app.indexOf("function renderResultsFlat("), app.indexOf("function resetTracking"));
  assert.match(render, /sourceChip\.title = "Hookup source for " \+ h\.resinName \+ ": " \+ currentSource;/);
  assert.doesNotMatch(render, /`[^`]*\$\{h\.resinName\}[^`]*`/);
});

/* ----------------------------------------------------------------------
 *   4. Timeline display settings
 * -------------------------------------------------------------------- */

test("Show all stays put; Enhanced tracking is replaced by a gear that opens a display sheet", () => {
  const controls = html.slice(html.indexOf('id="timelineControlsRow"'), html.indexOf('id="resultsArea"'));
  assert.match(controls, /<span class="trackLabel">Show all<\/span>/);
  assert.match(controls, /id="showPumpOffToggle"/);
  assert.match(controls, /id="resetTrackingBtn"/);
  assert.match(controls, /id="timelineDisplayToggle"[\s\S]*?aria-haspopup="dialog"[\s\S]*?aria-controls="timelineDisplaySheet"/);
  assert.doesNotMatch(controls, /timelineNextResinToggle|Enhanced tracking/);
  // The gear reuses the shared footer-sheet system (tap-off / Escape / backdrop).
  assert.match(app, /timelineDisplay: \[\$\("timelineDisplayToggle"\), \$\("timelineDisplaySheet"\)\]/);
  assert.match(app, /setFooterSheetOpen\("timelineDisplay", true, event\.currentTarget\)/);
  assert.match(app, /function isDesktopPopover\(name = activeFooterSheetName\)\{\s*\n\s*return isDesktopLayout\(\) && \(name === "notifications" \|\| name === "timelineDisplay"\);/);
});

test("the sheet offers exactly Next resin (Show/Hide) and Source labels (Hide/Current/Current + Next)", () => {
  const sheet = html.slice(html.indexOf('id="timelineDisplaySheet"'), html.indexOf("</dialog>", html.indexOf('id="timelineDisplaySheet"')));
  assert.match(sheet, /id="timelineNextResinChoice"[^>]*role="radiogroup"/);
  assert.match(sheet, /data-timeline-next-resin="show">Show</);
  assert.match(sheet, /data-timeline-next-resin="hide">Hide</);
  assert.match(sheet, /id="timelineSourceLabelsChoice"[^>]*role="radiogroup"/);
  assert.match(sheet, /data-timeline-source-labels="hide">Hide</);
  assert.match(sheet, /data-timeline-source-labels="current">Current</);
  assert.match(sheet, /data-timeline-source-labels="current-next">Current \+ Next</);
  // Not four overlapping Current/Next toggles.
  assert.doesNotMatch(sheet, /Current resin/);
});

test("with Next resin hidden, the Current + Next option is disabled and explained", () => {
  const body = functionBody("applyTimelineDisplayPrefs");
  assert.match(body, /const isNextOption = btn\.dataset\.timelineSourceLabels === "current-next";/);
  assert.match(body, /btn\.disabled = isNextOption && !nextShown;/);
  assert.match(body, /const explain = state\.timelineSourceLabels === "current-next" && !nextShown;/);
  assert.match(body, /note\.hidden = !explain;/);
  const sheet = html.slice(html.indexOf('id="timelineDisplaySheet"'), html.indexOf("</dialog>", html.indexOf('id="timelineDisplaySheet"')));
  assert.match(sheet, /id="timelineSourceLabelsNote"[^>]*hidden>Next source needs Next resin shown\./);
});

test("initial settings preserve today's behaviour: Next resin keeps its stored value, source labels start hidden", () => {
  assert.match(app, /timelineNextResin: false,/);
  assert.match(app, /timelineSourceLabels: "hide",/);
  // Both are per-device display preferences (like showPumpOffTracked): carried
  // in the payload for reload, held back when a shared job is applied.
  const local = app.slice(app.indexOf("function applySharedActiveJob(payload){"), app.indexOf("blocksOpen: snapshotPayload().blocksOpen"));
  assert.match(local, /timelineNextResin: state\.timelineNextResin,/);
  assert.match(local, /timelineSourceLabels: state\.timelineSourceLabels,/);
  assert.match(app, /state\.timelineSourceLabels = normalizeSourceLabelsPref\(payload\.timelineSourceLabels\);/);
  assert.match(app, /timelineSourceLabels: normalizeSourceLabelsPref\(state\.timelineSourceLabels\),/);
});

/* ----------------------------------------------------------------------
 *   5. Persistence, recipe changes and RT Sync
 * -------------------------------------------------------------------- */

test("hookupSources travels with the active job like resinLots - additive, active-job version unchanged", () => {
  assert.match(activeJobSrc, /"nextRecipeLots",\s*\n\s*\/\/[\s\S]*?"hookupSources",/);
  assert.match(activeJobSrc, /hookupSources: state\.hookupSources \?\? \{ current: \{\}, next: \{\} \}/);
  // The plan's own additive-field note keeps the version at 0.17; do not bump.
  const validation = fs.readFileSync("validation.js", "utf8");
  assert.match(validation, /SUPPORTED_ACTIVE_JOB_VERSIONS = Object\.freeze\(\["0\.17"\]\)/);
});

test("hookupSources is operational job state - it comes from the shared payload, not held back as a local preference", () => {
  const local = app.slice(app.indexOf("function applySharedActiveJob(payload){"), app.indexOf("blocksOpen: snapshotPayload().blocksOpen"));
  assert.doesNotMatch(local, /^\s*hookupSources:/m);
  // Restored (and sanitized) from the payload in applyPayload.
  assert.match(app, /state\.hookupSources = window\.PolynHookupSources\?\.normalizeStore\(payload\.hookupSources\) \|\| \{ current: \{\}, next: \{\} \};/);
  assert.match(app, /hookupSources: window\.PolynHookupSources\?\.normalizeStore\(state\.hookupSources\) \|\| \{ current: \{\}, next: \{\} \}/);
});

test("stale labels are pruned against the recipes on every recompute, before anything reads them", () => {
  const compute = app.slice(app.indexOf("function validateAndCompute("), app.indexOf("function refreshTimelinePresentation"));
  assert.match(compute, /reconcileHookupSources\(\);\s*\n\s*renderResultsFlat\(flat, changeoverDate\);\s*\n\s*renderTimelineHookups\(\);/);
  const body = functionBody("reconcileHookupSources");
  assert.match(body, /const \{ store, changed \} = H\.reconcile\(state\.hookupSources, hookupRecipePositions\(\)\);/);
  assert.match(body, /state\.hookupSources = store;/);
});

test("resetAll clears the Current side and leaves the Next plan's labels alone", () => {
  const start = app.indexOf("function resetAll(");
  const body = app.slice(start, app.indexOf("rebuildUIFromState();", start));
  assert.match(body, /state\.timelineSourceLabels = "hide";/);
  assert.match(body, /state\.hookupSources = \{ current: \{\}, next: window\.PolynHookupSources\?\.normalizeStore\(state\.hookupSources\)\.next \|\| \{\} \};/);
});

test("editing an unrelated field does not touch hookup labels - persistence is via snapshotPayload only", () => {
  // hookupSources is written only by applyGroup (deliberate edit) and pruned by
  // reconcile; it is otherwise just carried through snapshot/apply.
  assert.match(app, /hookupSources: window\.PolynHookupSources\?\.normalizeStore\(state\.hookupSources\)/); // snapshotPayload
  const editHandlers = app.match(/state\.hookupSources\s*=/g) || [];
  // init, snapshot(no - that's a read), applyPayload, resetAll, reconcile, applyGroup calls in render.
  assert.ok(editHandlers.length <= 6, `hookupSources is assigned in ${editHandlers.length} places - expected a small, well-known set`);
});

/* ----------------------------------------------------------------------
 *   6. Responsive
 * -------------------------------------------------------------------- */

test("Hookups is mobile-first: stacked single column by default, two columns from 701px", () => {
  assert.match(styles, /\.timelineHookupsBoard\{\s*\n\s*display:grid;\s*\n\s*grid-template-columns:minmax\(0,1fr\);/);
  assert.match(styles, /@media \(min-width:701px\)\{\s*\n\s*\.timelineHookupsBoard\{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/);
  // Glove-friendly inputs on phones, tighter on wide.
  assert.match(styles, /\.timelineHookupsRow\{[\s\S]*?min-height:44px;/);
  assert.match(styles, /@media \(min-width:701px\)\{[\s\S]*?\.timelineHookupsRow\{ min-height:34px;/);
});

test("Timeline rows never gain fixed width from a source badge - it shrinks and ellipsizes", () => {
  assert.match(styles, /\.resultSourceBadge\{[\s\S]*?flex:0 1 auto;[\s\S]*?max-width:8ch;[\s\S]*?text-overflow:ellipsis;/);
  // The row identity keeps its existing nowrap + ellipsizing resin behaviour.
  assert.match(styles, /\.resultIdentity\{display:flex;align-items:baseline;gap:5px;min-width:0;flex-wrap:nowrap\}/);
});
