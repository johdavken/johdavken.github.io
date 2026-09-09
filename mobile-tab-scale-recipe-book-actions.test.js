"use strict";

// ux-mobile-update1, two phone-only changes to the Recipe panel.
//
// 1) Tap scale. The tab strip stays welded to the divider beneath it and the
//    panel action keys (Scan / Load / pencil) still float above that line -
//    that relationship is deliberate and unchanged. What changes is that the
//    tabs are no longer a 32px strip under a 44px cluster: they are 48px, so
//    each tab's top edge lands level with the action keys. Because
//    .recipePageTabs' -1px bottom margin cancels its own 1px border-bottom, a
//    48px tab contributes exactly the 48px the action cluster already
//    contributed (44px key + its 4px margin-bottom) - the header row height,
//    and therefore #splitsArea below it, does not move. Both icon sets grow
//    25% into the room that buys.
//
// 2) Recipe Book. The panel drops its own card frame and sits directly on the
//    Recipe workspace surface the matrix already sits on, and the unlabelled
//    strip under the search divider becomes one row of station-console keys
//    acting on the selected recipe - the set each row used to carry in a Load
//    button plus a ⋯ menu, minus Favorite.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles, partContaining, cacheTagOf } = require("./css-source");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = readStyles();

// Anchored on this pass's own unique landmark rather than "the first
// @media (max-width: 700px){" - styles.css has several of those, and the
// first one is not the Recipe phone block.
function phoneRecipeBlock(){
  const landmark = styles.indexOf("#splitsBlock .recipePageTab{\n    min-height:48px;");
  assert.notEqual(landmark, -1, "the 48px phone tab rule is the landmark for this block");
  const start = styles.lastIndexOf("@media (max-width: 700px){", landmark);
  assert.notEqual(start, -1);
  return styles.slice(start, styles.indexOf("\n}\n", landmark));
}

function ruleFor(block, selector){
  const start = block.indexOf(selector + "{");
  assert.notEqual(start, -1, `expected a rule for ${selector}`);
  return block.slice(start, block.indexOf("}", start) + 1);
}

/* -------------------------------------------------------------------
 *   1) Tab tap scale
 * ------------------------------------------------------------------- */

test("phone tabs are 48px tall - level with the 44px action keys, not a short strip under them", () => {
  const rule = ruleFor(phoneRecipeBlock(), "#splitsBlock .recipePageTab");
  assert.match(rule, /min-height:48px;/);
});

