"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");
const theme = fs.readFileSync("theme.css", "utf8");

// The Main screen's four numbered workflow tiles are theme-specific. Keep
// Gruvbox's existing palette intact while Dark and Industrial Slate each get
// their requested treatment without touching other workspace tiles.

test("Dark uses a dedicated restrained Recipe yellow, leaving the shared warning token alone", () => {
  const dark = theme.slice(theme.indexOf('[data-theme="dark"]'), theme.indexOf('[data-theme="light"]'));
  assert.match(dark, /--workflow-recipe: #d6a85f;/);
});

test("Industrial Slate Dark retains its dedicated Timeline blue", () => {
  const slateDark = theme.slice(theme.indexOf('[data-theme="industrial-slate-dark"]'), theme.indexOf('[data-theme="gruvbox-dark"]'));
  assert.match(slateDark, /--workflow-timeline: #7c9cd6;/);
});

test("Industrial Slate Light gives only the four numbered workflow tiles one muted slate-blue accent", () => {
  assert.match(styles, /body\[data-theme="industrial-slate"\] \.workspaceNavButton\[data-step\]\{ --tile-accent:var\(--yellow\); \}/);
  assert.match(styles, /body\[data-theme="industrial-slate"\] #productionSummaryBlock \.mobileSectionHeaderIcon\{color:var\(--yellow\)\}/);
});

test("the nav-button icons need no separate color rule - .workspaceTileIcon already reads --tile-accent, so recoloring the badge recolors the icon with it", () => {
  assert.match(styles, /\.workspaceTileIcon\{[^}]*color:var\(--tile-accent\)/);
});

test("Dark and Industrial Slate Dark match each workflow section header icon to its tile", () => {
  assert.match(styles, /body\[data-theme="dark"\] #splitsBlock \.mobileSectionHeaderIcon\{color:var\(--workflow-recipe\)\}/);
  assert.match(styles, /body\[data-theme="industrial-slate-dark"\] #splitsBlock \.mobileSectionHeaderIcon\{color:var\(--warn\)\}/);
  assert.match(styles, /body\[data-theme="industrial-slate-dark"\] #productionSummaryBlock \.mobileSectionHeaderIcon\{color:var\(--workflow-resin-totals\)\}/);
});

test("gruvbox's own rainbow override is untouched", () => {
  assert.match(styles, /body:is\(\[data-theme="gruvbox-dark"\],\[data-theme="gruvbox-light"\]\) \.workspaceNavButton\[data-workspace-target="lineSetupBlock"\]\{ --tile-accent:var\(--gruv-orange\); \}/);
  assert.match(styles, /body:is\(\[data-theme="gruvbox-dark"\],\[data-theme="gruvbox-light"\]\) \.workspaceNavButton\[data-workspace-target="resultsBlock"\]\{ --tile-accent:var\(--gruv-blue\); \}/);
});
