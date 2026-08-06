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

// On mobile, the top-level cards (Setup, Recipe Setup, Timeline, RT Sync,
// Line Configurations, Tools, Help, and the admin panels) stack vertically
// with no shared accordion exclusivity - each <details> opens/closes on its
// own, so several can end up open at once and the page turns into a long
// scroll. Opening one now closes whichever other one was open, so only one
// card is ever expanded at a time on mobile. Desktop already shows a single
// panel through setWorkspacePanel's own .desktop-active mechanism and must
// stay untouched by this.

const hookMobileAccordion = functionBody("hookMobileAccordion");

test("hookMobileAccordion scopes to the same top-level panel group setWorkspacePanel already uses, not the nested help topics or the receiver-weights sub-panel", () => {
  assert.match(hookMobileAccordion, /document\.querySelectorAll\("\.workspaceContent > \.workspacePanel"\)/);
});

test("it only reacts when the toggled panel just opened, never when it closed - closing one must not touch the others", () => {
  assert.match(hookMobileAccordion, /if \(!panel\.open\) return;/);
});

test("it is gated to mobile width only - desktop's single-panel-at-a-time view comes from a different mechanism and must not be double-driven by this", () => {
  assert.match(hookMobileAccordion, /if \(!window\.matchMedia\("\(max-width: 900px\)"\)\.matches\) return;/);
});

test("it closes every other currently-open panel, never the one that was just opened", () => {
  assert.match(hookMobileAccordion, /panels\.forEach\(other=>\{ if \(other !== panel && other\.open\) other\.open = false; \}\);/);
});

test("it relies on the native toggle event, same as hookDetailsPersistence - no separate click handler that could fall out of sync with real <details> state", () => {
  assert.match(hookMobileAccordion, /panel\.addEventListener\("toggle", \(\)=>\{/);
});

test("hookMobileAccordion is actually wired up during init, alongside hookDetailsPersistence", () => {
  const initStart = app.indexOf("hookDetailsPersistence();");
  assert.notEqual(initStart, -1);
  const nearby = app.slice(initStart, initStart + 200);
  assert.match(nearby, /hookMobileAccordion\(\);/);
});

test("closing another panel goes through the real open property (not removeAttribute or a class toggle), so it still fires a native toggle event and hookDetailsPersistence's own listener still saves it", () => {
  assert.match(hookMobileAccordion, /other\.open = false;/);
  assert.doesNotMatch(hookMobileAccordion, /removeAttribute\("open"\)/);
});
