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
