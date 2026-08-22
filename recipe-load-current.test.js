"use strict";

// Load Current Recipe: the mirror of Load Next Recipe, on the Next page.
//
// Planning a changeover almost always starts from what is running - the next
// run is the current one with two or three hoppers different - so a blank
// Next grid meant retyping a recipe that was already on screen. This copies
// Current into the plan in one confirmed step.
//
// The direction matters for what can travel. Promotion (Next -> Current) goes
// through applyRecipePayload and has to carry weight/track/pumpOff forward
// from the hopper already in position. This direction has no such problem: a
// recipe payload structurally cannot hold operational or physical state (see
// next-recipe.js), so a plan seeded from Current is still only a plan.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

function recipeEditor(){
  const start = app.indexOf("    function renderSplitsArea(){");
  const end = app.indexOf("    function renderResinCalculator(){", start);
  assert.ok(start > -1 && end > start, "expected renderSplitsArea");
  return app.slice(start, end);
}

function loadCurrentWiring(){
  const start = app.indexOf("function openLoadCurrentRecipeDialog(){");
  assert.notEqual(start, -1, "expected the Load Current Recipe wiring");
  return app.slice(start, app.indexOf("function syncRecipePageUI(", start));
}

/* ----------------------------------------------------------------------
 *   Where it is offered
 * -------------------------------------------------------------------- */

