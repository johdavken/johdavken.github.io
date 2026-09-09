"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles } = require("./css-source");

const styles = readStyles();

test("Gruvbox light and dark receive mobile background and tile treatments",()=>{
  // Anchored on the first rule of the block these assertions live in; the
  // shell boundary is one canonical header now, so searching for the header
  // selects the first touch block in the file rather than this one.
  const mobileStart = styles.lastIndexOf(
    "@media", styles.indexOf("#weightsArea{ display:grid; gap:10px; }"));
  const mobileStyles = styles.slice(mobileStart);

  assert.match(mobileStyles,/body\[data-theme="gruvbox-dark"\]\{/);
  assert.match(mobileStyles,/body\[data-theme="gruvbox-light"\]\{/);
  assert.match(mobileStyles,/--gruv-mobile-surface:/);
  assert.match(mobileStyles,/data-mobile-background-style="layer-glow"/);
  assert.match(mobileStyles,/data-mobile-background-style="industrial-grid"/);
  assert.match(mobileStyles,/data-mobile-tile-style="minimal"/);
  assert.match(mobileStyles,/data-mobile-tile-style="accent"/);
});