test("the header row is not made taller: the action cluster still occupies 44px + a 4px margin, which the 48px tab exactly matches", () => {
  const block = phoneRecipeBlock();
  // The keys themselves are untouched by this pass - only the glyphs inside
  // them grew - so the row's other side still measures 44 + 4.
  const keys = ruleFor(block, "#splitsBlock .recipeHeaderActions > .mobileScanIconAction > summary,\n  #splitsBlock .recipeHeaderActions > .recipeHeaderMobileAction");
  assert.match(keys, /height:44px;/);
  assert.match(keys, /width:48px;/);
  assert.match(styles, /\.recipeHeaderControls\{flex:0 0 auto;margin-bottom:4px\}/);
  // And the strip's own -1px margin still cancels its border-bottom, which
  // is what makes a 48px tab cost 48px rather than 49px.
  assert.match(styles, /\.recipePageTabs\{[\s\S]*?margin: 0 0 -1px;[\s\S]*?border-bottom: 1px solid var\(--row-border\);/);
});

test("tab glyphs grow 25%, 17px -> 21px", () => {
  const rule = ruleFor(phoneRecipeBlock(), "#splitsBlock .recipePageTab .recipeTabIcon svg");
  assert.match(rule, /width:21px;/);
  assert.match(rule, /height:21px;/);
  assert.doesNotMatch(rule, /(?:width|height):17px;/);
});

test("panel action glyphs grow 25% too - 16px -> 20px for Scan/Load, 15px -> 19px for the Edit pencil - while their 48x44 keys stay put", () => {
  const block = phoneRecipeBlock();
  const glyph = ruleFor(block, "#splitsBlock .recipeHeaderActions .recipeActionIcon");
  assert.match(glyph, /width:20px;/);
  assert.match(glyph, /height:20px;/);
  const pencil = ruleFor(block, '#splitsBlock #recipeHeaderActionPill .recipeViewToggle button[data-recipe-view="edit"]::before,\n  #splitsBlock #recipeHeaderControls .weightsHeaderViewToggle button[data-weight-view="edit"]::before');
  assert.match(pencil, /width:19px;/);
  assert.match(pencil, /height:19px;/);
});

test("narrow phones trim the tab's side padding only - never its height or its glyph - so four tabs plus the Next page's three keys still fit at 360px", () => {
  const start = styles.indexOf("@media (max-width: 384px){");
  assert.notEqual(start, -1);
  const narrow = styles.slice(start, styles.indexOf("\n}\n", start));
  assert.match(narrow, /#splitsBlock \.recipePageTab\{ padding-inline:7px; \}/);
  assert.doesNotMatch(narrow, /min-height/);
  assert.doesNotMatch(narrow, /recipeTabIcon/);
  // Top-level, not nested inside the <=700px block: styles.css has no nested
  // media queries, and helpers in other tests find a rule's block by scanning
  // back to the nearest "@media ", which a nested one would hijack.
  const phoneBlockStart = styles.lastIndexOf("@media (max-width: 700px){", start);
  assert.ok(styles.indexOf("\n}\n", phoneBlockStart) < start, "the <=700px block closes before this one opens");
});

test("the planned-recipe dot stays an absolutely positioned corner badge, retargeted onto the taller tab's glyph", () => {
  const rule = ruleFor(phoneRecipeBlock(), "#splitsBlock .recipePageTab .recipePageTabDot");
  assert.match(rule, /position:absolute;/);
  assert.match(rule, /top:12px;/);
  assert.match(rule, /right:7px;/);
});

test("desktop/tablet tab sizing is untouched - the base rule still reads 30px, and the >=701px touch overrides still read 32px/28px", () => {
  assert.match(styles, /\.recipePageTab\{\n  position: relative;\n  min-height: 30px;/);
  assert.match(styles, /body\[data-shell="touch"\] #splitsBlock \.recipePageTab\{\n    min-height:32px;/);
  assert.match(styles, /body\[data-shell="touch"\] #splitsBlock \.recipePageTab\{\n    min-height:28px;/);
});

/* -------------------------------------------------------------------
 *   2) Recipe Book: no card frame on phones
 * ------------------------------------------------------------------- */

test("the phone Recipe Book drops its own border/radius/fill and sits directly on the #splitsArea surface, but keeps a small inline inset off that surface's edge", () => {
  const rule = ruleFor(phoneRecipeBlock(), 'body[data-recipe-page="saved"] #splitsArea > .splitsSavedRecipesPanel');
  assert.match(rule, /padding:0 8px;/, "frame gone, breathing room kept - rows/dividers/keys never touch the surface edge");
  assert.match(rule, /border:0;/);
  assert.match(rule, /border-radius:0;/);
  assert.match(rule, /background:transparent;/);
});

test("the base card treatment survives for every wider layout - only the phone page opts out", () => {
  assert.match(styles, /\.splitsSavedRecipesPanel\{\n  padding: 10px;\n  border: 1px solid var\(--row-border\);\n  border-radius: var\(--radius-row\);\n  background: var\(--readonly-bg\);\n\}/);
});

/* -------------------------------------------------------------------
 *   2) Recipe Book: the consolidated action row
 * ------------------------------------------------------------------- */

function savedPanelMarkup(){
  const start = app.indexOf("savedRecipesPanel.innerHTML = `");
  assert.notEqual(start, -1);
  return app.slice(start, app.indexOf("`;", start));
}

test("the action row is built into the panel in the slot the unlabelled status strip used to hold - above the status, above the list", () => {
  const markup = savedPanelMarkup();
  const actions = markup.indexOf('id="mobileSavedRecipesActions"');
  const status = markup.indexOf('id="mobileSavedRecipesStatus"');
  const list = markup.indexOf('id="mobileSavedRecipesList"');
  assert.ok(actions > -1 && status > actions && list > status, "actions, then status, then list");
  // The status element itself is kept: it is the only place a "no workspace"
  // / "service unavailable" message can be reported on this surface.
  assert.match(markup, /<div id="mobileSavedRecipesStatus" class="mobileSavedRecipesStatus" role="status" hidden><\/div>/);
});

test("it carries Load / Update / Rename / Duplicate / Delete, disabled until a recipe is selected, and no Favorite", () => {
  const markup = savedPanelMarkup();
  const row = markup.slice(markup.indexOf('id="mobileSavedRecipesActions"'), markup.indexOf("</div>", markup.indexOf('id="mobileSavedRecipesActions"')));
  for (const [id, label] of [
    ["mobileSavedRecipeLoadAction", "Load"],
    ["mobileSavedRecipeUpdateAction", "Update"],
    ["mobileSavedRecipeRenameAction", "Rename"],
    ["mobileSavedRecipeDuplicateAction", "Duplicate"],
    ["mobileSavedRecipeDeleteAction", "Delete"],
  ]){
    const re = new RegExp(`<button id="${id}" type="button"[^>]*disabled>${label}</button>`);
    assert.match(row, re, `${id} is present and starts disabled`);
  }
  assert.doesNotMatch(row, /Favorite/i, "Favorite is not offered on this surface any more");
  assert.match(row, /class="danger"[^>]*>Delete</, "Delete is the one destructive key");
});

test("wireMobileSavedRecipeActions points every key at the current selection and disables them all when there is none", () => {
  const start = app.indexOf("function wireMobileSavedRecipeActions(");
  assert.notEqual(start, -1);
  const fn = app.slice(start, app.indexOf("\n  function renderMobileSavedRecipeRows(", start));
  assert.match(fn, /const selectedItem=items\.find\(item=>item\.id===selectedWorkspaceConfigurationId\) \|\| null;/);
  assert.match(fn, /button\.disabled=!selectedItem;/);
  // .onclick, not addEventListener - this runs on every render.
  assert.match(fn, /button\.onclick=\(\)=>\{ if\(selectedItem\) handler\(selectedItem\); \};/);
  assert.match(fn, /bind\("mobileSavedRecipeLoadAction",item=>previewWorkspaceConfiguration\(item\)\);/);
  assert.match(fn, /bind\("mobileSavedRecipeUpdateAction",item=>openWorkspaceConfigurationDialog\("update",item\)\);/);
  assert.match(fn, /bind\("mobileSavedRecipeRenameAction",item=>openWorkspaceConfigurationDialog\("rename",item\)\);/);
  assert.match(fn, /bind\("mobileSavedRecipeDuplicateAction",item=>openWorkspaceConfigurationDialog\("duplicate",item\)\);/);
  // Delete still confirms before it mutates.
  assert.match(fn, /bind\("mobileSavedRecipeDeleteAction",item=>\{ if\(confirm\(`Delete shared configuration “\$\{item\.name\}”\?`\)\) mutateWorkspaceConfiguration\("delete",item\); \}\);/);
  assert.doesNotMatch(fn, /"favorite"/);
});

test("it is wired from renderMobileSavedRecipeRows, so the two no-workspace / no-service early returns in renderSplitsSavedRecipes also re-disable the keys", () => {
  const start = app.indexOf("function renderMobileSavedRecipeRows(items,syncState){");
  const fn = app.slice(start, app.indexOf("\n  function renderMobileWeightProfileRows(", start));
  assert.match(fn, /wireMobileSavedRecipeActions\(items\);/);
  const render = app.slice(app.indexOf("function renderSplitsSavedRecipes("), app.indexOf("function wireSetupWeightProfileActions("));
  const noWorkspace = render.match(/renderMobileSavedRecipeRows\(\[\],syncState\)/g) || [];
  assert.equal(noWorkspace.length, 2, "both early returns still redraw the phone list with an empty item set");
});

test("a phone recipe row is now nothing but a selection target - no per-row Load button, no per-row ⋯ menu", () => {
  const start = app.indexOf("function renderMobileSavedRecipeRows(items,syncState){");
  const fn = app.slice(start, app.indexOf("\n  function renderMobileWeightProfileRows(", start));
  assert.match(fn, /\n      row\.append\(choose\);\n/);
  assert.doesNotMatch(fn, /mobileSavedRecipeLoad"/);
  assert.doesNotMatch(fn, /mobileSavedRecipeOverflow/);
  assert.doesNotMatch(fn, /mobileSavedRecipeMenu/);
  // The star still renders and favourites still sort first - only the
  // toggle went away on this surface.
  assert.match(fn, /mobileSavedRecipeFavorite/);
  assert.match(fn, /Number\(!!b\.favorite\)-Number\(!!a\.favorite\)/);
});

test("the receiver weight profile sheet keeps its own per-row Load / ⋯ - it shares .mobileSavedRecipeRow but not this change", () => {
  const start = app.indexOf("function renderMobileWeightProfileRows(items,syncState){");
  assert.notEqual(start, -1);
  const fn = app.slice(start, start + 4000);
  assert.match(fn, /load\.className="mobileSavedRecipeLoad";/);
  assert.match(fn, /overflow\.className="mobileSavedRecipeOverflow";/);
});

/* -------------------------------------------------------------------
 *   2) Recipe Book: action row styling and scoping
 * ------------------------------------------------------------------- */

test("the action row is a five-up grid of station-console keys, using the same tokens as the Recipe header keys", () => {
  const block = phoneRecipeBlock();
  const grid = ruleFor(block, ".splitsSavedRecipesPanel #mobileSavedRecipesActions");
  assert.match(grid, /display:grid;/);
  assert.match(grid, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\);/);
  const key = ruleFor(block, ".splitsSavedRecipesPanel #mobileSavedRecipesActions > button");
  assert.match(key, /background:var\(--btnstyle-surface\);/);
  assert.match(key, /color:var\(--btnstyle-ink\);/);
  assert.match(key, /box-shadow:0 1px 0 var\(--btnstyle-edge\);/);
  assert.match(key, /border-radius:var\(--control-radius\);/);
  // button.danger is uppercased globally; one shouting key in a row of five
  // reads as a different kind of control.
  assert.match(key, /text-transform:none;/);
  const danger = ruleFor(block, ".splitsSavedRecipesPanel #mobileSavedRecipesActions > button.danger");
  assert.match(danger, /color:var\(--btnstyle-danger\);/);
  assert.match(danger, /background:var\(--btnstyle-surface\);/, "danger ink on the console surface, not a solid red fill");
});

test("the line between the actions and the list is an ordinary 1px divider, owned by the action row and matching the search field's own underline", () => {
  const rule = ruleFor(phoneRecipeBlock(), ".splitsSavedRecipesPanel #mobileSavedRecipesActions");
  assert.match(rule, /border-bottom:1px solid var\(--row-border-2\);/);
  assert.match(rule, /padding-bottom:9px;/);
  // Same token the search field's underline uses - the global input rule
  // strips that field to a bottom border, the colour comes from here.
  assert.match(styles, /\.mobileSavedRecipesSearch input\{[\s\S]*?border: 1px solid var\(--row-border-2\);/);
});

test("the status stops impersonating that divider - plain muted text in this panel, no fill, no radius, no 28px band", () => {
  const block = phoneRecipeBlock();
  // Its own rule, not the display:revert group that also names this id.
  const start = block.indexOf("\n  .splitsSavedRecipesPanel #mobileSavedRecipesStatus{\n");
  assert.notEqual(start, -1);
  const rule = block.slice(start, block.indexOf("}", start) + 1);
  assert.match(rule, /padding:0;/);
  assert.match(rule, /border-radius:0;/);
  assert.match(rule, /background:transparent;/);
  assert.match(rule, /color:var\(--muted\);/);
  // Still a message element, still hidden when there is none.
  assert.doesNotMatch(rule, /display:/);
  assert.match(app, /<div id="mobileSavedRecipesStatus" class="mobileSavedRecipesStatus" role="status" hidden><\/div>/);
});

test("the receiver weight profile sheet keeps the filled chip treatment - it is the same class, but outside .splitsSavedRecipesPanel", () => {
  assert.match(styles, /\.mobileSavedRecipesStatus\{padding:7px 8px;margin-bottom:6px;border-radius:8px;background:var\(--focus-ring\);/);
  assert.match(app, /<div id="mobileWeightProfilesStatus" class="mobileSavedRecipesStatus" role="status" hidden><\/div>/);
});

test("with nothing selected the keys stay in place and read inert - the row never collapses and shifts the list under the operator", () => {
  const rule = ruleFor(phoneRecipeBlock(), ".splitsSavedRecipesPanel #mobileSavedRecipesActions > button:disabled");
  assert.match(rule, /opacity:\.42;/);
  assert.match(rule, /cursor:default;/);
  assert.doesNotMatch(rule, /display:\s*none/);
});

test("rows drop to a single grid column, scoped to the recipe list so the weight-profile sheet's three-column rows are untouched", () => {
  const block = phoneRecipeBlock();
  assert.match(block, /#mobileSavedRecipesList \.mobileSavedRecipeRow\{ grid-template-columns:minmax\(0,1fr\); \}/);
  assert.match(styles, /\.mobileSavedRecipeRow\{position:relative;display:grid;grid-template-columns:minmax\(0,1fr\) auto auto;/);
});

test("the action row is phone-only: hidden with the other phone-only pieces at wider widths, and never added to their display:revert group (it needs a grid)", () => {
  assert.match(styles, /\.splitsSavedRecipesPanel \.mobileSavedRecipesSearch,\n\.splitsSavedRecipesPanel #mobileSavedRecipesActions,\n\.splitsSavedRecipesPanel #mobileSavedRecipesList,\n\.splitsSavedRecipesPanel #mobileSavedRecipesStatus\{ display: none; \}/);
  const block = phoneRecipeBlock();
  const revert = block.slice(block.indexOf(".splitsSavedRecipesPanel .mobileSavedRecipesSearch,"), block.indexOf("{ display: revert; }"));
  assert.doesNotMatch(revert, /mobileSavedRecipesActions/);
});

test("desktop Recipe Book is untouched - it keeps its title-row Load/Update and its ⋯ menu, Favorite included", () => {
  const markup = savedPanelMarkup();
  const bar = markup.slice(markup.indexOf('<div class="splitsSavedRecipesActions">'), markup.indexOf('<label class="mobileSavedRecipesSearch">'));
  assert.match(bar, /<button id="splitsLoadRecipe" class="primary" type="button" disabled>Load<\/button>/);
  assert.match(bar, /<button id="splitsUpdateRecipe" class="secondary" type="button" disabled>Update<\/button>/);
  assert.match(bar, /<button id="splitsFavoriteRecipe" type="button" class="secondary">Favorite<\/button>/);
  assert.match(bar, /<button id="splitsDeleteRecipe" type="button" class="danger">Delete<\/button>/);
});

/* -------------------------------------------------------------------
 *   Cache busting - both files changed
 * ------------------------------------------------------------------- */

test("styles.css and app.js carry bumped ?v= query strings so a returning device does not run the old pair", () => {
  // The base stylesheet is eleven parts now, so pinning a literal version
  // against a file called styles.css no longer describes anything. Ask which
  // part carries the rule and require that part to be versioned. Whether a
  // changed part's tag actually moved is enforced for every part on every
  // change by css-cache-tags.test.js, which is stronger than one literal here.
  const part = partContaining(".recipePageTab{");
  assert.ok(part, "no stylesheet part carries the .recipePageTab rule any more");
  assert.ok(cacheTagOf(part), `${part} is linked without a ?v= cache tag`);
  // app.js is still one file, so its original pin still means what it meant.
  const js = html.match(/app\.js\?v=([\d.]+)/);
  assert.ok(js);
  assert.notEqual(js[1], "0.25.5");
});