test("it is offered on Next only - the exact inverse of Load Next Recipe", () => {
  const editor = recipeEditor();
  assert.match(editor, /if \(isNextRecipePage\(\)\)\{[\s\S]*?loadCurrentRecipeBtn/);
  // Its counterpart stays Current-only, so the two never appear together.
  assert.match(editor, /if \(!isNextRecipePage\(\)\)\{[\s\S]*?loadNextRecipeBtn/);
});

test("it is hidden when the current recipe holds nothing worth copying, and never merely disabled-with-an-excuse", () => {
  const editor = recipeEditor();
  assert.match(editor, /loadCurrentButton\.hidden = !window\.PolynNextRecipe\?\.isMeaningful\(window\.PolynNextRecipe\?\.fromCurrent\(state\)\);/);
  // Unlike Load Next Recipe there is no completeness gate: a plan does not
  // have to validate, so a half-finished current recipe is still copyable.
  const block = editor.slice(editor.indexOf("loadCurrentButton = document.createElement"));
  assert.doesNotMatch(block.slice(0, block.indexOf("modeBar.appendChild(loadCurrentButton)")), /isPromotable/);
});

test("desktop puts it in the utility strip where Load Next Recipe sits on the other page", () => {
  const editor = recipeEditor();
  assert.match(editor, /loadCurrentButton\?\.classList\.add\("recipeUtilityTab", "recipeActionTab"\);/);
  assert.match(editor, /if \(loadCurrentButton\) recipeUtilityTabs\.append\(loadCurrentButton\);/);
  // An immediate action, not a panel-opening tab - same as Load Next/Print.
  assert.doesNotMatch(editor, /loadCurrentButton\?\.setAttribute\("role", "tab"\)/);
});

test("mobile puts it in the overflow rather than a sixth slot in a four-slot row", () => {
  const editor = recipeEditor();
  // Next's primary row is already Recipes / Rearrange / Scan / More.
  assert.match(editor, /\$\{isNextRecipePage\(\) \? `<button type="button" data-mobile-recipe-load-current>Load current recipe<\/button>` : ""\}/);
  assert.match(editor, /mobileLoadCurrentButton\.addEventListener\("click",\(\)=>\{mobileMoreButton\.open=false;openLoadCurrentRecipeDialog\(\);\}\);/);
  // The overflow entry inherits the button's own availability rather than
  // deciding it a second time and drifting.
  assert.match(editor, /mobileLoadCurrentButton\.disabled=!!loadCurrentButton\?\.hidden;/);
});

/* ----------------------------------------------------------------------
 *   Confirmation
 * -------------------------------------------------------------------- */

test("it cannot overwrite a plan without confirmation, and the dialog says the line is untouched", () => {
  const wiring = loadCurrentWiring();
  assert.match(wiring, /dialog\.showModal\(\)/);
  assert.match(wiring, /if \(dialog\.returnValue === "load"\) loadCurrentRecipeIntoNext\(\);/);
  // Guarded again at the dialog, not only by the button's hidden state.
  assert.match(wiring, /if \(!window\.PolynNextRecipe\?\.isMeaningful\(current\)\) return;/);
  assert.match(html, /<dialog id="loadCurrentRecipeDialog"/);
  assert.match(html, /This replaces the planned Next Recipe with a copy of the current one/);
  assert.match(html, /the current recipe, receiver hopper weights, tracking, and pump-off state are untouched/);
});

test("the preview is summarized in the direction the copy runs - from the plan, to the current recipe", () => {
  const wiring = loadCurrentWiring();
  // summarizeChange(before, after). Reversing these would describe the copy
  // backwards and show the operator the wrong percentages.
  assert.match(wiring, /summarizeChange\(state\.nextRecipe, current\)/);
  // The same renderer Load Next Recipe uses - it describes a before/after
  // pair, not a fixed page.
  assert.match(wiring, /renderLoadNextRecipeSummary\(\$\("loadCurrentRecipeSummary"\), summary\)/);
});

/* ----------------------------------------------------------------------
 *   What actually moves
 * -------------------------------------------------------------------- */

test("only a recipe payload crosses over, and the live recipe is never written", () => {
  const wiring = loadCurrentWiring();
  assert.match(wiring, /const plan = window\.PolynNextRecipe\?\.normalize\(window\.PolynNextRecipe\?\.fromCurrent\(state\)\);/);
  assert.match(wiring, /state\.nextRecipe = plan;/);
  // Nothing here assigns to state.layers or to any operational hopper field.
  assert.doesNotMatch(wiring, /state\.layers\s*=/);
  assert.doesNotMatch(wiring, /hopper\.weight\s*=|hopper\.track\s*=|hopper\.pumpOff\s*=/);
  assert.doesNotMatch(wiring, /applyRecipePayload/);
});

test("the working copy is dropped so the grid rebuilds from the payload just written", () => {
  const wiring = loadCurrentWiring();
  // ensureNextRecipeWorking() prefers an existing working copy over stored
  // state, so without this the operator would confirm and see no change.
  assert.match(wiring, /nextRecipeWorking = null;/);
  const order = wiring.indexOf("nextRecipeWorking = null;");
  assert.ok(order > wiring.indexOf("state.nextRecipe = plan;"), "the payload must be written before the working copy is dropped");
  assert.ok(order < wiring.indexOf("renderSplitsArea();"), "the working copy must be dropped before the grid re-renders");
});

test("scanned lots follow the resins, mirroring what promotion does in the other direction", () => {
  const wiring = loadCurrentWiring();
  assert.match(wiring, /state\.nextRecipeLots = \{ \.\.\.\(state\.resinLots \|\| \{\}\) \};/);
  // Promotion's own line, unchanged - the two are mirror images.
  assert.match(app, /state\.resinLots = \{ \.\.\.\(state\.nextRecipeLots \|\| \{\}\) \};/);
  // Copied, not aliased: the plan's lots must not be the same object the
  // live recipe keeps editing.
  assert.doesNotMatch(wiring, /state\.nextRecipeLots = state\.resinLots/);
});

test("it persists, re-validates and syncs under a kind the pending list can name", () => {
  const wiring = loadCurrentWiring();
  assert.match(wiring, /saveSession\(\);/);
  // The operational recipe did not change, so this is only for the bell's
  // view of the plan (attentionFacts.nextRecipe) - deliberately not sync:true.
  assert.match(wiring, /\n      validateAndCompute\(\);/);
  assert.match(wiring, /notifyActiveJobMutation\(\{ immediate:true, kind:"load-current-recipe" \}\);/);
  assert.match(app, /"load-current-recipe": "Current Recipe copied to Next",/);
});
