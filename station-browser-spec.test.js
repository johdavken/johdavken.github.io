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
  // It drives the real application host with a seeded session, so every
  // request that is not to the local server is aborted: nothing it types
  // can reach RT Sync or Supabase.
  assert.match(spec, /route\.request\(\)\.url\(\)\.startsWith\(BASE\) \? route\.continue\(\) : route\.abort\(\)/);
  assert.match(spec, /addInitScript\(/, "the host needs a seeded session to draw a line");
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
    "Enter chooses, applies through the application, closes, returns focus to the value",
    "the host offers editing",
    "harness: read-only throughout, the value reads, the search does not open, and the note says why",
    "Escape closes the search only",
    "Tab closes the search and moves on",
    "mousedown on the list does not close it",
    "top row: list below, fully hit-testable",
    "bottom row: list above, fully hit-testable",
    "every editor control hit-tests to itself",
    "hovering a row highlights its hopper",
    "hovering a hopper highlights its row",
    "the percentage field fits 60, 100 and 33.33",
    "the shell is header, stage, run-down timeline and status bar across the full width",
    "clicking B3's body tracks it through the application",
    "a control click neither selects the hopper nor opens the layer",
    "every tracked hopper wears one halo in its layer's colour",
    "clicking B1's receiver marks its pump off through the application",
    "under the pointer a stopped receiver comes part of the way back",
    "clicking the same place again marks the pump running",
    "the open layer's rows carry no tracking or pump control",
    "the drawn receiver in the open layer marks B2's pump off through the application",
    "the drawn body in the open layer tracks B3 and leaves the layer open",
    "harness: the hopper controls are read-only",
    "a press that does not travel is not a drag",
    "dragging a row marks it and the row under the pointer, with no text selected",
    "dropping moves the assignment through the application: row, bridge and legacy field agree, one history entry",
    "every drag mark is gone after the drop",
    "a press in the percentage field never becomes a drag",
    "Escape cancels a drag and leaves the layer open",
    "no page scrollbar",
    "editor content fits its workspace"
  ]) {
    assert.ok(spec.includes(flow), `spec lacks the check "${flow}"`);
  }
  for (const viewport of ["1920, 1080", "1440, 900", "1160, 800"]) assert.ok(spec.includes(viewport), `spec lacks viewport ${viewport}`);
  for (const heading of ["Fast click before hover", "Open / close focus", "Resin search keyboard flow", "Read-only harness", "Result list placement", "Focused editor click targets", "Row <-> hopper linkage", "Percentage field", "Hopper drag", "Viewports"]) {
    assert.ok(readme.includes(heading), `README does not document "${heading}"`);
  }
});
