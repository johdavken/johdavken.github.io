"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function rule(selector, from = styles){
  const start = from.indexOf(selector);
  assert.notEqual(start, -1, `expected to find ${selector}`);
  return from.slice(start, from.indexOf("}", start) + 1);
}

/* ============================================================
 *   Desktop only: Saved recipes / Bulk edit / Rearrange present as a
 *   second, visually subordinate tab strip beneath the grid, echoing
 *   .recipePageTabs above it - exactly one of their three panels is ever
 *   open, using the same mutual exclusion that already lived in each
 *   button's own click handler before this refactor.
 * ============================================================ */

test(".recipeUtilityTabs mirrors .recipePageTabs' document-tab mechanism, quieter and attached to its own divider beneath the grid", () => {
  const tabsRule = rule(".recipeUtilityTabs{");
  assert.match(tabsRule, /border-bottom: 1px solid var\(--row-border\);/);
  assert.match(tabsRule, /display: flex;/);
  const tabRule = rule(".recipeUtilityTab{");
  assert.match(tabRule, /border: 1px solid transparent;/);
  assert.match(tabRule, /border-bottom: 0;/);
  assert.match(tabRule, /background: transparent;/);
  assert.match(tabRule, /color: var\(--muted\);/);
  // Smaller than .recipePageTab (font-small) - visually subordinate to the
  // primary Current/Next tabs, not competing with them.
  assert.match(tabRule, /font-size: var\(--font-tiny\);/);
});

test("the active utility tab grows out of the divider into the panel below it - same box-shadow seam trick as .recipePageTab.active, in the panel's readonly-bg tone", () => {
  const activeRule = rule(".recipeUtilityTab.active{");
  assert.match(activeRule, /border-color: var\(--row-border\);/);
  assert.match(activeRule, /background: var\(--readonly-bg\);/);
  assert.match(activeRule, /box-shadow: 0 1px 0 0 var\(--readonly-bg\);/);
  // The open panel (.splitsBulkBar or .splitsSavedRecipesPanel) already
  // uses this exact background - see the merge rule below - so the two
  // read as one continuous surface.
  assert.match(rule(".splitsBulkBar{"), /background: var\(--readonly-bg\);/);
  assert.match(rule(".splitsSavedRecipesPanel{"), /background: var\(--readonly-bg\);/);
});

test("no dramatic shadows/glows/animations on the utility tabs, and disabled (e.g. Rearrange with nothing assigned yet) reads as quiet, not styled like the active tab", () => {
  const tabsBlock = styles.slice(styles.indexOf(".recipeUtilityTabs{"), styles.indexOf(".splitsBulkBar,\n.splitsSavedRecipesPanel"));
  assert.doesNotMatch(tabsBlock, /animation:/);
  assert.doesNotMatch(tabsBlock, /transition:/);
  const disabledRule = rule(".recipeUtilityTab:disabled{");
  assert.match(disabledRule, /opacity: \.45;/);
  assert.match(disabledRule, /cursor: not-allowed;/);
});

test("keyboard accessible: a visible focus outline distinct from the active/hover styling", () => {
  const focusRule = rule(".recipeUtilityTab:focus-visible{");
  assert.match(focusRule, /outline: 2px solid var\(--focus-border\);/);
});

test("the open panel is pulled flush against the tab strip's own divider (closing #splitsArea's grid gap), not left floating with a visible gap beneath the tabs", () => {
  const mergeRule = rule(".splitsBulkBar,\n.splitsSavedRecipesPanel{");
  assert.match(mergeRule, /margin-top: -7px;/);
  // Neutralized inside the mobile bulk-edit sheet, where .splitsBulkBar is
  // physically relocated and must not inherit a desktop-grid-specific
  // offset that has nothing to sit flush against there.
  const mobileSheetRule = rule(".mobileBulkEditSheet .splitsBulkBar{");
  assert.match(mobileSheetRule, /margin-top:0;/);
});

