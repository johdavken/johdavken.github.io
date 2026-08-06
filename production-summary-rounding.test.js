"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

const renderResinCalculator = functionBody("renderResinCalculator");

test("fmtLb truncates toward zero rather than rounding to nearest - operators enter pounds without decimals", () => {
  assert.match(app, /function fmtLb\(n\)\{ return Number\.isFinite\(n\) \? String\(Math\.floor\(n\)\) : "—"; \}/);
  // toFixed(0) would round 534.6 up to "535" - Math.floor is what actually
  // matches the requirement (534.6 -> 534, 1624.06 -> 1624).
  assert.equal(Math.floor(534.6), 534);
  assert.equal(Math.floor(1624.06), 1624);
});

test("Production Summary's totals line (Production/Scrap/Total) uses fmtLb, not the 2-decimal fmtNum", () => {
  const summaryBlock = renderResinCalculator.slice(
    renderResinCalculator.indexOf('sumEl.innerHTML'),
    renderResinCalculator.indexOf('const out = $("resinCalcResults")')
  );
  assert.match(summaryBlock, /Production: <span class="mono">\$\{fmtLb\(prod\)\}<\/span> lb/);
  assert.match(summaryBlock, /Scrap: <span class="mono">\$\{fmtLb\(scrap\)\}<\/span> lb/);
  assert.match(summaryBlock, /Total: <span class="mono">\$\{fmtLb\(total\)\}<\/span> lb/);
  assert.doesNotMatch(summaryBlock, /fmtNum\(prod/);
  assert.doesNotMatch(summaryBlock, /fmtNum\(scrap/);
  assert.doesNotMatch(summaryBlock, /fmtNum\(total/);
});

test("each per-resin allocated total also uses fmtLb, not fmtNum", () => {
  assert.match(renderResinCalculator, /<div class="mono calcValue">\$\{fmtLb\(r\.lbs\)\} lb<\/div>/);
  assert.doesNotMatch(renderResinCalculator, /fmtNum\(r\.lbs/);
});

test("fmtNum itself is unchanged - this only affects Production Summary's lb display, not the rest of the app", () => {
  assert.match(app, /function fmtNum\(n, d=2\)\{ return Number\.isFinite\(n\) \? n\.toFixed\(d\) : "—"; \}/);
});

// --- inputs must reflect restored state, not just write into it -----------
//
// The fields have no HTML default value (blank until typed), but a session
// restore / shared-job apply / Reset all changes state.prodResinLb directly -
// nothing previously wrote that back into the <input>'s own .value. Result:
// after a reload with a previously-entered amount, the field showed blank
// (looked untouched) while the stale number silently still counted toward
// the total, since renderResinCalculator's math reads state, not the DOM.

test("renderResinCalculator writes prod/scrap back into their own inputs, skipping whichever one currently has focus", () => {
  assert.match(renderResinCalculator, /const prodInput = \$\("prodResinLb"\);/);
  assert.match(renderResinCalculator, /if \(prodInput && document\.activeElement !== prodInput\) prodInput\.value = prod \? String\(prod\) : "";/);
  assert.match(renderResinCalculator, /const scrapInput = \$\("scrapResinLb"\);/);
  assert.match(renderResinCalculator, /if \(scrapInput && document\.activeElement !== scrapInput\) scrapInput\.value = scrap \? String\(scrap\) : "";/);
});

test("a zero value renders as blank (matching the no-default-value input), not a literal '0' string", () => {
  const syncLine = renderResinCalculator.match(/prodInput\.value = prod \? String\(prod\) : "";/)[0];
  assert.match(syncLine, /: "";$/, "falsy (0) must fall through to blank, not \"0\"");
});

test("Reset all no longer duplicates this write - it relies on rebuildUIFromState -> renderResinCalculator, the same path session restore uses", () => {
  const resetAll = functionBody("resetAll");
  assert.doesNotMatch(resetAll, /pr\.value = "0";/);
  assert.doesNotMatch(resetAll, /sr\.value = "0";/);
  assert.match(resetAll, /state\.prodResinLb = 0;/);
  assert.match(resetAll, /state\.scrapResinLb = 0;/);
  assert.match(resetAll, /rebuildUIFromState\(\);/);
});
