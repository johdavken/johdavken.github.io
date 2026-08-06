"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");

// On mobile, collapsed top-level cards (Recipe Setup, Timeline, RT Sync,
// Help) each showed a status chip to the right of the title (e.g. "Check
// percentages", "0 resins tracked", "Local only", "Guide"). Requested
// removal of that chip on mobile only - desktop keeps its existing
// open-state pill behavior untouched.

function mobileBlock(){
  const start = styles.indexOf("@media (max-width:900px)");
  assert.notEqual(start, -1, "expected the mobile media query block");
  const end = styles.indexOf("\n}", start);
  return styles.slice(start, end);
}

test("the top-level card status chip is hidden on mobile", () => {
  const mobile = mobileBlock();
  assert.match(mobile, /\.workspaceContent > \.workspacePanel > summary \.pill\.summaryStatus\{ display: none !important; \}/);
});

test("the mobile chip-hiding rule does not touch the desktop open-state pill rule", () => {
  const desktopStart = styles.indexOf("@media (min-width: 901px)");
  assert.notEqual(desktopStart, -1);
  const desktopEnd = styles.indexOf("\n}", desktopStart);
  const desktop = styles.slice(desktopStart, desktopEnd);
  assert.match(desktop, /\.workspaceContent > details\.block\.workspacePanel\[open\] > summary \.pill\.summaryStatus\{ display: inline-flex; \}/);
});
