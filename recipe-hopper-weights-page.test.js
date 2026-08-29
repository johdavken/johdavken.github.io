const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("Hopper Weights is an accessible Recipe workspace page", () => {
  assert.match(html, /id="recipePageTabWeights" role="tab" aria-selected="false" aria-controls="splitsArea" data-recipe-page="weights"><span class="recipeTabLabel"><span class="recipeWeightsTabFull">Hopper Weights<\/span><span class="recipeWeightsTabCompact" aria-hidden="true">Weights<\/span><\/span><span class="recipeTabIcon" aria-hidden="true">/);
  assert.match(app, /function isWeightsPage\(\)\{ return activeRecipePage === "weights"; \}/);
  assert.match(app, /page === "weights" \? "weights"/);
});

test("the former Line Setup entries are compatibility hosts, not duplicate destinations", () => {
  assert.match(html, /<details class="block" id="weightsBlock" hidden>/);
  assert.match(html, /<details class="block" id="setupWeightProfilesBlock" hidden>/);
});

test("the existing live weights editor is moved rather than cloned", () => {
  assert.equal((html.match(/id="weightsArea"/g) || []).length, 1);
  const start = app.indexOf("function renderSplitsArea()");
  const render = app.slice(start, app.indexOf("const copyRules", start));
  assert.match(render, /if \(!isWeightsPage\(\)\)[\s\S]*?append\(weightsArea\)/);
  assert.match(render, /if \(isWeightsPage\(\)\)\{[\s\S]*?area\.append\(weightsArea\);[\s\S]*?renderWeightsArea\(\);[\s\S]*?return;/);
});

test("Weight Profiles keeps its attached desktop presentation in the new parent", () => {
  assert.match(desktop, /:is\(#lineSetupBlock,#splitsBlock\) #weightsArea #setupWeightProfilesBlock/);
});

test("weights uses Recipe's header slot for its existing Summary/Edit control, relocated on every rebuild of the grid - not just on page navigation", () => {
  // Smart Hoppers, the shared circumference field, and a handful of other
  // inputs all call renderWeightsArea() directly rather than routing
  // through renderSplitsArea()'s page-switch logic. renderWeightsArea()
  // rebuilds a brand new Summary/Edit toggle element on every call, so the
  // relocation into #recipeHeaderControls has to live inside it (and run on
  // both the mobile and desktop branches) - otherwise one of those direct
  // callers leaves a freshly built, unrelocated toggle sitting above the
  // grid while a stale, no-longer-wired one stays parked in the header.
  const helperStart = app.indexOf("function placeWeightsViewToggleForPage()");
  const renderStart = app.indexOf("function renderWeightsArea()");
  assert.ok(helperStart > -1 && helperStart < renderStart);
  const helper = app.slice(helperStart, renderStart);
  assert.match(helper, /querySelector\("\.desktopWeightsViewToggle, \.mobileWeightsViewToggle"\)/);
  assert.match(helper, /toggle\.classList\.add\("weightsHeaderViewToggle", "recipeViewToggle"\)/);
  assert.match(helper, /\$\("recipeHeaderControls"\)\?\.prepend\(toggle\)/);

  const renderEnd = app.indexOf("function smartHopperComputation", renderStart);
  const render = app.slice(renderStart, renderEnd);
  assert.equal((render.match(/placeWeightsViewToggleForPage\(\);/g) || []).length, 2,
    "expected one call on the mobile (touch) branch and one on the desktop branch");
});

test("the weights view control adopts Recipe's button classes", () => {
  assert.match(app, /button\.classList\.toggle\("primary", active\)/);
  assert.match(app, /button\.classList\.toggle\("secondary", !active\)/);
  assert.match(app, /desktopViewToggle\.querySelectorAll\("\[data-weight-view\]"\)/);
});

test("touch Recipe and Weights use one Edit/Done action", () => {
  assert.match(app, /touchToggle\.textContent = splitsViewMode === "edit" \? "Done" : "Edit"/);
  assert.match(app, /setRecipeViewMode\(splitsViewMode === "edit" \? "summary" : "edit"\)/);
  assert.match(app, /touchToggle\.textContent = visualMode \? "Edit" : "Done"/);
  assert.match(app, /setMobileWeightView\(visualMode \? "edit" : "visual"\)/);
  assert.doesNotMatch(styles, /\.recipeHeaderControls\s*>\s*\.weightsHeaderViewToggle button\.active\s*\{[^}]*box-shadow\s*:\s*none/);
});
