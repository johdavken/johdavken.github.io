"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");

// On mobile, the 7+ top-level cards (Setup, Recipe Setup, Timeline, RT Sync,
// Line Configurations, Tools, Help, plus admin panels) stack vertically and
// each shows a title + a one-line subtitle while collapsed - a lot of
// visual noise before anything is even opened. The subtitle now only shows
// once a card is open, where it's actually useful, and the title itself
// gets a 25% size bump to carry more of the weight while collapsed.

function mobileBlock(){
  const start = styles.indexOf("@media (max-width:900px)");
  assert.notEqual(start, -1, "expected the mobile media query block");
  const end = styles.indexOf("\n}", start);
  return styles.slice(start, end);
}

test("the card title font-size bump is scoped to top-level card summaries only, not the generic .layerTitle class reused by dialogs/tool panels/admin forms", () => {
  const mobile = mobileBlock();
  assert.match(mobile, /\.workspaceContent > \.workspacePanel > summary \.layerTitle\{ font-size: calc\(var\(--title-size\) \* 1\.25\); \}/);
  // Guard against a future edit widening this to the bare class, which
  // would also resize every dialog/tool-panel/admin-form title on mobile.
  assert.doesNotMatch(mobile, /(?<!summary )\.layerTitle\{[^}]*font-size/);
});

test("the subtitle uses the base density token (25% larger than the un-scaled --title-size, not a hardcoded px value) so it still respects the user's chosen view density", () => {
  const mobile = mobileBlock();
  assert.match(mobile, /calc\(var\(--title-size\) \* 1\.25\)/);
});

test("the card subtitle is hidden by default on mobile and only reappears once that specific card is open", () => {
  const mobile = mobileBlock();
  assert.match(mobile, /\.workspaceContent > \.workspacePanel > summary \.layerMeta\{ display: none; \}/);
  assert.match(mobile, /\.workspaceContent > \.workspacePanel\[open\] > summary \.layerMeta\{ display: block; \}/);
});

test("the subtitle-hiding rule does not touch nested sub-panels like receiver-weights or the help topics - they aren't .workspacePanel and keep their own subtitle behavior", () => {
  const mobile = mobileBlock();
  assert.doesNotMatch(mobile, /\.workspaceContent > \.block > summary \.layerMeta/);
});
