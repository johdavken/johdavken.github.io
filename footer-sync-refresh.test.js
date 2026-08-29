"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("RT Sync refresh is removed from the footer", () => {
  assert.doesNotMatch(index, /cloudSyncFooterStatus|lineSyncMobileStatus|<span>Refresh<\/span>/);
  assert.doesNotMatch(app, /cloudSyncFooterStatus|lineSyncMobileStatus/);
});

test("the RT Sync panel retains its reconnect action", () => {
  assert.match(index, /id="lineSyncRetryBtn"/);
  assert.match(app, /\$\("lineSyncRetryBtn"\)\?\.addEventListener\("click",\(\)=>runLineSyncAction/);
});

test("the compact footer is a five-cell rail: Display / Back / Main / Forward / Alerts", () => {
  const refinement = styles.slice(styles.lastIndexOf("/* Compact footer:"));
  assert.match(refinement, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
});
