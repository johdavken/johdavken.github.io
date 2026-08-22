"use strict";

// Enhanced tracking: each tracked Timeline row shows the resin the planned
// Next Recipe puts in that hopper, so a changeover can be read off the
// Timeline instead of by flipping between Current and Next.
//
//   (B2)  A0301 -> A1901
//
// Only positions the plan actually changes are marked. An unmarked row means
// "nothing to swap here", which is what makes the marked ones worth scanning.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  assert.notEqual(next, -1, `Expected a following function after ${name}`);
  return app.slice(start, next);
}

/* ----------------------------------------------------------------------
 *   When the plan is allowed to be shown
 * -------------------------------------------------------------------- */

test("nothing is shown unless the plan passes full recipe validation", () => {
  const body = functionBody("nextResinByPosition");
  // isMeaningful is not enough: a half-entered plan would advertise an
  // incoming resin for a changeover that cannot actually be run.
  assert.match(body, /if \(!window\.PolynNextRecipe\?\.isPromotable\(plan\)\) return null;/);
  assert.match(body, /if \(!state\.timelineNextResin\) return null;/);
});

test("a plan built for a different line is never mapped onto this one", () => {
  const body = functionBody("nextResinByPosition");
  // Layer names come from the line type, so a plan for another line means
  // different positions - the lookups would miss, or land on a same-named
  // layer that means something else.
  assert.match(body, /if \(Number\(plan\.line_type\) !== Number\(state\.lineType\)\) return null;/);
  assert.match(body, /const liveLayers = new Set\(state\.layers\.map\(layer=>layer\.name\)\);/);
  assert.match(body, /if \(!plan\.layers\.every\(layer=>liveLayers\.has\(layer\.name\)\)\) return null;/);
});

test("positions are matched by physical slot, not by printed label", () => {
  // Hopper naming mode (1-6 vs Main+1-5) changes hopperLabel but not the
  // slot, so keying on the label would break on Line 9.
  const body = functionBody("nextResinByPosition");
  assert.match(body, /byPosition\.set\(`\$\{layer\.name\}:\$\{index\}`/);
  assert.match(app, /hopperIndex: hi,/);
  const render = app.slice(app.indexOf("function renderResultsFlat("));
  assert.match(render, /nextResins\?\.get\(`\$\{h\.layer\}:\$\{h\.hopperIndex\}`\)/);
});

/* ----------------------------------------------------------------------
 *   What lands on the row
 * -------------------------------------------------------------------- */

test("only changed positions are marked - an unchanged hopper gets nothing", () => {
  const render = app.slice(app.indexOf("function renderResultsFlat("));
  assert.match(render, /if \(incoming !== undefined && incoming !== h\.resinName\)\{/);
  // undefined (position absent from the plan) and an equal name both fall
  // through to no chip at all.
});

test("a hopper the plan empties reads as an absence, not as a resin code", () => {
  const render = app.slice(app.indexOf("function renderResultsFlat("));
  assert.match(render, /name\.textContent = incoming \|\| "Empty";/);
  assert.match(render, /"resultNextResin" \+ \(incoming \? "" : " resultNextResinEmpty"\)/);
  assert.match(styles, /\.resultNextResinEmpty\{color:var\(--muted\);font-style:italic\}/);
});

test("the arrow is decorative and the accessible name says what the pair means", () => {
  const render = app.slice(app.indexOf("function renderResultsFlat("));
  assert.match(render, /arrow\.setAttribute\("aria-hidden", "true"\);/);
  assert.match(render, /nextChip\.setAttribute\("aria-label", nextChip\.title\);/);
});

/* ----------------------------------------------------------------------
 *   The control
 * -------------------------------------------------------------------- */

test("the toggle sits with Reset tracking and is labelled for assistive tech", () => {
  const controls = html.slice(html.indexOf('class="trackWrap resultsToggleControls"'), html.indexOf('id="resetTrackingBtn"'));
  assert.match(controls, /id="timelineNextResinToggle"/);
  assert.match(controls, /role="switch"/);
  assert.match(controls, /aria-labelledby="timelineNextResinLabel"/);
  assert.match(html, /<span class="trackLabel" id="timelineNextResinLabel">Enhanced tracking<\/span>/);
  assert.match(app, /hookToggle\(\s*\n\s*"timelineNextResinToggle",/);
});

test("it stays operable while unavailable, and says which condition it is waiting on", () => {
  const reason = functionBody("enhancedTrackingUnavailableReason");
  assert.match(reason, /No Next Recipe is planned yet\./);
  assert.match(reason, /is for a different line type\./);
  assert.match(reason, /isn't complete yet/);
  // Dimmed, not disabled: switching it on before the plan is finished is
  // reasonable, and it then lights up on its own.
  assert.match(styles, /\.toggle\.toggleUnavailable\{ opacity:\.5; \}/);
  const sync = functionBody("syncEnhancedTrackingAvailability");
  assert.doesNotMatch(sync, /\.disabled\s*=/);
  // The reason is only spoken aloud when the operator asked for the feature
  // and is getting nothing back.
  assert.match(sync, /const explain = state\.timelineNextResin && reason;/);
});

test("availability is re-evaluated on every Timeline render, not only when the toggle is touched", () => {
  assert.match(app, /function renderResultsFlat\(flat, changeoverDate\)\{\s*\n\s*syncEnhancedTrackingAvailability\(\);/);
});

// Caught in the browser, not by reading the code: editing the plan left the
// Timeline showing the previous edit's resins. state.nextRecipe is only
// rebuilt by commitNextRecipeWorking() inside snapshotPayload(), which runs
// during saveSession() - and validateAndCompute() calls renderResultsFlat()
// *before* saveSession(). Reading the durable payload therefore renders the
// plan as it was one edit ago, which is worse than rendering nothing.
test("the plan is read from the live working copy, never from the payload that lags a save behind", () => {
  const body = functionBody("plannedRecipePayload");
  assert.match(body, /nextRecipeWorking\s*\n?\s*\?/, "the working copy must be preferred when one exists");
  assert.match(body, /: state\.nextRecipe;/, "and the durable payload used only as the fallback");
  // Both the badges and the reason go through it, so they cannot disagree.
  assert.match(functionBody("nextResinByPosition"), /const plan = plannedRecipePayload\(\);/);
  assert.match(functionBody("enhancedTrackingUnavailableReason"), /const plan = plannedRecipePayload\(\);/);
  // Reading state.nextRecipe directly in either is the regression.
  assert.doesNotMatch(functionBody("nextResinByPosition"), /normalize\(state\.nextRecipe\)/);
  assert.doesNotMatch(functionBody("enhancedTrackingUnavailableReason"), /normalize\(state\.nextRecipe\)/);
});

/* ----------------------------------------------------------------------
 *   It is a per-device display choice
 * -------------------------------------------------------------------- */

test("another device's Timeline display choice is never applied over this one", () => {
  // Same treatment showPumpOffTracked gets: carried in the payload so it
  // survives a reload, but held back when a shared active job is applied.
  const local = app.slice(app.indexOf("function applySharedActiveJob(payload){"), app.indexOf("blocksOpen: snapshotPayload().blocksOpen"));
  assert.match(local, /timelineNextResin: state\.timelineNextResin,/);
  assert.match(app, /timelineNextResin: !!state\.timelineNextResin,/);
  assert.match(app, /state\.timelineNextResin = !!payload\.timelineNextResin;/);
});
