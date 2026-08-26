"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n  function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

// Recipe Setup gets its own "Saved Recipes" entry point into the same
// shared-recipe list Line Configurations already has - not a duplicate
// feature, a second surface reading the same workspaceConfigurations
// service/cache. Line Configurations' own Recipes section is untouched.

test("Line Configurations' own Recipes section is untouched - same element IDs, same Save Current Recipe wiring", () => {
  assert.match(app, /workspaceSaveRecipe.*addEventListener\("click",\(\)=>openWorkspaceConfigurationDialog\("save-recipe"\)\)/);
  assert.match(app, /const profiles=\$\("workspaceProfilesList"\), recipes=\$\("workspaceRecipesList"\)/);
});

test("the row-rendering logic (Load/Update/Rename/Duplicate/Favorite/Delete) was extracted into a shared function, not copy-pasted for the new surface", () => {
  const body = functionBody("renderConfigurationList");
  assert.match(body, /action\("Load",\(\)=>previewWorkspaceConfiguration\(item\),"primary"\)/);
  assert.match(body, /action\("Update",\(\)=>openWorkspaceConfigurationDialog\("update",item\)\)/);
  assert.match(body, /menuAction\("Rename"/);
  assert.match(body, /menuAction\("Duplicate"/);
  assert.match(body, /menuAction\("Delete"/);
  // Only recipes get a favorite toggle in the overflow menu - unchanged
  // from the original, kind-gated logic.
  assert.match(body, /if\(kind==="recipe"\) menuAction\(item\.favorite\?"Unfavorite":"Favorite"/);
});

test("renderConfigurationList is called for all three list hosts: Line Configurations' profiles, its recipes, and Recipe Setup's saved-recipes copy", () => {
  assert.match(app, /renderConfigurationList\(profiles,workspaceConfigurations\.listReceiverWeightProfiles\(workspaceId\)\.items,"profile",syncState\)/);
  assert.match(app, /renderConfigurationList\(recipes,workspaceConfigurations\.listRecipes\(workspaceId\)\.items,"recipe",syncState\)/);
  const body = functionBody("renderSplitsSavedRecipes");
  assert.match(body, /renderConfigurationList\(host,items,"recipe",syncState,\{ showRowActions:false \}\)/);
});

test("Recipe Setup's copy only ever lists recipes, never receiver weight profiles - matches the product rule that Recipe Setup doesn't concern itself with equipment weights", () => {
  const body = functionBody("renderSplitsSavedRecipes");
  assert.doesNotMatch(body, /listReceiverWeightProfiles/);
});

test("renderWorkspaceConfigurations always refreshes Recipe Setup's copy first, so every existing call site (refresh, mutation finish, RT Sync state change, cache subscription) keeps both surfaces in sync without being individually rewired", () => {
  const body = functionBody("renderWorkspaceConfigurations");
  const firstLine = body.split("\n")[1].trim();
  assert.equal(firstLine, "renderSplitsSavedRecipes(syncState);");
});

test("renderSplitsSavedRecipes no-ops if the panel hasn't been built yet (host missing), rather than throwing", () => {
  const body = functionBody("renderSplitsSavedRecipes");
  assert.match(body, /if\(!host\) return;/);
});

test("renderSplitsSavedRecipes explains why the list is empty when disconnected or when the service is unavailable, same messaging pattern as the original panel", () => {
  const body = functionBody("renderSplitsSavedRecipes");
  assert.match(body, /Connect to an RT Sync workspace to view shared recipes\./);
  assert.match(body, /Shared configurations service is unavailable\./);
});

test("renderSplitsArea calls renderSplitsSavedRecipes at the end of every render, so the freshly-rebuilt (and therefore empty) list host is immediately repopulated rather than staying blank until an unrelated RT Sync event fires", () => {
  const body = functionBody("renderSplitsArea");
  assert.match(body, /setSavedRecipesOpen\(splitsSavedRecipesOpen\);\s*\n\s*renderSplitsSavedRecipes\(lineSync\?\.getState\?\.\(\)\);/);
});

// --- Bulk edit / Rearrange / Saved Recipes are mutually exclusive -

test("splitsBulkModeActive and splitsSavedRecipesOpen persist at module scope (like hopperRearrangement already does), so a render triggered by switching panels can seed the one the operator meant to open", () => {
  assert.match(app, /let splitsBulkModeActive = false;/);
  assert.match(app, /let splitsSavedRecipesOpen = false;/);
  // Selection is resolved from the Summary/Edit view on every surface now
  // (Edit *is* bulk edit), so nothing seeds from the persisted flag - it
  // survives only as the value setBulkMode writes back for Android Back.
  assert.match(app, /let bulkMode = viewMode === "edit";/);
});

test("opening Rearrange closes Bulk edit and Saved Recipes", () => {
  const rearrangeStart = app.indexOf('rearrangeButton.addEventListener("click"');
  const rearrangeBody = app.slice(rearrangeStart, app.indexOf("\n      });", rearrangeStart) + 9);
  assert.match(rearrangeBody, /splitsBulkModeActive = false;/);
  assert.match(rearrangeBody, /splitsSavedRecipesOpen = false;/);
});

test("opening Bulk edit closes Saved Recipes outright, and exits Rearrange (with the same cleanup Done Rearranging itself uses) if it was active", () => {
  const modeButtonStart = app.indexOf('modeButton.addEventListener("click"');
  const modeButtonBody = app.slice(modeButtonStart, app.indexOf("\n      });", modeButtonStart) + 9);
  assert.match(modeButtonBody, /if \(turningOn && hopperRearrangement\?\.active\)\{/);
  assert.match(modeButtonBody, /hopperRearrangement = null;/);
  assert.match(modeButtonBody, /splitsBulkModeActive = true;/);
  assert.match(modeButtonBody, /splitsSavedRecipesOpen = false;/);
  assert.match(modeButtonBody, /validateAndCompute\(\);/);
  assert.match(modeButtonBody, /saveSession\(\);/);
  assert.match(modeButtonBody, /notifyActiveJobMutation\(\{immediate:true,kind:"rearrange-hoppers"\}\);/);
  assert.match(modeButtonBody, /if \(turningOn\) setSavedRecipesOpen\(false\);/);
});

test("the mobile Recipes disclosure keeps its existing exclusion and rearrangement cleanup", () => {
  const savedRecipesClickStart = app.indexOf("savedRecipesButton.addEventListener(\"click\", ()=>{");
  const savedRecipesClickBody = app.slice(savedRecipesClickStart, app.indexOf("      });", savedRecipesClickStart) + 8);
  assert.match(savedRecipesClickBody, /if \(turningOn && hopperRearrangement\?\.active\)\{/);
  assert.match(savedRecipesClickBody, /hopperRearrangement = null;/);
  assert.match(savedRecipesClickBody, /splitsSavedRecipesOpen = true;/);
  assert.match(savedRecipesClickBody, /splitsBulkModeActive = false;/);
  // This dynamic button is mounted only on compact mobile.
  assert.match(savedRecipesClickBody, /if \(turningOn && compactMobileRecipe\) setBulkMode\(false\);/);
});

test("setBulkMode and setSavedRecipesOpen both write their resolved value back to the module-level flag, keeping it in sync for the next render", () => {
  const setBulkModeBody = functionBody("setBulkMode");
  assert.match(setBulkModeBody, /splitsBulkModeActive = bulkMode;/);
  const setSavedRecipesOpenStart = app.indexOf("function setSavedRecipesOpen(open){");
  const setSavedRecipesOpenBody = app.slice(setSavedRecipesOpenStart, app.indexOf("\n      }", setSavedRecipesOpenStart));
  assert.match(setSavedRecipesOpenBody, /splitsSavedRecipesOpen = !!open;/);
});

test("Recipe Book is a desktop page tab while mobile keeps the existing Recipes disclosure button", () => {
  assert.match(html, /id="recipePageTabSaved" role="tab" aria-selected="false" aria-controls="splitsArea" data-recipe-page="saved" hidden>Recipe Book<\/button>/);
  assert.match(app, /<strong>Recipe Book<\/strong>/);
  assert.match(app, /savedRecipesButton\.textContent = "Saved Recipes"/);
  assert.match(app, /mobilePrimaryRow\.append\(savedRecipesButton\);/);
  assert.doesNotMatch(app, /recipeUtilityTabs\.append\(savedRecipesButton\);/);
  assert.match(app, /function setSavedRecipesOpen\(open\)\{/);
  assert.match(app, /savedRecipesPanel\.classList\.toggle\("hide", !open\)/);
  assert.match(app, /savedRecipesButton\.setAttribute\("aria-expanded",String\(open\)\)/);
  assert.match(app, /splitsSavedRecipesOpen = next === "saved";/);
});

test("Recipes and receiver profiles use centered sheets without opening the search keyboard",()=>{
  assert.match(styles,/\.mobileSavedRecipesSheet\{[\s\S]*?left:50%;[\s\S]*?transform:translateX\(-50%\);[\s\S]*?width:min\(410px,calc\(100vw - 20px\)\);/);
  assert.match(app,/mobileSavedRecipesSheet\?\.focus\(\{preventScroll:true\}\)/);
  assert.match(app,/profilesSheet\.focus\(\{preventScroll:true\}\)/);
  assert.doesNotMatch(app,/mobileSavedRecipesSearch"\)\?\.focus\(\)/);
  assert.doesNotMatch(app,/mobileWeightProfilesSearch"\)\?\.focus\(\)/);
});

test("the panel's own Save Current Recipe button reuses the exact same dialog flow as Line Configurations', not a parallel save path", () => {
  assert.match(app, /savedRecipesPanel\.querySelector\("#splitsSaveRecipe"\)\.addEventListener\("click", \(\)=>openWorkspaceConfigurationDialog\("save-recipe"\)\)/);
});

test("Recipe Book can save the planned Next Recipe through the shared save flow", () => {
  assert.match(app, /id="splitsSaveNextRecipe"[^>]*>Save Next Recipe<\/button>/);
  assert.match(app, /saveNextRecipeButton\.disabled=!window\.PolynNextRecipe\?\.isMeaningful\(state\.nextRecipe\);/);
  assert.match(app, /saveNextRecipeButton\.addEventListener\("click", \(\)=>openWorkspaceConfigurationDialog\("save-next-recipe"\)\)/);
  const dialog = functionBody("openWorkspaceConfigurationDialog");
  assert.match(dialog, /const savingNext=mode==="save-next-recipe";/);
  assert.match(dialog, /savingNext\?"Save Next Recipe"/);
  const submit = functionBody("submitWorkspaceConfigurationDialog");
  assert.match(submit, /pending\.mode==="save-next-recipe"\?window\.PolynNextRecipe\?\.fromState\(state\)/);
  assert.match(submit, /if\(!payload\)\{ workspaceConfigurationStatus\("There is no Next Recipe to save\."\); return; \}/);
});

test("choosing another name after a duplicate keeps Save Next as the source", () => {
  const submit = functionBody("submitWorkspaceConfigurationDialog");
  assert.match(submit, /resolveWorkspaceConfigurationDuplicate\(pending\.type,name,payload,pending\.mode\)/);
  const duplicate = functionBody("resolveWorkspaceConfigurationDuplicate");
  assert.match(duplicate, /saveMode=type==="recipe"\?"save-recipe":"save-profile"/);
  assert.match(duplicate, /dialog\.returnValue==="choose"\) openWorkspaceConfigurationDialog\(saveMode\)/);
});

test("the panel starts hidden and is included in the bottom-of-panel reorder group alongside the other expandable bars", () => {
  assert.match(app, /savedRecipesPanel\.className = "splitsSavedRecipesPanel hide"/);
  assert.match(styles, /#splitsArea > \.splitsSavedRecipesPanel/);
});

test("the panel reuses the established workspaceConfigurationList/Row/Section markup classes rather than inventing new styling", () => {
  const start = app.indexOf('savedRecipesPanel.innerHTML = `');
  const body = app.slice(start, app.indexOf("`;", start));
  assert.match(body, /class="workspaceConfigurationSectionTitle"/);
  assert.match(body, /class="workspaceConfigurationList"/);
});

test("the button row wraps on narrow viewports instead of overflowing now that a fourth toggle button was added", () => {
  // Not the #splitsArea > .splitsBulkModeBar ordering override further up
  // the file (which also contains the substring ".splitsBulkModeBar{") -
  // this is modeBar's own base rule.
  const ruleStart = styles.indexOf("\n.splitsBulkModeBar{");
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart) + 1);
  assert.match(rule, /flex-wrap:\s*wrap/);
});

// --- consolidated action bar: (Save Current)(Load)(Update)(...) ------------
// replaces the old per-row Load/Update/overflow buttons for Recipe Setup's
// copy specifically - Line Configurations' own lists are untouched.

test("Recipe Setup's list renders with row-level actions turned off - Load/Update/overflow no longer live on each row here", () => {
  const body = functionBody("renderSplitsSavedRecipes");
  assert.match(body, /\{ showRowActions:false \}/);
});

test("renderConfigurationList defaults to showing row actions (Line Configurations' own profiles/recipes calls pass no fourth argument, so they're unaffected)", () => {
  const signature = app.match(/function renderConfigurationList\(host,items,kind,syncState,\{ showRowActions = true \} = \{\}\)\{/);
  assert.ok(signature, "expected showRowActions to default to true");
  assert.match(app, /renderConfigurationList\(profiles,workspaceConfigurations\.listReceiverWeightProfiles\(workspaceId\)\.items,"profile",syncState\)\;/);
  assert.match(app, /renderConfigurationList\(recipes,workspaceConfigurations\.listRecipes\(workspaceId\)\.items,"recipe",syncState\)\;/);
});

test("the per-row actions div is gated on showRowActions as well as selection, not selection alone", () => {
  const body = functionBody("renderConfigurationList");
  assert.match(body, /if\(selected&&showRowActions\)\{const actions=document\.createElement\("div"\);/);
});

test("the panel's top bar has Save Current, Save Next, Load, Update, then the (...) overflow", () => {
  const start = app.indexOf('savedRecipesPanel.innerHTML = `');
  const body = app.slice(start, app.indexOf("`;", start));
  const saveIndex = body.indexOf('id="splitsSaveRecipe"');
  const saveNextIndex = body.indexOf('id="splitsSaveNextRecipe"');
  const loadIndex = body.indexOf('id="splitsLoadRecipe"');
  const updateIndex = body.indexOf('id="splitsUpdateRecipe"');
  const overflowIndex = body.indexOf('id="splitsRecipeOverflow"');
  assert.ok(saveIndex > -1 && saveNextIndex > saveIndex && loadIndex > saveNextIndex && updateIndex > loadIndex && overflowIndex > updateIndex,
    "expected Save Current, Save Next, Load, Update, then the overflow menu");
});

test("the overflow menu holds Rename, Duplicate, Favorite, and Delete - the same four actions that used to live per-row", () => {
  const start = app.indexOf('savedRecipesPanel.innerHTML = `');
  const body = app.slice(start, app.indexOf("`;", start));
  assert.match(body, /id="splitsRenameRecipe"[^>]*>Rename</);
  assert.match(body, /id="splitsDuplicateRecipe"[^>]*>Duplicate</);
  assert.match(body, /id="splitsFavoriteRecipe"[^>]*>Favorite</);
  assert.match(body, /id="splitsDeleteRecipe"[^>]*class="danger"[^>]*>Delete</);
});

test("Load, Update, and the overflow menu all start visible but disabled - nothing is selected until a row is clicked, and the overflow must stay visible (not hidden) to match Load/Update's treatment", () => {
  const start = app.indexOf('savedRecipesPanel.innerHTML = `');
  const body = app.slice(start, app.indexOf("`;", start));
  assert.match(body, /id="splitsLoadRecipe"[^>]*disabled/);
  assert.match(body, /id="splitsUpdateRecipe"[^>]*disabled/);
  assert.match(body, /id="splitsRecipeOverflow" class="overflow-disabled"|class="workspaceConfigurationOverflow overflow-disabled" id="splitsRecipeOverflow"/);
  assert.doesNotMatch(body, /id="splitsRecipeOverflow"[^>]*hidden/);
});

test("wireSplitsSavedRecipesActions resolves the selected item from selectedWorkspaceConfigurationId against the current items list, not a stale reference", () => {
  const body = functionBody("wireSplitsSavedRecipesActions");
  assert.match(body, /items\.find\(item=>item\.id===selectedWorkspaceConfigurationId\)/);
});

test("wireSplitsSavedRecipesActions enables the bar only once something is selected, keeping the overflow visible (toggling a disabled class, not hidden) and reflecting that item's favorite state on the overflow button's label", () => {
  const body = functionBody("wireSplitsSavedRecipesActions");
  assert.match(body, /loadBtn\.disabled = !selectedItem;/);
  assert.match(body, /updateBtn\.disabled = !selectedItem;/);
  assert.match(body, /overflow\.classList\.toggle\("overflow-disabled", !selectedItem\);/);
  assert.doesNotMatch(body, /overflow\.hidden = /);
  assert.match(body, /favoriteBtn\.textContent = selectedItem\?\.favorite \? "Unfavorite" : "Favorite";/);
});

test("a click on the disabled overflow's summary is blocked from opening the menu, since <details> has no native disabled state to rely on", () => {
  const body = functionBody("wireSplitsSavedRecipesActions");
  assert.match(body, /overflowSummary\.onclick = event=>\{ if\(!selectedItem\) event\.preventDefault\(\); \};/);
});

test("wireSplitsSavedRecipesActions uses .onclick assignment, not addEventListener, so repeated calls (every selection change) never stack duplicate handlers", () => {
  const body = functionBody("wireSplitsSavedRecipesActions");
  assert.doesNotMatch(body, /addEventListener/);
  assert.match(body, /loadBtn\.onclick = /);
  assert.match(body, /updateBtn\.onclick = /);
  assert.match(body, /renameBtn\.onclick = /);
  assert.match(body, /duplicateBtn\.onclick = /);
  assert.match(body, /favoriteBtn\.onclick = /);
  assert.match(body, /deleteBtn\.onclick = /);
});

test("the bar's actions call the exact same underlying functions the old per-row buttons used (previewWorkspaceConfiguration, openWorkspaceConfigurationDialog, mutateWorkspaceConfiguration) - not a parallel implementation", () => {
  const body = functionBody("wireSplitsSavedRecipesActions");
  assert.match(body, /previewWorkspaceConfiguration\(selectedItem\)/);
  assert.match(body, /openWorkspaceConfigurationDialog\("update",selectedItem\)/);
  assert.match(body, /openWorkspaceConfigurationDialog\("rename",selectedItem\)/);
  assert.match(body, /openWorkspaceConfigurationDialog\("duplicate",selectedItem\)/);
  assert.match(body, /mutateWorkspaceConfiguration\("favorite",selectedItem,!selectedItem\.favorite\)/);
  assert.match(body, /mutateWorkspaceConfiguration\("delete",selectedItem\)/);
});

test("delete still confirms before mutating, same as the original per-row Delete button did", () => {
  const body = functionBody("wireSplitsSavedRecipesActions");
  assert.match(body, /confirm\(`Delete shared configuration/);
});

test("renderSplitsSavedRecipes wires the action bar (disabling it) even when disconnected or the service is unavailable, so stale enabled buttons don't linger from a previous workspace", () => {
  const body = functionBody("renderSplitsSavedRecipes");
  const disconnectedBranch = body.slice(body.indexOf("if(!workspaceId)"), body.indexOf("if(!workspaceConfigurations)"));
  const noServiceBranch = body.slice(body.indexOf("if(!workspaceConfigurations)"), body.indexOf('setStatus("");'));
  assert.match(disconnectedBranch, /wireSplitsSavedRecipesActions\(\[\]\)/);
  assert.match(noServiceBranch, /wireSplitsSavedRecipesActions\(\[\]\)/);
});

test("the action bar has its own CSS - a wrapping flex row, not the default block stacking", () => {
  const ruleStart = styles.indexOf(".splitsSavedRecipesActions{");
  assert.notEqual(ruleStart, -1);
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart) + 1);
  assert.match(rule, /display:\s*flex/);
  assert.match(rule, /flex-wrap:\s*wrap/);
});

test("the compact Saved Recipes header actions retain concrete left padding, so Load's short label clears its accent rail", () => {
  const ruleStart = styles.indexOf(".splitsSavedRecipesPanel .workspaceConfigurationSectionTitle > .splitsSavedRecipesActions > :is(button.secondary,button.primary){");
  assert.notEqual(ruleStart, -1, "expected a Saved Recipes header-action padding override");
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart) + 1);
  assert.match(rule, /padding:4px 9px;/);
});
