const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

/* Weight Profiles folded into the Recipe Book.
 *
 * Both saved configuration types are rows in public.workspace_configurations
 * and share every action (create/load/update/rename/duplicate/delete), so the
 * Recipe Book holds both rather than each type living next to the grid it
 * happens to change. The Weights page keeps only its grid and bulk bar.
 *
 * The block that moves is the real #setupWeightProfilesBlock element from
 * index.html - moved, never cloned - so its element IDs and its wiring in
 * wireSetupWeightProfileActions keep a single owner.
 */
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `expected ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

test("the Recipe Book panel adopts the shared profiles block itself, rather than rebuilding a second copy of it", () => {
  const body = functionBody("renderSplitsArea");
  assert.match(body, /if \(reworkedGrid && profilesBlock\)\{/);
  assert.match(body, /savedRecipesPanel\.append\(profilesBlock\);/);
  // Moved, not cloned: a duplicate would give every #setup* profile button
  // two elements for one ID and silently break wireSetupWeightProfileActions.
  assert.doesNotMatch(body, /profilesBlock\.cloneNode/);
  // Still one element in the markup, still owned by Line Setup at rest.
  assert.equal(html.split('id="setupWeightProfilesBlock"').length - 1, 1);
});

test("the block is rescued out of #splitsArea before the render clears it, or the move would destroy it", () => {
  const body = functionBody("renderSplitsArea");
  const rescue = body.indexOf("if (profilesBlock && area.contains(profilesBlock)) weightsBlock?.after(profilesBlock);");
  const clear = body.indexOf('area.innerHTML = "";');
  assert.notEqual(rescue, -1, "expected the pre-clear rescue");
  assert.notEqual(clear, -1, "expected the area clear");
  // Order is the whole point: area.innerHTML = "" would otherwise delete the
  // one real element every profile action is wired to.
  assert.ok(rescue < clear, "the rescue must run before the area is cleared");
});

test("placeSetupWeightProfiles stands down while the Recipe Book owns the block", () => {
  const body = functionBody("placeSetupWeightProfiles");
  assert.match(body, /if \(isSavedRecipesPage\(\)\) return;/);
  // Every other page still returns it to its stable Setup home.
  assert.match(body, /if \(profilesBlock\.parentElement !== setupSection\) weightsBlock\.after\(profilesBlock\);/);
});

test("the Weights page keeps no Weight Profiles affordance of its own", () => {
  const body = functionBody("renderWeightsArea");
  assert.doesNotMatch(body, /desktopWeightsActionToolbar/);
  assert.doesNotMatch(body, /profilesAction/);
  assert.doesNotMatch(body, /area\.appendChild\(profilesPanel\)/);
  // The grid and its selection-raised bulk bar are what is left.
  assert.match(body, /area\.appendChild\(scroll\);/);
  assert.match(body, /area\.appendChild\(toolbar\);/);
});

test("inside the Book the block is a section, not a disclosure - its summary chrome stands down", () => {
  const body = functionBody("renderSplitsArea");
  assert.match(body, /profilesBlock\.classList\.add\("savedRecipesProfilesSection"\);/);
  assert.match(body, /profilesBlock\.open = true;/);
  assert.match(body, /profilesBlock\.hidden = false;/);
  assert.match(styles, /\.splitsSavedRecipesPanel \.savedRecipesProfilesSection > summary\{\s*\n?\s*display:none;/);
});

test("compact mobile is untouched - it keeps the profiles sheet and never folds the block into the Book", () => {
  const body = functionBody("renderSplitsArea");
  // Guarded on reworkedGrid, so the phone keeps renderMobileWeightProfileRows
  // and its own bottom sheet.
  assert.match(body, /if \(reworkedGrid && profilesBlock\)\{/);
  assert.match(app, /function renderMobileWeightProfileRows\(/);
  assert.match(app, /ensureMobileWeightProfilesSheet\(/);
});

/* Tracking on the reworked grid.
 *
 * The stacked grid hides the per-cell clock outright
 * (#splitsArea[data-recipe-view] .splitTrackControl{display:none}) because
 * tracking there is a Summary-view action done by clicking the whole cell,
 * while selection is an Edit-view one. The reworked grid has no modes: a cell
 * click selects, so tracking needs its own target back or there is no way to
 * track at all.
 */
test("the reworked grid restores a per-cell tracking control, since a cell click now selects instead", () => {
  // The rule it has to beat is #splitsArea[data-recipe-view] .splitTrackControl,
  // so the override carries enough specificity to win.
  assert.match(styles, /body:not\(\[data-recipe-page="next"\]\) #splitsArea\[data-recipe-layout="transposed"\] \.splitTrackControl\{[\s\S]*?display:inline-flex;/);
  // Visible at rest, not hover-revealed - an operator on the floor will not
  // discover a control that only appears under the cursor.
  assert.match(styles, /body #splitsArea\[data-recipe-layout="transposed"\] \.splitTrackButton\{[\s\S]*?opacity:1;/);
});

test("Next still carries no tracking control at all - the plan structurally cannot hold tracking", () => {
  // The override is scoped away from the Next page, so the established
  // body[data-recipe-page="next"] .splitTrackControl{display:none} still wins
  // there by being the only rule that applies.
  assert.match(styles, /body\[data-recipe-page="next"\] \.splitTrackControl\{ display: none; \}/);
  assert.doesNotMatch(styles, /body #splitsArea\[data-recipe-layout="transposed"\] \.splitTrackControl\{/);
});

test("the track button stays live on the reworked grid instead of standing down for bulk mode", () => {
  const setBulkModeStart = app.indexOf("function setBulkMode(enabled){");
  const body = app.slice(setBulkModeStart, app.indexOf("\n      }", setBulkModeStart));
  assert.match(body, /trackButton\.disabled = reworkedGrid \? rearranging : \(bulkMode \|\| rearranging\);/);
});

test("the interaction hint names both actions, since the grid does both at once", () => {
  assert.match(app, /"select · click its dot to track"/);
});

/* The per-layer hopper Total readout, and the --ok bar above it.
 *
 * Hopper 1 is derived (recomputeAutoH1: h1 = 100 - sum(H2..H6), clamped), and
 * every write path that could push H2-H6 past 100 refuses before writing, so
 * the total is 100 by construction and the readout only ever repeats it back.
 * Mobile already dropped it for this reason; the reworked grid follows.
 */
test("the layer Total readout is hidden on the reworked grid - the total is 100 by construction", () => {
  assert.match(styles, /body #splitsArea\[data-recipe-layout="transposed"\] \.splitColumnTotal\{\s*\n?\s*display:none;/);
});

test("every write path that could break the 100% invariant refuses before writing", () => {
  // Typing: the per-cell handler bails when H2-H6 would exceed 100.
  assert.match(app, /const totalResult = validation\.validateHopperPercentages\(otherPercentages\);/);
  assert.match(app, /if \(!totalResult\.valid\) return;/);
  // Bulk apply: a pre-flight pass across every layer, refused with a message
  // naming the layer, before any hopper is written.
  assert.match(app, /const result = validation\.validateHopperPercentages\(projected\);\s*\n\s*if \(!result\.valid\)\{/);
  assert.match(app, /Cannot apply: Layer \$\{L\.name\} hoppers 2–6 would total/);
  // Payload loads (shared recipes, scans) go through the shared validator.
  const validation = fs.readFileSync("validation.js", "utf8");
  assert.match(validation, /Hopper percentages 2–6 cannot total more than 100%\./);
  // And H1 is always re-derived rather than stored independently.
  assert.match(app, /let h1 = 100 - sumOthers;/);
});

test("updateHopperTotals still runs, so restoring the readout stays a one-line change", () => {
  assert.match(app, /el\.classList\.toggle\("warn", !okay && !planning\);/);
  assert.match(app, /el\.textContent = `Total \$\{fmtTrim\(hopperTotal, 2\)\}%`;/);
});
