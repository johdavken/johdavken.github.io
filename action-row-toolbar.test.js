"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("desktop recipe actions share the header with Summary and Edit", () => {
  const row = html.slice(html.indexOf('<div class="recipeHeaderRow">'), html.indexOf('id="splitsArea"'));
  assert.match(row, /id="recipeViewToggle"[\s\S]*id="recipeHeaderActions" role="group" aria-label="Recipe actions"/);
  assert.match(app, /if \(loadNextButton\) headerActions\?\.append\(loadNextButton\);/);
  assert.match(app, /if \(loadCurrentButton\) headerActions\?\.append\(loadCurrentButton\);/);
  assert.match(app, /headerActions\?\.append\(printButton\);/);
  assert.doesNotMatch(app, /area\.append\(recipeUtilityTabs\)/);
  assert.doesNotMatch(app, /area\.append\(modeBar\)/);
});

test("a divider separates view selection from recipe actions", () => {
  assert.match(styles, /\.recipeHeaderActions\{[\s\S]*?padding-left: 10px;[\s\S]*?border-left: 1px solid var\(--row-border-2\);/);
});

test("Summary and Edit retain compatibility classes while declaring toggle semantics", () => {
  assert.match(html, /class="primary actionRail active" data-button-kind="toggle" data-button-size="small" data-recipe-view="summary"/);
  assert.match(html, /class="secondary" data-button-kind="toggle" data-button-size="small" data-recipe-view="edit"/);
  assert.match(app, /button\.classList\.toggle\("primary", active\);/);
  assert.match(app, /button\.classList\.toggle\("actionRail", active\);/);
  assert.match(app, /button\.classList\.toggle\("secondary", !active\);/);
});

test("Load Current, Load Next, and Print use ordinary secondary button styling", () => {
  assert.match(app, /loadNextButton\.className = "secondary";/);
  assert.match(app, /loadCurrentButton\.className = "secondary";/);
  assert.match(app, /printButton\.classList\.add\("secondary", "recipeHeaderAction"\);/);
  assert.doesNotMatch(app, /loadNextButton\?\.classList\.add\("recipeUtilityTab"/);
  assert.doesNotMatch(app, /loadCurrentButton\?\.classList\.add\("recipeUtilityTab"/);
});

test("header actions retain the app's stroke-line icons", () => {
  const start = styles.indexOf(".recipeActionIcon{");
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /fill: none;/);
  assert.match(rule, /stroke: currentColor;/);
  assert.match(rule, /stroke-linecap: round;/);
  assert.match(rule, /stroke-linejoin: round;/);
});

test("phones retain their compact toolbar while tablets receive the full header actions", () => {
  assert.match(styles, /@media \(max-width: 700px\)\{\s*\.recipeHeaderActions\{ display: none; \}/);
  const touchLayoutStart = styles.indexOf("@media (max-width: 900px), (min-width: 901px) and (pointer: coarse){", styles.indexOf(".recipeHeaderActions{"));
  const phoneLayoutStart = styles.indexOf("@media (max-width: 700px){", touchLayoutStart);
  assert.ok(touchLayoutStart > -1 && phoneLayoutStart > touchLayoutStart);
  assert.doesNotMatch(styles.slice(touchLayoutStart, phoneLayoutStart), /\.recipeHeaderActions\{ display: none; \}/);
  assert.match(app, /mobilePrimaryRow\.append\(savedRecipesButton, rearrangeButton\);/);
  assert.match(app, /mobilePrimaryRow\.append\(mobileMoreButton\);/);
});
