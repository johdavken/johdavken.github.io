"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const app = fs.readFileSync("app.js","utf8");
const html = fs.readFileSync("index.html","utf8");
const styles = fs.readFileSync("styles.css","utf8");

test("Minimal is the fixed mobile tile treatment",()=>{
  assert.match(app,/mobileTileStyle: "minimal"/);
  assert.match(app,/function applyMobileTileStyle\(value\)\{\s*const style = "minimal";/);
  assert.doesNotMatch(html,/data-mobile-tile-style=/);
  assert.match(styles,/One fixed Minimal destination language/);
  assert.match(styles,/border-bottom:1px solid color-mix/);
});
