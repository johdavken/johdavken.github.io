"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");

function mediaBlockContaining(marker){
  const markerIndex = styles.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Expected CSS marker: ${marker}`);
  const start = styles.lastIndexOf("@media ", markerIndex);
  const open = styles.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < styles.length; index += 1){
    if (styles[index] === "{") depth += 1;
    if (styles[index] === "}") depth -= 1;
    if (depth === 0) return styles.slice(start, index + 1);
  }
  assert.fail(`Unclosed media query containing ${marker}`);
}

test("Compact Touch removes only Recipe's redundant outer card surface", () => {
  const block = mediaBlockContaining("Compact Touch Recipe surface");
  assert.match(block, /^@media \(width <= 700px\)\{/);
  assert.match(block, /body\[data-shell="touch"\]\[data-mobile-workspace="panel"\] #splitsBlock\.mobile-active,/);
  assert.match(block, /#splitsBlock\.mobile-active\[open\]\{[\s\S]*?padding:0;[\s\S]*?border:0;[\s\S]*?border-radius:0;[\s\S]*?background:transparent;[\s\S]*?box-shadow:none;/);
  assert.match(block, /#splitsBlock\.mobile-active > \.blockBody\{[\s\S]*?padding-right:0;[\s\S]*?padding-left:0;/);
  assert.doesNotMatch(block, /\.splitsMatrixFrame\s*\{/);
});

test("Compact Touch gives Recipe a modest page inset and preserves the matrix frame", () => {
  const block = mediaBlockContaining("Compact Touch Recipe surface");
  assert.match(block, /:has\(#splitsBlock\.mobile-active\) main\{[\s\S]*?padding-left:max\(12px, env\(safe-area-inset-left\)\);[\s\S]*?padding-right:max\(12px, env\(safe-area-inset-right\)\);/);
  assert.match(styles, /\.splitsMatrixFrame\{[\s\S]*?overflow:hidden;[\s\S]*?border:1px solid var\(--row-border\);[\s\S]*?border-radius:var\(--radius-row\);/);
});

test("mobile legal metadata is visible on Main and hidden on section screens", () => {
  assert.match(styles, /\.mobileFooterMeta\{display:none\}/);
  assert.match(styles, /body\[data-mobile-workspace="home"\] \.mobileFooterMeta\{[\s\S]*?position:fixed;[\s\S]*?display:flex;/);
  assert.doesNotMatch(styles, /body\[data-mobile-workspace="panel"\] \.mobileFooterMeta\{[^}]*display:flex/);
});
