"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function rule(selector, from = styles){
  const start = from.indexOf(selector);
  assert.notEqual(start, -1, `expected to find ${selector}`);
  return from.slice(start, from.indexOf("}", start) + 1);
}

function desktopAssembly(){
  const start = app.indexOf('// Current/Next and Print are ordinary app buttons in the header.');
  const end = app.indexOf("\n      }\n\n      // Percentage problems", start);
  assert.ok(start > -1 && end > start, "expected desktop recipe action assembly");
  return app.slice(start, end);
}

test("Recipe Book is a primary Recipe page beside Current and Next", () => {
  const tabs = html.slice(html.indexOf('class="recipePageTabs"'), html.indexOf('</div>', html.indexOf('class="recipePageTabs"')));
  assert.match(tabs, /data-recipe-page="current">Current<\/button>[\s\S]*data-recipe-page="next">Next[\s\S]*data-recipe-page="saved" hidden>Recipe Book<\/button>/);
  assert.match(tabs, /id="recipePageTabSaved" role="tab" aria-selected="false" aria-controls="splitsArea"/);
});

test("desktop recipe actions live in the labelled header group and not a lower strip", () => {
  const desktop = desktopAssembly();
  assert.match(html, /class="recipeHeaderActions" id="recipeHeaderActions" role="group" aria-label="Recipe actions"/);
  assert.match(desktop, /if \(loadNextButton\) headerActions\?\.append\(loadNextButton\);/);
  assert.match(desktop, /if \(loadCurrentButton\) headerActions\?\.append\(loadCurrentButton\);/);
  assert.match(desktop, /headerActions\?\.append\(printButton\);/);
  assert.doesNotMatch(desktop, /recipeUtilityTabs/);
});

test("desktop action-strip controls stay quiet and keyboard-visible", () => {
  const tabsRule = rule(".recipeUtilityTabs{");
  assert.match(tabsRule, /border-bottom: 1px solid var\(--row-border\);/);
  assert.match(tabsRule, /display: flex;/);
  const actionRule = rule(".recipeUtilityTab{");
  assert.match(actionRule, /border: 1px solid transparent;/);
  assert.match(actionRule, /background: transparent;/);
  assert.match(actionRule, /font-size: var\(--font-tiny\);/);
  const focusRule = rule(".recipeUtilityTab:focus-visible{");
  assert.match(focusRule, /outline: 2px solid var\(--focus-border\);/);
});

test("immediate actions never gain tab semantics", () => {
  assert.doesNotMatch(app, /scanRecipeButton\.classList\.add\("recipeUtilityTab"\)/);
  assert.doesNotMatch(app, /printButton\.setAttribute\("role", "tab"\)/);
  assert.doesNotMatch(app, /loadNextButton\.setAttribute\("role", "tab"\)/);
  assert.doesNotMatch(app, /loadCurrentButton\.setAttribute\("role", "tab"\)/);
});

test("header view and recipe actions use the app's primary/secondary button families with a divider", () => {
  assert.match(html, /class="primary actionRail active"[^>]*data-recipe-view="summary"/);
  assert.match(html, /class="secondary"[^>]*data-recipe-view="edit"/);
  assert.match(app, /button\.classList\.toggle\("primary", active\);/);
  assert.match(app, /printButton\.classList\.add\("secondary", "recipeHeaderAction"\);/);
  assert.match(styles, /\.recipeHeaderActions\{[\s\S]*?border-left: 1px solid var\(--row-border-2\);/);
});

test("mobile keeps the same disclosure button and never receives desktop tab styling", () => {
  const start = app.indexOf("if (compactMobileRecipe){\n        mobilePrimaryRow = document.createElement");
  const end = app.indexOf("}else{", start);
  assert.ok(start > -1 && end > start);
  const mobile = app.slice(start, end);
  assert.match(mobile, /mobilePrimaryRow\.append\(savedRecipesButton, rearrangeButton\);/);
  assert.doesNotMatch(mobile, /recipeUtilityTab/);
  assert.doesNotMatch(mobile, /role", "tab/);
});

test("the Recipe Book panel occupies the matrix slot on tablet and desktop", () => {
  assert.match(styles, /body\[data-recipe-page="saved"\] #splitsArea > :not\(\.splitsSavedRecipesPanel\)\{\s*display: none!important;/);
  const panel = styles.slice(styles.indexOf('body[data-recipe-page="saved"] #splitsArea > .splitsSavedRecipesPanel{'));
  const panelRule = panel.slice(0, panel.indexOf("}") + 1);
  assert.match(panelRule, /display: block;/);
  assert.match(panelRule, /order: 0;/);
  assert.match(panelRule, /width: min\(100%, var\(--recipe-five-layer-rail, 1062px\)\);/);
  assert.match(panelRule, /min-height: 540px;/);
});
