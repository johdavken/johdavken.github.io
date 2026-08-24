"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");

test("the four production stages expose compact inactive metrics", () => {
  for (const id of [
    "desktopRailSetupMetric",
    "desktopRailRecipeMetric",
    "desktopRailTimelineMetric",
    "desktopRailTotalsMetric"
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(desktop, /> \.desktopRailMetric\{[\s\S]*?display:grid!important/);
  assert.match(styles, /\.desktopRailMetric,\s*\n\.desktopRailStageExpansion\{ display:none!important; \}/);
});

test("one valid sibling expansion follows the active stage instead of nesting buttons", () => {
  assert.equal((html.match(/id="desktopRailStageExpansion"/g) || []).length, 1);
  assert.match(app, /querySelector\(`\.workspaceNavButton\[data-workspace-target="\$\{id\}"\]`\)\?\.after\(expansion\)/);
  assert.match(app, /panel\.hidden = panel\.dataset\.railStage !== id/);
  assert.match(app, /expansion\.hidden = !primary/);
  assert.match(desktop, /\.desktopRailStageExpansion\{[\s\S]*?border-top:0;[\s\S]*?border-radius:0 0 12px 12px/);
  assert.match(desktop, /\.desktopRailStageExpansion\[hidden\]\{display:none!important\}/);
});

test("every primary stage has distinct live expansion content without duplicate controls", () => {
  for (const stage of ["lineSetupBlock", "splitsBlock", "resultsBlock", "productionSummaryBlock"]){
    assert.match(html, new RegExp(`data-rail-stage="${stage}"`));
    assert.match(app, new RegExp(`"${stage}"`));
  }
  assert.doesNotMatch(html, /desktopRailExpansionActions|data-desktop-rail-action/);
  assert.doesNotMatch(app, /hookDesktopRailActions|focusDesktopRailTarget/);
});

test("rail readouts reuse current setup, recipe, timeline, and totals render paths", () => {
  assert.match(app, /desktopRailSetupMetric/);
  assert.match(app, /desktopRailRecipeTracked/);
  assert.match(app, /desktopRailTimelineTime/);
  assert.match(app, /renderDesktopRailTotals\(\{ prod, scrap, total, rows \}\)/);
  assert.match(app, /hasPlannedRecipe\(\) \? "Planned" : "Not planned"/);
  assert.match(app, /state\.mobileTimelineAlarm \? "On" : "Off"/);
});

test("material names enter the rail through textContent, never HTML interpolation", () => {
  const start = app.indexOf("function renderDesktopRailTotals(summary)");
  const body = app.slice(start, app.indexOf("function renderResinCalculator()", start));
  assert.match(body, /name\.textContent = material\.displayName/);
  assert.doesNotMatch(body, /innerHTML/);
});

test("the redundant desktop dot-chevron is removed while mobile markup remains intact", () => {
  assert.match(desktop, /body \.workspaceNav \.mobileRailChev\{display:none!important\}/);
  assert.equal((html.match(/class="mobileRailChev"/g) || []).length >= 4, true);
});
