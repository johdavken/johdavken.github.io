"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const sync = fs.readFileSync("cloud-sync.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("mobile tile icons are 25% larger in both normal and minimal tile treatments", () => {
  assert.match(styles, /\.workspaceTileIcon\{\s*width:calc\(34px \* 1\.25\);\s*height:calc\(34px \* 1\.25\);/);
  assert.match(styles, /mobile-tile-style="minimal"\] \.workspaceTileIcon\{ width:calc\(30px \* 1\.25\); height:calc\(30px \* 1\.25\);/);
});

test("the pre-existing tile options and themed backgrounds remain available", () => {
  assert.match(html, /data-mobile-tile-style="accent"><span><\/span>Color accent/);
  assert.match(html, /data-mobile-tile-style="solid"><span><\/span>Color fill/);
  assert.match(styles, /body\[data-mobile-background-style="industrial-grid"\]\{/);
  assert.doesNotMatch(styles, /--mobile-home-night:#16233a/);
});

test("the shared receiver-weight guidance explains conservative usable weight and Smart Hopper inputs", () => {
  assert.match(html, /Enter a conservative usable weight to prevent running out early\./);
  assert.match(html, /<strong>Smart Hoppers<\/strong>/);
  assert.match(html, /usable height \(base to fill valve\)/);
  assert.match(html, /resin-specific weight/);
});

test("mobile RT Sync explains joining only, while desktop retains its create-or-join guidance", () => {
  assert.match(sync, /\? "Join a line when ready\."\s*:\s*"Create or join a line when ready\."/);
});

test("on mobile Recipe Setup, the Smart badge follows the resin input rather than the hopper number", () => {
  assert.match(app, /if \(window\.matchMedia\("\(max-width: 900px\)"\)\.matches\) \{\s*cellTop\.appendChild\(smartBadge\);/);
  assert.match(styles, /\.splitCellTop \.splitSmartBadge\{ flex:0 0 auto; \}/);
});

test("mobile weights place the Smart guide and receiver weight profiles below the hopper grid", () => {
  assert.match(app, /area\.appendChild\(matrix\);\s*if \(smartLegend\) area\.appendChild\(smartLegend\);/);
  assert.match(app, /weightsBody\.appendChild\(profilesBlock\)/);
  assert.match(styles, /#weightsBlock > \.blockBody > #setupWeightProfilesBlock/);
});
