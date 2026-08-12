"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const app = fs.readFileSync("app.js","utf8");
const html = fs.readFileSync("index.html","utf8");
const styles = fs.readFileSync("styles.css","utf8");

test("background selection UI is retired and old stored values resolve to theme-native",()=>{
  assert.doesNotMatch(html,/data-mobile-background-style=/);
  assert.match(app,/function applyMobileBackgroundStyle\(value\)\{\s*const style = "theme-native";/);
  assert.match(app,/applyMobileBackgroundStyle\("theme-native"\)/);
});

test("the three retained themes receive restrained native backgrounds",()=>{
  for (const theme of ["industrial-slate","industrial-slate-dark","gruvbox-dark"]){
    assert.match(styles,new RegExp(`body\\[data-theme="${theme}"\\]\\[data-mobile-background-style="theme-native"\\]`));
  }
});
