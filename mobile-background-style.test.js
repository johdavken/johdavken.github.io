"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js","utf8");
const html = fs.readFileSync("index.html","utf8");
const styles = fs.readFileSync("styles.css","utf8");

test("mobile appearance offers eight persistent background choices",()=>{
  assert.match(html,/data-mobile-background-style="layer-glow"/);
  assert.match(html,/data-mobile-background-style="industrial-grid"/);
  for (const style of ["paper-grain", "dot-matrix", "blueprint", "contour-lines", "prism-fade", "pinstripe"]){
    assert.match(html,new RegExp(`data-mobile-background-style="${style}"`));
    assert.match(app,new RegExp(`"${style}"`));
  }
  assert.match(app,/mobileBackgroundStyle: "layer-glow"/);
  assert.match(app,/mobileBackgroundStyle: state\.mobileBackgroundStyle/);
  assert.match(app,/applyMobileBackgroundStyle\(payload\.mobileBackgroundStyle \|\| "layer-glow"\)/);
});

test("mobile backgrounds are scoped to the mobile breakpoint",()=>{
  const mobileStyles = styles.slice(styles.indexOf("@media (width <= 900px)"));
  assert.match(mobileStyles,/body\[data-mobile-background-style="layer-glow"\]/);
  assert.match(mobileStyles,/body\[data-mobile-background-style="industrial-grid"\]/);
  assert.match(mobileStyles,/body\[data-mobile-background-style="paper-grain"\]/);
  assert.match(mobileStyles,/body\[data-mobile-background-style="pinstripe"\]/);
});
