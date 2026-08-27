"use strict";

// The desktop rail's per-row status dot (previously styles.css:
// .workspaceNavButton > span::before, a small filled circle before the
// icon+title) is gone entirely now, on every theme. It used to be hidden
// outright for exactly four themes - gruvbox-dark, gruvbox-light,
// industrial-slate-dark, industrial-slate - by a leftover rule inside
// desktop.css's "Experimental Gruvbox desktop rail" block; restoring that
// for consistency (an earlier pass on this branch) surfaced the real
// problem it had been masking on those four themes alone: at this row's
// real width, a title like "RESIN TOTALS" or "TIMELINE" sharing its line
// with an icon and this dot had just enough width taken that it wrapped.
// Removed everywhere instead - the step-number badge and the coloured
// "small" status line beneath already carry the same status signal without
// costing the title row any width.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const desktop = fs.readFileSync("desktop.css", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("the status dot rule and its per-status colour variants are gone from styles.css", () => {
  assert.doesNotMatch(styles, /\.workspaceNavButton > span::before\{/);
  assert.doesNotMatch(styles, /\.workspaceNavButton\[data-status="info"\] > span::before\{/);
  assert.doesNotMatch(styles, /\.workspaceNavButton\[data-status="ok"\] > span::before\{/);
  assert.doesNotMatch(styles, /\.workspaceNavButton\[data-status="warn"\] > span::before\{/);
  assert.doesNotMatch(styles, /\.workspaceNavButton\[data-status="bad"\] > span::before\{/);
});

test("desktop.css carries no leftover reference to hiding or restoring it - the feature doesn't exist to hide", () => {
  assert.doesNotMatch(desktop, /span::before\{display:\s*none\}/);
  assert.doesNotMatch(desktop, /workspaceNavButton > span::before/);
});

test("the status signal survives elsewhere - the step-number badge and the small status line keep their own colouring, untouched", () => {
  assert.match(styles, /\.workspaceNavButton\[data-step\]::before\{[\s\S]*?background: var\(--tile-accent\);/);
  assert.match(styles, /\.workspaceNavButton\[data-status="info"\] small\{ color: var\(--focus-border\); \}/);
  assert.match(styles, /\.workspaceNavButton\[data-status="ok"\] small\{ color: var\(--ok\); \}/);
  assert.match(styles, /\.workspaceNavButton\[data-status="warn"\] small\{ color: var\(--warn\); \}/);
  assert.match(styles, /\.workspaceNavButton\[data-status="bad"\] small\{ color: var\(--bad\); \}/);
});

test("the four gruv-rail-grouped themes' block still exists for what it does own - tokens, base tile box, icon tinting", () => {
  const start = desktop.indexOf("/* Experimental Gruvbox desktop rail.");
  assert.notEqual(start, -1);
  const end = desktop.indexOf(
    'body:is([data-theme="gruvbox-dark"],[data-theme="gruvbox-light"],[data-theme="industrial-slate-dark"],[data-theme="industrial-slate"]) .workspaceNavButton small{'
  );
  assert.notEqual(end, -1);
  const block = desktop.slice(start, end);
  assert.match(block, /--gruv-rail-edge:#665c54;/);
  assert.match(
    block,
    /body:is\(\[data-theme="gruvbox-dark"\],\[data-theme="gruvbox-light"\],\[data-theme="industrial-slate-dark"\],\[data-theme="industrial-slate"\]\) \.workspaceNavButton > span\{/
  );
});
