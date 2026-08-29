"use strict";

// Phone Recipe panel: the four page tabs (Current / Next / Weights / Recipe
// Book) show an icon instead of their text label, and Scan + the page's own
// Load action fold up into the same tab row as icon-only buttons beside the
// Edit/Done pencil - replacing the action bar that used to sit below the
// matrix. Print is desktop-only. Behaviour is unchanged: same ids, same
// role="tab", same handlers; only the visual label swaps to an icon and
// the text label stays in the a11y tree.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function tabsMarkup(){
  const start = html.indexOf('<div class="recipePageTabs"');
  const end = html.indexOf("</div>", start);
  assert.ok(start > -1 && end > start);
  return html.slice(start, end);
}

function mobileBlock(){
  // Everything from the shared @media (max-width: 700px) block through the
  // rest of the phone-width rules (up to the next, wider breakpoint).
  const start = styles.indexOf("@media (max-width: 700px){");
  assert.notEqual(start, -1);
  const end = styles.indexOf("@media (max-width: 720px){", start);
  assert.notEqual(end, -1);
  return styles.slice(start, end);
}

/* -------------------------------------------------------------------
 *   Tab markup: every tab carries both a label and an icon
 * ------------------------------------------------------------------- */

test("each page tab has a .recipeTabLabel and an aria-hidden .recipeTabIcon, ids/roles unchanged", () => {
  const tabs = tabsMarkup();
  for (const [id, page, label] of [
    ["recipePageTabCurrent", "current", "Current"],
    ["recipePageTabNext", "next", "Next"],
    ["recipePageTabWeights", "weights", "Hopper Weights"],
    ["recipePageTabSaved", "saved", "Recipe Book"],
  ]){
    const re = new RegExp(`id="${id}"[^>]*data-recipe-page="${page}"[^>]*>`);
    assert.match(tabs, re, `${id} keeps its id/role/data-recipe-page`);
  }
  assert.match(tabs, /<span class="recipeTabLabel">Current<\/span><span class="recipeTabIcon" aria-hidden="true"><svg/);
  assert.match(tabs, /<span class="recipeTabLabel">Next<\/span><span class="recipeTabIcon" aria-hidden="true"><svg/);
  assert.match(tabs, /<span class="recipeTabLabel"><span class="recipeWeightsTabFull">Hopper Weights<\/span>/);
  assert.match(tabs, /<span class="recipeTabLabel">Recipe Book<\/span><span class="recipeTabIcon" aria-hidden="true"><svg/);
});

test("the Next tab keeps its planned-recipe dot after the icon", () => {
  const tabs = tabsMarkup();
  assert.match(tabs, /data-recipe-page="next">[\s\S]*?<span class="recipeTabIcon"[\s\S]*?<\/span><span class="recipePageTabDot" id="recipePageTabNextDot" hidden/);
});

/* -------------------------------------------------------------------
 *   CSS: label <-> icon swap only kicks in on phones
 * ------------------------------------------------------------------- */

test("desktop shows the label and hides the icon; phones clip the label and show the icon", () => {
  assert.match(styles, /\.recipeTabIcon\{ display:none; \}/);
  const block = mobileBlock();
  assert.match(block, /#splitsBlock \.recipePageTab \.recipeTabLabel\{[\s\S]*?clip-path:inset\(50%\);/);
  assert.match(block, /#splitsBlock \.recipePageTab \.recipeTabIcon\{\s*\n\s*display:inline-flex;/);
  assert.match(block, /#splitsBlock \.recipePageTab \.recipeTabIcon svg\{[\s\S]*?stroke:currentColor;/);
});

test("the label is clipped, never display:none - it stays the tab's accessible name", () => {
  const block = mobileBlock();
  const rule = block.slice(block.indexOf("#splitsBlock .recipePageTab .recipeTabLabel{"), block.indexOf("}", block.indexOf("#splitsBlock .recipePageTab .recipeTabLabel{")));
  assert.doesNotMatch(rule, /display:\s*none/);
});

/* -------------------------------------------------------------------
 *   The icon action cluster (Scan / Load / Edit) in the tab row
 * ------------------------------------------------------------------- */

test("#recipeHeaderActions is a flex icon row pulled left of the pencil (order:-1) on phones - not force-hidden", () => {
  const block = mobileBlock();
  assert.match(block, /#splitsBlock \.recipeHeaderRow \.recipeHeaderActions\{\s*\n\s*display:flex;\s*\n\s*order:-1;/);
  assert.doesNotMatch(styles, /@media \(max-width: 700px\)\{\s*\.recipeHeaderActions\{ display: none; \}/);
});

test("Recipe Book gets no cluster; desktop Weights keeps its inline panel - only phone Weights fills #recipeHeaderActions", () => {
  const sync = app.slice(app.indexOf("function syncRecipePageUI("), app.indexOf("function setRecipePage("));
  // Recipe Book always hidden; Weights hidden only on desktop (phone uses
  // the slot for its profiles icon).
  assert.match(sync, /headerActions\.hidden = isSavedRecipesPage\(\) \|\| \(isWeightsPage\(\) && isDesktopLayout\(\)\)/);
  const block = mobileBlock();
  assert.match(block, /#splitsBlock \.recipeHeaderRow \.recipeHeaderActions\[hidden\]\{ display:none!important; \}/);
  assert.match(block, /#splitsBlock \.recipeHeaderRow \.recipeHeaderActions:empty\{ display:none; \}/);
});

test("Scan and Load are square icon-only buttons; Edit/Done collapses to its pencil ::before", () => {
  const block = mobileBlock();
  assert.match(block, /#splitsBlock \.recipeHeaderActions > \.mobileScanIconAction > summary,\s*\n\s*#splitsBlock \.recipeHeaderActions > \.recipeHeaderMobileAction\{[\s\S]*?font-size:0;/);
  assert.match(block, /#splitsBlock \.recipeHeaderActions \.recipeActionIcon\{\s*\n\s*display:block;/);
  assert.match(block, /#recipeHeaderActionPill \.recipeViewToggle button\[data-recipe-view="edit"\],[\s\S]*?\{[\s\S]*?font-size:0;/);
  // The Hopper Weights page's own Summary/Edit toggle collapses the same way.
  assert.match(block, /#recipeHeaderControls \.weightsHeaderViewToggle button\[data-weight-view="edit"\]/);
});

test("no Print on mobile - it is only appended in the desktop header branch", () => {
  assert.doesNotMatch(styles, /mobilePrintIconAction/);
  const editor = app.slice(app.indexOf("function renderSplitsArea(){"), app.indexOf("function renderResinCalculator(){"));
  const compact = editor.slice(editor.indexOf("if (compactMobileRecipe){"), editor.indexOf("}else{", editor.indexOf("if (compactMobileRecipe){")));
  assert.doesNotMatch(compact, /printButton/);
  const desktop = editor.slice(editor.indexOf("}else{", editor.indexOf("if (compactMobileRecipe){")));
  assert.match(desktop, /headerActions\?\.append\(printButton\);/);
});