test("the action row (Scan/Print/Load Next/Info) always renders last, below whichever utility panel is open, regardless of DOM append order", () => {
  const orderRule = rule("#splitsArea > .splitsBulkModeBar{");
  assert.match(orderRule, /order:2;/);
  assert.match(orderRule, /justify-self: start;/);
  const panelOrderRule = rule("#splitsArea > .recipeUtilityTabs,");
  assert.match(panelOrderRule, /order:1; position:static;/);
});

test("the utility tab strip's left inset is nudged to 6px (matching #splitsArea's own row gap) instead of .recipePageTabs' 2px, so its left edge sits closer to the open panel below", () => {
  const tabsRule = rule(".recipeUtilityTabs{");
  assert.match(tabsRule, /padding: 0 2px 0 6px;/);
});

test("Saved Recipes/Bulk Edit/Rearrange share a min-height so switching between them doesn't jump the rest of the Recipe panel by a different amount each time", () => {
  const selector = "#splitsArea > .splitsBulkBar,\n#splitsArea > .splitsSavedRecipesPanel,\n#splitsArea > .rearrangeModeBar{";
  const firstStart = styles.indexOf(selector);
  const secondStart = styles.indexOf(selector, firstStart + 1);
  assert.notEqual(secondStart, -1, "expected a second, distinct rule sharing this selector list (the order:1 rule is the first)");
  const minHeightRule = styles.slice(secondStart, styles.indexOf("}", secondStart) + 1);
  assert.match(minHeightRule, /min-height: 216px;/);
});

/* ============================================================
 *   JS: role=tab/aria-selected wiring is desktop-only - mobile keeps its
 *   existing aria-expanded disclosure-button semantics untouched, since
 *   the same real button elements are reused in both trees.
 * ============================================================ */

