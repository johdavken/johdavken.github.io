"use strict";

/* The Station browser spec (tools/station-browser/) is a developer tool for
 * the flows the node suite cannot reach - foreignObject hit-testing, focus
 * crossing between HTML and SVG, the FLIP transition - in Chromium and
 * Firefox. These checks keep it a tool: outside the app, outside the
 * dependency list, and naming every flow the README promises.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const spec = fs.readFileSync(path.join(ROOT, "tools/station-browser/spec.js"), "utf8");
const readme = fs.readFileSync(path.join(ROOT, "tools/station-browser/README.md"), "utf8");

test("the browser spec is not loaded by any page and adds no dependency", () => {
  for (const page of ["index.html", "station/station.html"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, page), "utf8"), /station-browser/);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  for (const field of ["dependencies", "devDependencies"]) {
    assert.ok(!pkg[field] || !("playwright" in pkg[field]), `playwright must not be a ${field}`);
  }
  assert.match(spec, /process\.env\.PLAYWRIGHT_MODULE/, "the spec must take Playwright from outside the repo");
});

test("the spec runs Firefox as well as Chromium, and every documented flow is a named check", () => {
  assert.match(spec, /"chromium,firefox"/);
  for (const flow of [
    "fast click on the mixer opens with no prior hover",
    "fast click on a hopper selects it and its row",
    "fast click on a row selects it and its hopper",
    "transition reaches focused",
    "Escape mid-flight reverses to normal",
    "three rapid clicks end focused",
    "the cluster lands back on its normal position",
    "Enter on the value opens the search with the value selected",
    "ArrowDown moves the active option",
    "Enter chooses, closes, returns focus to the value",
    "Escape closes the search only",
    "Tab closes the search and moves on",
    "mousedown on the list does not close it",
    "top row: list below, fully hit-testable",
    "bottom row: list above, fully hit-testable",
    "every editor control hit-tests to itself",
    "hovering a row highlights its hopper",
    "hovering a hopper highlights its row",
    "the percentage field fits 60, 100 and 33.33",
    "no page scrollbar",
    "editor content fits its workspace"
  ]) {
    assert.ok(spec.includes(flow), `spec lacks the check "${flow}"`);
  }
  for (const viewport of ["1920, 1080", "1440, 900", "1160, 800"]) assert.ok(spec.includes(viewport), `spec lacks viewport ${viewport}`);
  for (const heading of ["Fast click before hover", "Open / close focus", "Resin search keyboard flow", "Result list placement", "Focused editor click targets", "Row <-> hopper linkage", "Percentage field", "Viewports"]) {
    assert.ok(readme.includes(heading), `README does not document "${heading}"`);
  }
});
