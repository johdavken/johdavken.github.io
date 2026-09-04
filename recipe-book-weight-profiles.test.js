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
  // And it steps down to a single column when two columns no longer fit -
  // the left column now has a 620px floor, so the threshold moved up.
  assert.match(styles, /@media \(max-width:1460px\)\{[\s\S]*?\.splitsConfigurationPreview\{[\s\S]*?grid-column:1;/);
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

/* Rearrange reports itself through the toolbar rather than a panel.
 *
 * The standalone bar is no longer built on any width. With the edit toolbar
 * always visible below the grid, the mode shows in the controls already
 * there - and that also fixes the bar hiding the toolbar (and with it the
 * button that commits the rearrangement) for the duration.
 */
test("the standalone rearrange bar is no longer built at all", () => {
  const body = functionBody("renderSplitsArea");
  assert.doesNotMatch(body, /rearrangeModeBar/);
  assert.doesNotMatch(body, /rearrangeModeMessage|rearrangeModeActions/);
});

test("the edit toolbar is always present on the reworked grid, never raised and dropped", () => {
  const body = functionBody("setBulkMode");
  assert.match(body, /toolbar\.classList\.toggle\("hide", reworkedGrid \? false : !bulkMode\);/);
  // And the selection no longer toggles it either.
  const selection = functionBody("renderSplitsArea");
  assert.doesNotMatch(selection, /if \(reworkedGrid\) toolbar\.classList\.toggle\("hide", selected\.size === 0\);/);
});

test("Rearrange leads the secondary row so Cancel cannot shift the other buttons", () => {
  const body = functionBody("renderSplitsArea");
  // That row is a right-anchored pill (margin-left:auto), so a button added
  // at its head grows it leftwards and leaves Clear/Empty/Reset in place.
  assert.match(body, /editSecondaryRow\?\.prepend\(rearrangeButton\);/);
  assert.match(body, /rearrangeButton\.after\(cancelRearrange\);/);
  assert.match(styles, /margin-left: auto;/);
});

test("while active the button commits and is filled in the selected-tab tokens, with Cancel beside it", () => {
  const body = functionBody("renderSplitsArea");
  assert.match(body, /hopperRearrangement\?\.active\?"Done":"Rearrange"/);
  assert.match(body, /cancelRearrange\.addEventListener\("click", \(\)=>finishRearrangement\(true\)\);/);
  // Same tokens the selected page tab resolves to.
  assert.match(styles, /\.splitsRearrangeAction\.active[\s\S]{0,200}?background:var\(--btnstyle-ink\);\s*\n\s*color:var\(--panel\);/);
});

test("the interaction hint carries the rearrange guidance the bar used to", () => {
  const body = functionBody("renderSplitsArea");
  assert.match(body, /const rearranging = reworkedGrid && !!hopperRearrangement\?\.active;/);
  assert.match(body, /Drag, or \$\{pointerVerb\} a hopper then \$\{pointerVerb\} another, to move assignments\. Hopper 1 is recalculated after each move\./);
  // A fixed sentence, so the running count stops overwriting it.
  assert.match(body, /if \(rearranging\) return;/);
});

test("Undo drives the move stack while rearranging, and Redo stands down", () => {
  const body = functionBody("renderSplitsArea");
  // The recipe edit history is not touched per move - finishRearrangement
  // records the whole rearrangement as one entry - so the ordinary Undo
  // would step back the edit *before* the rearrangement.
  assert.match(body, /undoButton\.addEventListener\("click", undoRearrangement\);/);
  assert.match(body, /undoButton\.disabled = !hopperRearrangement\?\.undo\?\.length;/);
  assert.match(body, /if \(redoButton\) redoButton\.disabled = true;/);
  // Controls that act on cells go out of service with the cells.
  assert.match(body, /\[bulkNameInput, bulkPctInput, applyButton, resetButton, clearSelectionButton\]/);
});

/* The reworked grid on the touch shell (tablet).
 *
 * A tablet is over the 700px breakpoint so it gets the reworked grid, but it
 * carries the touch shell's larger type and padding, which the desktop-sized
 * minimums were never measured against.
 */
test("the grid scrolls inside its own frame instead of pushing the panel sideways", () => {
  // .splitsMatrixFrame carries overflow:hidden, which clipped the sixth
  // hopper column outright on a narrow tablet - and hid the overflow from the
  // scroller above it, so nothing scrolled either.
  assert.match(styles, /body #splitsArea\[data-recipe-layout="transposed"\] \.splitsMatrixFrame\{[\s\S]*?overflow-x:visible;/);
  assert.match(styles, /body #splitsArea\[data-recipe-layout="transposed"\] \.splitsMatrixScroll\{[\s\S]*?overflow-x:auto;/);
  // Both need to be allowed to shrink below their content, or overflow never
  // engages: #splitsArea is a grid and these are its items.
  assert.match(styles, /body #splitsArea\[data-recipe-layout="transposed"\] \.splitsMobileLayerLayout\{[\s\S]*?min-width:0;/);
});

test("the Total stays hidden on a landscape tablet, where a short-viewport touch rule re-showed it", () => {
  // @media (min-width:701px) and (max-height:800px) sets it back to
  // inline-block at (1,3,1) - the exact shape of a landscape tablet, so it
  // returned on the one surface with the least room for it.
  assert.match(styles, /body #splitsBlock #splitsArea\[data-recipe-layout="transposed"\] \.splitsMatrix \.splitColumnTotal\{\s*\n\s*display:none;/);
});

test("touch tightens the grid's minimums so six positions fit a tablet outright", () => {
  assert.match(styles, /body\[data-shell="touch"\] #splitsArea\[data-recipe-layout="transposed"\] \.splitsMatrix\{\s*\n\s*min-width:806px;/);
  assert.match(styles, /body\[data-shell="touch"\][\s\S]{0,400}?\.splitLayerHeader\{\s*\n\s*min-width:92px;/);
  // The resin code is the value that has to survive, so the percentage field
  // beside it gives up the room rather than the code.
  assert.match(styles, /body\[data-shell="touch"\] #splitsArea\[data-recipe-layout="transposed"\] \.splitPctControl input\{\s*\n\s*width:30px;/);
});

/* Recipe Book / Weight Profiles headers, and the Weights grid on the touch
 * shell (tablet).
 */
test("the section title stacks on the reworked grid so the action buttons sit under it, not detached to its right", () => {
  assert.match(styles, /body\[data-recipe-page="saved"\] #splitsArea > \.splitsSavedRecipesPanel \.workspaceConfigurationSectionTitle\{[\s\S]*?flex-direction:column;/);
  assert.match(styles, /body\[data-recipe-page="saved"\] #splitsArea > \.splitsSavedRecipesPanel \.splitsSavedRecipesActions\{[\s\S]*?justify-content:flex-start;/);
});

test("the touch-shell Weights frame gets width:100% so the fixed-layout table cannot blow out to Chromium's layout maximum", () => {
  // .weightsMatrixFrame is width:max-content and the transposed table is
  // table-layout:fixed;width:100% - a circular pair Chromium resolves to
  // ~1,000,000px, which made the grid invisible on the tablet. The Recipe
  // frame already gets width:100% on the touch shell; the Weights frame did
  // not until now.
  assert.match(styles, /body\[data-shell="touch"\] #weightsArea \.weightsMatrixFrame\{[\s\S]*?width:100%;/);
  assert.match(styles, /body\[data-shell="touch"\] #weightsArea \.weightsMatrixScroll\{[\s\S]*?overflow-x:auto;/);
});

test("the touch-shell Weights cell uses the same visual readout as desktop, not the raw checkbox row", () => {
  // The polished cell (position label + weight number + WEIGHT (LB) caption)
  // lives in desktop.css's fine-pointer wrapper, which a tablet never
  // matches. The essential rules are mirrored for the touch shell.
  assert.match(styles, /body\[data-shell="touch"\] #weightsArea \.weightsMatrix:has\(\.weightsLayerHeader\) \.desktopWeightVisualReadout\{[\s\S]*?display:grid!important;/);
  assert.match(styles, /body\[data-shell="touch"\] #weightsArea \.weightsMatrix:has\(\.weightsLayerHeader\) \.weightsCellRow,[\s\S]*?display:none!important;/);
  assert.match(styles, /body\[data-shell="touch"\] #weightsArea \.weightsMatrix:has\(\.weightsLayerHeader\) \.desktopWeightEditFields\{[\s\S]*?display:grid;/);
});

test("transposed Weights column headers are small labels, not the 64px layer-letter watermark", () => {
  // thead now holds hopper position numbers (1-6), which the ghost-watermark
  // style rendered as giant faded numerals.
  assert.match(styles, /body #weightsArea \.weightsMatrix:has\(\.weightsLayerHeader\) thead \.weightsSelectHeader\{[\s\S]*?font-size:var\(--font-tiny\);[\s\S]*?opacity:1;/);
});

test("the Weights bulk-edit panel sits below the grid, matching the reworked Recipe grid", () => {
  const body = moduleFunctionBody("renderWeightsArea") || (()=>{
    const start = app.indexOf("function renderWeightsArea(");
    const next = app.indexOf("\n    function ", start + 1);
    return app.slice(start, next === -1 ? undefined : next);
  })();
  assert.match(app, /area\.appendChild\(desktopControls\);\s*area\.appendChild\(scroll\);\s*area\.appendChild\(toolbar\);/);
});

test("the weight/height cell inputs stack on every width, not just the tablet", () => {
  // desktop.css sits them in a 2-column grid; stacked reads better and is
  // now the treatment everywhere - not shell-scoped.
  assert.match(styles, /body #weightsArea \.weightsMatrix:has\(\.weightsLayerHeader\) \.desktopWeightEditFields\{\s*\n\s*grid-template-columns:1fr;/);
  assert.match(styles, /body #weightsArea \.weightsMatrix:has\(\.weightsLayerHeader\) \.desktopWeightEditFields label small\{[\s\S]*?order:1;/);
});

test("Smart Hoppers lives in the header pill, beside where Current/Next put Promote / Print", () => {
  const body = (()=>{const start=app.indexOf("function renderWeightsArea(");const next=app.indexOf("\n    function ",start+1);return app.slice(start,next===-1?undefined:next);})();
  // The real #smartHoppersToggle pill + a "Smart Hoppers" label, moved (not
  // rebuilt) into #recipeHeaderActions. The gutter keeps its "Layer" caption.
  assert.match(body, /const headerActions = \$\("recipeHeaderActions"\);/);
  assert.match(body, /smartField\.appendChild\(smartToggleEl\);/);
  assert.match(body, /headerActions\.appendChild\(smartField\);/);
  assert.match(body, /headerActions\.replaceChildren\(\);/);
  assert.match(body, /corner\.textContent = "Layer";/);
  assert.doesNotMatch(body, /weightsCornerSmartLabel|weightsCornerToggle/);
  assert.match(styles, /body #splitsBlock #recipeHeaderControls \.weightsHeaderSmart\{/);
  assert.match(styles, /body #splitsBlock #recipeHeaderControls \.weightsHeaderSmart \.toggle\{/);
  // syncRecipePageUI no longer hides the header actions slot on desktop Weights.
  assert.match(app, /headerActions\.hidden = isSavedRecipesPage\(\);/);
});

test("the bulk toolbar shows the visible 'N hoppers selected' count again", () => {
  assert.match(app, /<div id="weightSelectionStatus" class="tiny weightsSelectionStatus" role="status"/);
  assert.doesNotMatch(app, /class="tiny weightsSelectionStatus srOnly"/);
  assert.match(styles, /body #splitsBlock #weightsArea \.weightsBulkBar \.weightsBulkActions \.weightsSelectionStatus\{[\s\S]*?position:static;/);
});

test("the toolbar is always visible - it carries the Smart Hoppers toggle", () => {
  const body = (()=>{const start=app.indexOf("function renderWeightsArea(");const next=app.indexOf("\n    function ",start+1);return app.slice(start,next===-1?undefined:next);})();
  assert.match(body, /toolbar\.hidden = false;/);
  assert.doesNotMatch(body, /toolbar\.hidden = selected\.size === 0;/);
});

test("with no identified line, a muted 'Smart Hoppers . unavailable' marker holds the header slot", () => {
  const body = (()=>{const start=app.indexOf("function renderWeightsArea(");const next=app.indexOf("\n    function ",start+1);return app.slice(start,next===-1?undefined:next);})();
  assert.match(body, /smartField\.textContent = "Smart Hoppers \u00b7 unavailable";/);
  assert.match(styles, /body #splitsBlock #recipeHeaderControls \.weightsHeaderSmart\.unavailable\{/);
});

test("the weights bulk Apply button reads just 'Apply', fixed", () => {
  const body = (()=>{const start=app.indexOf("function renderWeightsArea(");const next=app.indexOf("\n    function ",start+1);return app.slice(start,next===-1?undefined:next);})();
  assert.match(body, /applyButton\.textContent = "Apply";/);
  assert.doesNotMatch(body, /Apply to \$\{selected\.size\} hopper/);
  assert.match(app, /<button id="applyBulkWeight" class="secondary" type="button" disabled>Apply<\/button>/);
});

test("the weights bulk bar mirrors the recipe toolbar - transparent strip, boxed fields, station-console actions bay", () => {
  // No outer card: transparent, no border/radius, like #splitsBulkBar on
  // the reworked grid.
  assert.match(styles, /body #splitsBlock #weightsArea \.weightsBulkBar\{[\s\S]*?background:transparent;/);
  // Each field a bordered box, matching .splitsEditRowPrimary > .splitsBulkField.
  assert.match(styles, /body #splitsBlock #weightsArea \.weightsBulkBar \.weightsBulkField\{[\s\S]*?border:1px solid var\(--row-border-2\);[\s\S]*?background:var\(--row-bg-2\);/);
  // Actions in a tinted rounded bay, like .splitsEditRowSecondary.
  assert.match(styles, /body #splitsBlock #weightsArea \.weightsBulkBar \.weightsBulkActions\{[\s\S]*?border-radius:7px;[\s\S]*?background:color-mix\(in srgb, var\(--btnstyle-surface\) 55%, transparent\);/);
  // Title case Apply / Clear, matching the recipe toolbar.
  assert.match(styles, /body #splitsBlock #weightsArea \.weightsBulkBar #applyBulkWeight,\s*\n\s*body #splitsBlock #weightsArea \.weightsBulkBar \.weightsBulkActions \.bulkTextAction\{[\s\S]*?text-transform:none;/);
});

test("the smart control and circumference are pulled from desktopControls, which then collapses", () => {
  const body = (()=>{const start=app.indexOf("function renderWeightsArea(");const next=app.indexOf("\n    function ",start+1);return app.slice(start,next===-1?undefined:next);})();
  assert.match(body, /const smartToggleEl = desktopControls\.querySelector\("#smartHoppersToggle"\);/);
  assert.match(body, /desktopControls\.querySelector\("\.desktopWeightsSmartControl"\)\?\.remove\(\);/);
  // The emptied controls strip is hidden so it adds no gap above the grid.
  assert.match(styles, /body #weightsArea > \.desktopWeightsControls:not\(:has\(\*\)\)\{[\s\S]*?display:none;/);
});

test("the shared circumference field moves into the header pill alongside Smart Hoppers", () => {
  const body = (()=>{const start=app.indexOf("function renderWeightsArea(");const next=app.indexOf("\n    function ",start+1);return app.slice(start,next===-1?undefined:next);})();
  assert.match(body, /circumferenceLabel\.classList\.add\("weightsHeaderCircumference"\);/);
  assert.match(body, /headerActions\.appendChild\(circumferenceLabel\);/);
  assert.match(styles, /body #splitsBlock #recipeHeaderControls \.weightsHeaderCircumference\{/);
});

test("Apply in the weights bulk bar takes the station-console key, matching Clear", () => {
  assert.match(styles, /body #splitsBlock \.weightsBulkBar #applyBulkWeight,[\s\S]*?background:var\(--btnstyle-surface\);[\s\S]*?box-shadow:0 1px 0 var\(--btnstyle-edge\);/);
});

test("the weights bulk actions align right", () => {
  assert.match(styles, /body #splitsBlock #weightsArea \.weightsBulkBar \.weightsBulkActions\{[\s\S]*?margin-left:auto;/);
});

test("the Weights page opens with the same gap above the grid as the other pages", () => {
  // #weightsArea carries a static .mt10 class and its now-empty
  // .desktopWeightsControls first child still added a grid gap - both
  // touch-shell only (desktop.css zeroes them in its fine-pointer wrapper).
  assert.match(styles, /body #splitsArea\.recipeWeightsPage > #weightsArea\{\s*\n\s*margin-top:0;/);
  assert.match(styles, /body #weightsArea > \.desktopWeightsControls:not\(:has\(\*\)\)\{[\s\S]*?display:none;/);
});

/* Recipe Book desktop layout pass (48b9af1 follow-up).
 *
 * Structural/styling only - no change to save/load/update, RT Sync, or
 * preview behaviour.
 */
test("the left column is constrained and the preview gets the rest", () => {
  // Was minmax(0,1fr) minmax(280px,340px) - the list ate the workspace and
  // the matrix preview was pinned to a 340px rail that always scrolled.
  assert.match(styles, /body\[data-recipe-page="saved"\] #splitsArea\{[\s\S]*?grid-template-columns:minmax\(620px,760px\) minmax\(500px,1fr\);[\s\S]*?gap:20px 24px;/);
});

test("the saved-recipe name is the primary text, its metadata secondary", () => {
  // Name was var(--font-small) / var(--muted) - weaker than its own meta.
  assert.match(styles, /\.splitsSavedRecipesPanel \.workspaceConfigurationRow strong\{[\s\S]*?font-size:15px;[\s\S]*?color:var\(--text\);/);
  assert.match(styles, /\.splitsSavedRecipesPanel \.workspaceConfigurationRow small\{[\s\S]*?font-size:13px;[\s\S]*?color:var\(--muted\);/);
});

test("the whole row is the click target, and it stays compact", () => {
  // The app-side guard fix (bare 'details' -> the row's own overflow class)
  // is asserted in workspace-configurations-ui.test.js. Here: the info block
  // is click-through, the actions are not, and the row height is 56-64px.
  assert.match(styles, /\.splitsSavedRecipesPanel \.workspaceConfigurationRow \.workspaceConfigurationInfo\{[\s\S]*?pointer-events:none;/);
  assert.match(styles, /\.splitsSavedRecipesPanel \.workspaceConfigurationRow \.workspaceConfigurationActions\{[\s\S]*?pointer-events:auto;/);
  assert.match(styles, /\.splitsSavedRecipesPanel \.workspaceConfigurationRow\{[\s\S]*?min-height:56px;/);
});

test("the row list aligns with the toolbar above it - no scrollbar-gutter inset", () => {
  assert.match(styles, /\.splitsSavedRecipesPanel \.workspaceConfigurationList\{[\s\S]*?padding-right:0;[\s\S]*?scrollbar-gutter:stable;/);
});
