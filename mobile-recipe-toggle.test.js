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
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

test("the Recipe chip sits next to the Timeline chip in the mobile status bar, same structure", () => {
  const timelineIndex = html.indexOf('id="mobileTimelineToggle"');
  const recipeIndex = html.indexOf('id="mobileRecipeToggle"');
  assert.ok(timelineIndex > -1 && recipeIndex > -1 && timelineIndex < recipeIndex,
    "the recipe chip must immediately follow the timeline chip");
  assert.match(html, /<div id="mobileRecipeToggle" class="chipToggle statusRecipeToggle" role="switch" aria-checked="false" tabindex="0" title="Hide everything except Recipe Setup">/);
});

test("both chips share the same base class, so the new one automatically matches size/style", () => {
  assert.match(html, /class="chipToggle statusTimelineToggle"/);
  assert.match(html, /class="chipToggle statusRecipeToggle"/);
});

test("the recipe chip is hidden on desktop and shown on mobile, mirroring the timeline chip exactly", () => {
  assert.match(styles, /\.statusTimelineToggle\{ display:none; \}\s*\.statusRecipeToggle\{ display:none; \}/);
  assert.match(styles, /\.statusTimelineToggle\{ display:inline-flex; \}\s*\.statusRecipeToggle\{ display:inline-flex; \}/);
});

test("recipe-only mode hides every other panel and forces splitsBlock open, mirroring timeline-only mode's rules for resultsBlock", () => {
  assert.match(styles, /body\[data-mobile-recipe-only="true"\] \.workspaceContent > \.workspacePanel:not\(#splitsBlock\)\{ display:none !important; \}/);
  assert.match(styles, /body\[data-mobile-recipe-only="true"\] #splitsBlock\{ display:block !important; \}/);
});

test("applyMobileRecipeMode sets the body attribute, forces splitsBlock open on mobile, and syncs the chip", () => {
  const body = functionBody("applyMobileRecipeMode");
  assert.match(body, /state\.mobileRecipeOnly = !!enabled;/);
  assert.match(body, /document\.body\.setAttribute\("data-mobile-recipe-only", String\(state\.mobileRecipeOnly\)\);/);
  assert.match(body, /const splits = \$\("splitsBlock"\);/);
  assert.match(body, /syncToggleUI\("mobileRecipeToggle", state\.mobileRecipeOnly\);/);
});

test("the two isolate modes are mutually exclusive - enabling one turns the other off", () => {
  const timelineBody = functionBody("applyMobileTimelineMode");
  assert.match(timelineBody, /if \(state\.mobileTimelineOnly && state\.mobileRecipeOnly\)\{/);
  assert.match(timelineBody, /state\.mobileRecipeOnly = false;/);

  const recipeBody = functionBody("applyMobileRecipeMode");
  assert.match(recipeBody, /if \(state\.mobileRecipeOnly && state\.mobileTimelineOnly\)\{/);
  assert.match(recipeBody, /state\.mobileTimelineOnly = false;/);
});

test("the chip is registered through the same generic toggle wiring as every other custom toggle", () => {
  const hookCustomToggles = functionBody("hookCustomToggles");
  assert.match(hookCustomToggles, /hookToggle\(\s*"mobileRecipeToggle",\s*\(\)=> !!state\.mobileRecipeOnly,\s*\(v\)=> applyMobileRecipeMode\(!!v\)\s*\);/);
});

test("mobileRecipeOnly is a local device preference (like mobileTimelineOnly), saved to the session snapshot and preserved when applying a shared active job", () => {
  const snapshotPayload = functionBody("snapshotPayload");
  assert.match(snapshotPayload, /mobileRecipeOnly: !!state\.mobileRecipeOnly,/);

  const applyShared = functionBody("applySharedActiveJob");
  assert.match(applyShared, /mobileRecipeOnly: state\.mobileRecipeOnly,/);
});

test("applyPayload restores mobileRecipeOnly the same way it restores mobileTimelineOnly", () => {
  const applyPayload = functionBody("applyPayload");
  assert.match(applyPayload, /state\.mobileRecipeOnly = !!payload\.mobileRecipeOnly;/);
  assert.match(applyPayload, /applyMobileRecipeMode\(state\.mobileRecipeOnly\);/);
});

test("syncWorkspaceForViewport forces splitsBlock open and syncs the recipe chip too, not just the timeline one", () => {
  const body = functionBody("syncWorkspaceForViewport");
  assert.match(body, /if \(!desktop && state\.mobileRecipeOnly\)\{/);
  assert.match(body, /const splits = \$\("splitsBlock"\);/);
  assert.match(body, /syncToggleUI\("mobileRecipeToggle", state\.mobileRecipeOnly\);/);
});
