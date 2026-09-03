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

// Module-scope functions sit at two-space indent, so the four-space slice
// above runs straight past their end and into unrelated code.
function moduleFunctionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `expected ${name}`);
  const next = app.indexOf("\n  function ", start + 1);
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

/* The Recipe Book preview pane.
 *
 * One pane serves both sections: whichever configuration is selected - recipe
 * or weight profile - is drawn read-only in the same transposed shape the live
 * grid uses. Loading a shared configuration overwrites operator state, so the
 * point is to see what will land before confirming it.
 */
test("the preview is its own read-only builder, not a second call into the live grid renderer", () => {
  const body = moduleFunctionBody("renderWorkspaceConfigurationPreview");
  // It reads the stored payload only - never live state.layers, and never any
  // of the editing/selection/sync machinery renderSplitsArea wires per cell.
  assert.doesNotMatch(body, /renderSplitsArea|cellRefs|notifyActiveJobMutation|attachResinAutocomplete|recomputeAutoH1/);
  assert.match(body, /item\.payload\?\.layers/);
  // Same axis as the live grid: layers down, hopper positions across.
  assert.match(body, /corner\.textContent="Layer";/);
  assert.match(body, /rowHeader\.scope="row";/);
});

test("one pane serves both configuration types", () => {
  const body = moduleFunctionBody("renderWorkspaceConfigurationPreview");
  assert.match(body, /\.\.\.workspaceConfigurations\.listRecipes\(workspaceId\)\.items,/);
  assert.match(body, /\.\.\.workspaceConfigurations\.listReceiverWeightProfiles\(workspaceId\)\.items/);
  assert.match(body, /const recipe=item\.type==="recipe";/);
  // Recipes show resin + blend %, profiles show a receiver weight in lb.
  assert.match(body, /hopper\?\.resin_name/);
  assert.match(body, /layer\?\.receiver_weights_lb\?\.\[hi\]/);
});

test("a layer-count mismatch is surfaced in the preview, before the load dialog", () => {
  const body = moduleFunctionBody("renderWorkspaceConfigurationPreview");
  assert.match(body, /const required=derivedRequiredLayerCount\(syncState\);/);
  // Recipes are only refused when the line is actually locked to a count;
  // a weight profile always needs an exact match (applyReceiverWeightProfile).
  assert.match(body, /\(required !== null && payloadLayers !== required\)/);
  assert.match(body, /payloadLayers !== Number\(state\.lineType\)/);
  assert.match(body, /configPreviewNotice/);
});

test("the preview hides itself when there is no workspace, rather than showing an empty frame", () => {
  const body = moduleFunctionBody("renderWorkspaceConfigurationPreview");
  assert.match(body, /if\(!isSavedRecipesPage\(\) \|\| !workspaceId \|\| !workspaceConfigurations\)\{ host\.hidden=true; return; \}/);
});

test("a panel rebuild refreshes the whole hub, not just the recipe list", () => {
  // The panel owns three things a rebuild leaves empty or stale: the recipe
  // list, the moved Weight Profiles section, and the preview host - which
  // would otherwise never resolve its own hidden state.
  const body = functionBody("renderSplitsArea");
  assert.match(body, /renderWorkspaceConfigurations\(lineSync\?\.getState\?\.\(\)\);/);
  assert.doesNotMatch(body, /\n      renderSplitsSavedRecipes\(lineSync\?\.getState\?\.\(\)\);/);
  const hub = app.slice(app.indexOf("function renderWorkspaceConfigurations("), app.indexOf("async function refreshWorkspaceConfigurations("));
  assert.match(hub, /renderWorkspaceConfigurationPreview\(syncState\);/);
});

test("the preview table scrolls inside its own rail, so the panel never scrolls sideways", () => {
  assert.match(styles, /\.configPreviewScroll\{ overflow-x:auto; \}/);
  // And it steps down to a single column when the rail would be cramped.
  assert.match(styles, /@media \(max-width:1240px\)\{[\s\S]*?\.splitsConfigurationPreview\{[\s\S]*?grid-column:1;/);
});

test("the preview is a sibling of the panel, not a child - a child had to span every row and inflated them", () => {
  const body = functionBody("renderSplitsArea");
  // Appended to the page area alongside the panel...
  assert.match(body, /area\.append\(savedRecipesPanel\);[\s\S]{0,1200}?area\.append\(configurationPreview\);/);
  // ...and not built into the panel's own markup any more.
  assert.doesNotMatch(body, /<aside id="splitsConfigurationPreview"/);
  // The two columns belong to the area, so the panel stays an ordinary block
  // that its neighbour cannot stretch.
  assert.match(styles, /body\[data-recipe-page="saved"\] #splitsArea\{\s*\n\s*display:grid;/);
  assert.match(styles, /body\[data-recipe-page="saved"\] #splitsArea > \.splitsSavedRecipesPanel\{\s*\n\s*grid-column:1;/);
  assert.doesNotMatch(styles, /#splitsArea \.splitsSavedRecipesPanel\{\s*\n\s*display:grid;/);
  // Nothing spans a row range any more - that span was the bug.
  assert.doesNotMatch(styles, /grid-row:1 \/ -1;/);
});

test("the Recipe Book page lets the preview through, and every other page stands it down", () => {
  // The saved page hides everything in #splitsArea except these two.
  assert.match(styles, /body\[data-recipe-page="saved"\] #splitsArea > :not\(\.splitsSavedRecipesPanel\):not\(\.splitsConfigurationPreview\)\{/);
  // And the renderer refuses to fill it anywhere else, since the element now
  // lives in the area the grid uses on the other pages.
  const body = moduleFunctionBody("renderWorkspaceConfigurationPreview");
  assert.match(body, /if\(!isSavedRecipesPage\(\) \|\| !workspaceId \|\| !workspaceConfigurations\)\{ host\.hidden=true; return; \}/);
});

/* Contextual bars below the reworked grid.
 *
 * The 216px floor these shared existed so switching between Saved Recipes,
 * Bulk Edit and Rearrange - three alternatives in one slot below the matrix -
 * never jumped the panel by a different amount. None of that survives the
 * rework: Recipe Book is a page, Bulk Edit is raised by the selection, and
 * Rearrange is one line. The floor only bought Rearrange ~150px of empty
 * panel, so it went - and the toolbar moved below the grid so its appearing
 * costs the grid nothing either.
 */
test("no shared min-height floor is reserved below the matrix any more", () => {
  assert.doesNotMatch(styles, /#splitsArea > \.rearrangeModeBar\{ min-height: 216px; \}/);
  assert.doesNotMatch(styles, /min-height: 216px/);
});

test("the edit toolbar sits below the reworked grid, so raising it never moves the grid", () => {
  // order:-1 (above the matrix) is right only for a deliberate mode switch;
  // the reworked grid raises this on every cell click.
  assert.match(styles, /body #splitsArea\[data-recipe-layout="transposed"\] > \.splitsBulkBar\{\s*\n\s*order:1;/);
  assert.match(styles, /body #splitsArea\[data-recipe-layout="transposed"\] > \.recipeInteractionHint\{\s*\n\s*order:2;/);
  // The stacked grid keeps its own placement untouched.
  assert.match(styles, /#splitsArea > \.splitsBulkBar\{ order: -1;/);
});

test("the rearrange bar keeps its below-the-grid placement and sizes to its content", () => {
  assert.match(styles, /#splitsArea > \.rearrangeModeBar\{ order:1; position:static; \}/);
});
