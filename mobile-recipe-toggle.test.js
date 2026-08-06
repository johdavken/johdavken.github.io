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
  assert.match(html, /<div id="mobileRecipeToggle" class="chipToggle statusRecipeToggle" role="switch" aria-checked="false" tabindex="0" aria-label="Recipe only" title="Hide everything except Recipe Setup">/);
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

// --- icon-only chips: no room for text at this width, so each chip must
// carry its meaning through icon shape + an aria-label, not visible text ---

function chipMarkup(id){
  const start = html.indexOf(`id="${id}"`);
  const divStart = html.lastIndexOf("<div", start);
  const divEnd = html.indexOf("</div>", start);
  return html.slice(divStart, divEnd);
}

test("neither chip has a visible text label - only an icon and an aria-label carry its meaning", () => {
  const timeline = chipMarkup("mobileTimelineToggle");
  const recipe = chipMarkup("mobileRecipeToggle");
  assert.match(timeline, /aria-label="Timeline only"/);
  assert.match(recipe, /aria-label="Recipe only"/);
  // Nothing but whitespace between the </svg> and the closing </div>.
  assert.match(timeline, /<\/svg>\s*$/);
  assert.match(recipe, /<\/svg>\s*$/);
});

test("the Timeline chip reuses the exact clock icon geometry from the hopper track buttons (app.js's clockIcon), not a new drawing", () => {
  assert.match(app, /clockFace\.setAttribute\("r", "8\.5"\);/);
  assert.match(app, /clockHands\.setAttribute\("d", "M12 7\.5v5l3\.5 2"\);/);
  const timeline = chipMarkup("mobileTimelineToggle");
  assert.match(timeline, /viewBox="0 0 24 24"/);
  assert.match(timeline, /<circle cx="12" cy="12" r="8\.5" stroke="currentColor" stroke-width="2"\/>/);
  assert.match(timeline, /<path d="M12 7\.5v5l3\.5 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"\/>/);
});

test("the Recipe chip uses an open-book icon", () => {
  const recipe = chipMarkup("mobileRecipeToggle");
  assert.match(recipe, /viewBox="0 0 16 16"/);
  assert.match(recipe, /M8 4\.2C6\.5 3 4\.5 2\.8 2\.8 3\.3/, "the open-book path");
});

test("chipToggle is a fixed-size round icon button now that there's no text to size around, and the active-state highlight rule is untouched", () => {
  const chipStart = styles.indexOf(".chipToggle{");
  const chipEnd = styles.indexOf("}", chipStart);
  const chipBody = styles.slice(chipStart, chipEnd);
  assert.match(chipBody, /width:28px;/);
  assert.match(chipBody, /height:28px;/);
  assert.match(chipBody, /justify-content:center;/);
  assert.match(styles, /\.chipToggle\.on\{/, "the existing on/off highlight must still apply - icon color alone now carries the active state");
});

test("the mobile status bar has a gap so adjacent icon-only controls (scan shortcut, timeline, recipe) aren't touching - easier to tap", () => {
  const mobileStart = styles.indexOf("@media (max-width:900px)");
  const barStart = styles.indexOf(".workspaceStatusBar{", mobileStart);
  const barEnd = styles.indexOf("}", barStart);
  const bar = styles.slice(barStart, barEnd);
  assert.match(bar, /gap:8px;/);
});

// --- desktop visibility regression ----------------------------------------
//
// .chipToggle and .statusTimelineToggle/.statusRecipeToggle apply to the
// same elements. .statusTimelineToggle{ display:none; } is unconditional;
// its mobile-only override to display:inline-flex lives inside the
// @media(max-width:900px) block further down. If .chipToggle ever declares
// its own `display`, that declaration - same specificity, later in the
// file - wins the cascade over display:none and shows the chips on desktop
// too. .chipToggle must never set display; visibility belongs entirely to
// the two mobile-only classes.

test("chipToggle does not declare display - that would win the cascade over statusTimelineToggle/statusRecipeToggle's display:none on desktop", () => {
  const chipStart = styles.indexOf(".chipToggle{");
  const chipEnd = styles.indexOf("}", chipStart);
  const chipBody = styles.slice(chipStart, chipEnd).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(chipBody, /\bdisplay:/, "a display here, even display:flex, would override the desktop-hidden rule below since it comes later in the file at equal specificity");
});

test("the desktop-hidden rule for both chips still comes strictly before .chipToggle in source order, and the mobile override still comes strictly after", () => {
  const timelineHiddenIndex = styles.indexOf(".statusTimelineToggle{ display:none; }");
  const recipeHiddenIndex = styles.indexOf(".statusRecipeToggle{ display:none; }");
  const chipToggleIndex = styles.indexOf(".chipToggle{");
  const mobileBlockIndex = styles.indexOf("@media (max-width:900px)");
  assert.ok(timelineHiddenIndex > -1 && timelineHiddenIndex < chipToggleIndex);
  assert.ok(recipeHiddenIndex > -1 && recipeHiddenIndex < chipToggleIndex);
  assert.ok(mobileBlockIndex > chipToggleIndex, "the mobile display:inline-flex override must come after .chipToggle so it's the one that ends up winning on mobile");
});
