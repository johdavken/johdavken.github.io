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

// "Request beta access" is a .helpPlayBanner, not a .workspaceNavButton, but
// shares the expanded "Workspace & support" list with RT Sync / RT Notes /
// Tools / Changelog / Sudo access. The two themes that retune the mobile nav
// title colour (Gruvbox, Industrial Slate) must retune the banner's title the
// same way or it reads as a foreign row - Industrial Slate's near-black
// var(--text) on the pale slate ground was the visible bug.
test("the beta-access banner title tracks the same mobile nav-title colour as the other Workspace & support rows", () => {
  assert.match(
    styles,
    /body:is\(\[data-theme="gruvbox-dark"\],\[data-theme="gruvbox-light"\]\) \.helpPlayBanner strong\{ color:var\(--gruv-mobile-ink\); \}/
  );
  assert.match(
    theme,
    /:where\(html, body\)\[data-theme="industrial-slate"\] \.helpPlayBanner strong\{color:#607d9b\}/
  );
});

test("the beta-access title fix rides the same rule as the workspaceNavButton title, not a lone new selector", () => {
  // Kept in one selector list with .workspaceNavButton span so the two can
  // never drift apart on a future palette change.
  assert.match(
    styles,
    /body:is\(\[data-theme="gruvbox-dark"\],\[data-theme="gruvbox-light"\]\) \.workspaceNavButton span,\s*\n\s*body:is\(\[data-theme="gruvbox-dark"\],\[data-theme="gruvbox-light"\]\) \.helpPlayBanner strong\{ color:var\(--gruv-mobile-ink\); \}/
  );
  assert.match(
    theme,
    /:where\(html, body\)\[data-theme="industrial-slate"\] \.workspaceNavButton:not\(\.active\) span,\s*\n\s*:where\(html, body\)\[data-theme="industrial-slate"\] \.helpPlayBanner strong\{color:#607d9b\}/
  );
});
