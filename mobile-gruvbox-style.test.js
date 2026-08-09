"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css","utf8");

test("Gruvbox light and dark receive mobile background and tile treatments",()=>{
  const mobileStart = styles.indexOf("@media (width <= 900px)");
  const mobileStyles = styles.slice(mobileStart);

  assert.match(mobileStyles,/body\[data-theme="gruvbox-dark"\]\{/);
  assert.match(mobileStyles,/body\[data-theme="gruvbox-light"\]\{/);
  assert.match(mobileStyles,/--gruv-mobile-surface:/);
  assert.match(mobileStyles,/data-mobile-background-style="layer-glow"/);
  assert.match(mobileStyles,/data-mobile-background-style="industrial-grid"/);
  assert.match(mobileStyles,/data-mobile-tile-style="minimal"/);
  assert.match(mobileStyles,/data-mobile-tile-style="accent"/);
});
