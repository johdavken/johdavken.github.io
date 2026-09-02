"use strict";

// The desktop sidebar (.workspaceNav) is given a fixed, often-tall height
// (100dvh - 24px) with overflow:auto. It used to be a CSS grid, where grid's
// default align-content (normal -> stretch) distributed leftover height across
// every auto-sized row - most visibly the near-empty More/divider row, which
// ballooned from ~33px past 75px - so the rule carried align-content:start to
// pin rows to their own size. It is now a flex column instead: children are
// flex:0 0 auto so they keep their natural size, and the single growing
// element is .workspaceNavFooter's margin-top:auto, which floats the
// version/divider/Dashboard block to the rail foot and absorbs the leftover
// height in one place rather than spreading it across every row.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const desktop = fs.readFileSync("desktop.css", "utf8");

test("the shared desktop .workspaceNav rule keeps rows at their own size instead of stretching to fill the sidebar", () => {
  const start = desktop.indexOf("  .workspaceNav{\n    position:sticky;");
  assert.notEqual(start, -1);
  const block = desktop.slice(start, desktop.indexOf("\n  }", start));
  assert.match(block, /height:calc\(100dvh - 24px\);/);
  assert.match(block, /overflow:auto;/);
  // Flex column + non-growing children: no row can stretch to eat slack.
  assert.match(block, /display:flex;\s*\n\s*flex-direction:column;/);
  assert.match(desktop, /\.workspaceNav > \*\{ flex:0 0 auto; \}/);
  // The one place leftover height is allowed to collect.
  assert.match(desktop, /\.workspaceNavFooter\{\s*\n\s*margin-top:auto;/);
});

test("the four gruv-rail-grouped themes do not re-introduce a stretching .workspaceNav", () => {
  const start = desktop.indexOf("/* Experimental Gruvbox desktop rail.");
  assert.notEqual(start, -1);
  const end = desktop.indexOf("\n  }", start);
  const groupedRule = desktop.slice(start, end);
  // Confirm this is really the theme-grouped .workspaceNav override.
  assert.match(
    groupedRule,
    /body:is\(\[data-theme="gruvbox-dark"\],\[data-theme="gruvbox-light"\],\[data-theme="industrial-slate-dark"\],\[data-theme="industrial-slate"\]\) \.workspaceNav\{/
  );
  // It only restyles the surface (background/border), never re-declares the
  // layout model, so the shared flex-column rule above still governs sizing.
  assert.doesNotMatch(groupedRule, /display:grid|align-content:|flex-direction:/);
});

test("the shared .workspaceNav rule carries the layout model once - not duplicated elsewhere in the file", () => {
  const occurrences = (desktop.match(/\.workspaceNav\{[^}]*flex-direction:column;/g) || []).length;
  assert.equal(occurrences, 1);
});
