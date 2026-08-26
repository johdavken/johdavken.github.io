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
  assert.match(styles, /\.desktopRailMetric\{ display:none!important; \}/);
});

// Output/Changeover moved to the always-visible status bar and the Layers
// picker moved into Recipe's own header (see recipe-rail-line-controls.test.js
// for both), which removed the only content that made a sibling expansion
// panel worth having - every stage is now a plain nav row that opens its
// real content in the main panel, nothing else.
test("no stage owns a sibling expansion panel any more", () => {
  assert.doesNotMatch(html, /desktopRailStageExpansion|desktopRailExpansionPanel|desktopRailRecipeSetupControls/);
  assert.doesNotMatch(desktop, /desktopRailStageExpansion|desktopRailExpansionPanel|desktopRailRecipeSetupControls|desktopRailExpansionMetrics|desktopRailMaterialPreview|desktopRailMaterialRow|desktopRailTimelineTime/);
  assert.doesNotMatch(app, /syncDesktopRailExpansion|desktopRailPrimaryStages|desktopRailRecipeDetail|desktopRailSetupHeadline|desktopRailSetupDetail|desktopRailSetupOutput|desktopRailSetupChangeover|desktopRailTimelineTracked|desktopRailTimelineAlarm|desktopRailTotalsHeadline|desktopRailTotalsDetail|desktopRailMaterialPreview/);
});

test("the active nav row is a plain highlight, not a shape that blends into a panel below it", () => {
  assert.match(desktop, /body \.workspaceNav \.workspaceNavButton\[data-step\]\.active\{\s*\n\s*border:1px solid color-mix\(in srgb,var\(--tile-accent\) 58%,var\(--border\)\);\s*\n\s*border-left:3px solid var\(--tile-accent\);\s*\n\s*border-radius:12px;/);
  // No half-open corner or dropped bottom border left over from blending
  // into an expansion panel that no longer exists.
  assert.doesNotMatch(desktop, /border-radius:12px 12px 0 0/);
  assert.doesNotMatch(desktop, /\.active > \.desktopRailMetric\{display:none!important\}/);
});

test("rail readouts reuse current setup, recipe, timeline, and totals render paths", () => {
  assert.match(app, /desktopRailSetupMetric/);
  assert.match(app, /desktopRailRecipeMetric/);
  assert.match(app, /function renderDesktopRailTotals\(summary\)\{\s*\n\s*const \{ total, rows \} = summary;/);
});

test("Resin Totals' two readouts report different things, not the same count twice", () => {
  const start = app.indexOf("function renderDesktopRailTotals(summary)");
  const body = app.slice(start, app.indexOf("function renderResinCalculator()", start));
  // The metric badge is the material count; the status line used to repeat
  // that exact count as "N materials" - now it reports total weight instead.
  assert.match(body, /metric\.textContent = String\(count\)/);
  assert.match(body, /status\.textContent = total > 0 \? `\$\{fmtLb\(total\)\} lb total` : "No material total"/);
  assert.doesNotMatch(body, /\$\{count\} \$\{count === 1 \? "material" : "materials"\}/);
});

test("the redundant desktop dot-chevron is removed while mobile markup remains intact", () => {
  assert.match(desktop, /body \.workspaceNav \.mobileRailChev\{display:none!important\}/);
  assert.equal((html.match(/class="mobileRailChev"/g) || []).length >= 4, true);
});