test("rearrangeButton becomes a role=tab with aria-selected only on desktop; mobile keeps its original aria-expanded", () => {
  const creationStart = app.indexOf('const rearrangeButton=document.createElement("button");');
  const creationEnd = app.indexOf("function finishRearrangement", creationStart);
  const block = app.slice(creationStart, creationEnd);
  assert.match(block, /if \(compactMobileRecipe\)\{\s*\n\s*rearrangeButton\.setAttribute\("aria-expanded", String\(!!hopperRearrangement\?\.active\)\);\s*\n\s*\}else\{/);
  assert.match(block, /rearrangeButton\.classList\.remove\("secondary"\);/);
  assert.match(block, /rearrangeButton\.classList\.add\("recipeUtilityTab"\);/);
  assert.match(block, /rearrangeButton\.setAttribute\("role", "tab"\);/);
  assert.match(block, /rearrangeButton\.setAttribute\("aria-selected", String\(!!hopperRearrangement\?\.active\)\);/);
});

test("setSavedRecipesOpen keeps mobile's aria-expanded path untouched and only adds aria-selected/.active on its desktop tail", () => {
  const start = app.indexOf("function setSavedRecipesOpen(open){");
  const end = app.indexOf("\n      }", start);
  const body = app.slice(start, end);
  const compactBranch = body.slice(0, body.indexOf("return;"));
  assert.match(compactBranch, /savedRecipesButton\.setAttribute\("aria-expanded",String\(open\)\);/);
  assert.doesNotMatch(compactBranch, /aria-selected/);
  const desktopTail = body.slice(body.indexOf("return;"));
  assert.match(desktopTail, /savedRecipesButton\.setAttribute\("aria-selected", String\(open\)\);/);
  assert.match(desktopTail, /savedRecipesButton\.classList\.toggle\("active", open\);/);
});

test("setBulkMode keeps mobile's aria-expanded path untouched and only adds aria-selected/.active on desktop", () => {
  const start = app.indexOf("function setBulkMode(enabled){");
  const end = app.indexOf("\n      }", start);
  const body = app.slice(start, end);
  assert.match(body, /if\(compactMobileRecipe\)\{\s*\n\s*modeButton\.setAttribute\("aria-expanded", String\(bulkMode\)\);/);
  assert.match(body, /\}else\{\s*\n\s*modeButton\.setAttribute\("aria-selected", String\(bulkMode\)\);\s*\n\s*modeButton\.classList\.toggle\("active", bulkMode\);\s*\n\s*\}/);
});

test("mutual exclusion between the three utility panels is untouched by this refactor - each button's own click handler still closes the other two", () => {
  // Saved recipes closes bulk edit and cancels rearrange.
  const savedClickStart = app.indexOf('savedRecipesButton.addEventListener("click", ()=>{');
  const savedClickBody = app.slice(savedClickStart, app.indexOf("setSavedRecipesOpen(turningOn);", savedClickStart));
  assert.match(savedClickBody, /hopperRearrangement = null;/);
  assert.match(savedClickBody, /setBulkMode\(false\);/);
  // Bulk edit closes saved recipes and cancels rearrange.
  const modeClickStart = app.indexOf('modeButton.addEventListener("click",()=>{');
  const modeClickBody = app.slice(modeClickStart, app.indexOf("setBulkMode(turningOn);", modeClickStart));
  assert.match(modeClickBody, /hopperRearrangement = null;/);
  assert.match(modeClickBody, /setSavedRecipesOpen\(false\);/);
  // Rearrange closes both.
  const rearrangeClickStart = app.indexOf('rearrangeButton.addEventListener("click",()=>{');
  const rearrangeClickBody = app.slice(rearrangeClickStart, app.indexOf("renderSplitsArea();", rearrangeClickStart));
  assert.match(rearrangeClickBody, /splitsBulkModeActive = false;/);
  assert.match(rearrangeClickBody, /splitsSavedRecipesOpen = false;/);
});

test("each button already closes its own panel when clicked again while active - unchanged toggle semantics, just relabelled as a tab visually", () => {
  const savedClickStart = app.indexOf('savedRecipesButton.addEventListener("click", ()=>{');
  const savedClickBody = app.slice(savedClickStart, app.indexOf("});", savedClickStart));
  assert.match(savedClickBody, /const turningOn = savedRecipesPanel\.classList\.contains\("hide"\);/);
  const modeClickStart = app.indexOf('modeButton.addEventListener("click",()=>{');
  const modeClickBody = app.slice(modeClickStart, app.indexOf("});", modeClickStart));
  assert.match(modeClickBody, /const turningOn = !bulkMode;/);
  const rearrangeClickStart = app.indexOf('rearrangeButton.addEventListener("click",()=>{');
  const rearrangeClickBody = app.slice(rearrangeClickStart, app.indexOf("});", rearrangeClickStart));
  assert.match(rearrangeClickBody, /if\(hopperRearrangement\?\.active\)\{\s*\n\s*finishRearrangement\(false\);\s*\n\s*return;\s*\n\s*\}/);
});

/* ============================================================
 *   Immediate actions (Scan/Print/Load Next/Info) are not tabs
 * ============================================================ */

test("Scan Recipe, Print Recipe, Load Next Recipe and Info stay plain buttons/details, never gaining the tab classes or role", () => {
  assert.doesNotMatch(app, /scanRecipeButton\.classList\.add\("recipeUtilityTab"\)/);
  assert.doesNotMatch(app, /printButton\.classList\.add\("recipeUtilityTab"\)/);
  assert.doesNotMatch(app, /loadNextButton\.classList\.add\("recipeUtilityTab"\)/);
  assert.doesNotMatch(app, /recipeInfo\.setAttribute\("role", "tab"\)/);
});

/* ============================================================
 *   Mobile stays untouched: no desktop-only classes ever get applied
 *   inside the compact assembly branch.
 * ============================================================ */

test("mobilePrimaryRow's own assembly never references .recipeUtilityTab or role=tablist - that wiring is confined to the desktop else-branch", () => {
  const start = app.indexOf("if (compactMobileRecipe){\n        mobilePrimaryRow = document.createElement");
  const end = app.indexOf("}else{", start);
  assert.ok(start > -1 && end > start);
  const mobileBlock = app.slice(start, end);
  assert.doesNotMatch(mobileBlock, /recipeUtilityTab/);
  assert.doesNotMatch(mobileBlock, /role", "tab/);
  assert.doesNotMatch(mobileBlock, /tablist/);
});
