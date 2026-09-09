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

// Anchored on the block's own opening comment rather than on its @media
// header. Every touch block is now spelled identically - the shell boundary
// is one canonical string - so a header search selects whichever block
// happens to be last in the file, which is not this one. The comment is
// unique to the tile-home block these tests are about.
function mobileBlock(){
  const marker = styles.indexOf("/* Mobile workspace navigation is a tile home.");
  assert.notEqual(marker, -1, "expected the mobile tile-home block");
  const start = styles.lastIndexOf("@media", marker);
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
