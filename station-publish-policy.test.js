"use strict";

/* The boot file's publish policy (station/station.js): what a bridge
 * publish does to the stage and the focused editor.
 *
 * station.js is a self-starting IIFE over a browser document, so it is
 * held to its policy at source level here; the behaviour it composes is
 * tested where it lives - render.patchStage in station-render.test.js,
 * classifyChange in station-source.test.js, the editor's update() in
 * station-focus-editor.test.js - and end to end in the browser spec.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const boot = fs.readFileSync(path.join(ROOT, "station/station.js"), "utf8");

function body(name) {
  const at = boot.indexOf(`function ${name}(`);
  assert.ok(at > -1, `${name} is not defined`);
  return boot.slice(at, boot.indexOf("\n  }\n", at) + 4);
}

/* ----------------------------------------------------------------------
 *   The two kinds of state
 * -------------------------------------------------------------------- */

test("transient interaction state is declared beside canonical state, and named for what it is", () => {
  assert.match(boot, /let focus = null;/);
  assert.match(boot, /let highlighted = null;/);
  assert.match(boot, /let editing = null;/);
  assert.match(boot, /let lastOwnRevision = null;/);
  assert.match(boot, /let editorHandle = null;/);
  // The record's shape is documented where it is declared.
  const doc = boot.slice(boot.indexOf("TWO KINDS OF STATE"), boot.indexOf("let editing = null;"));
  for (const field of ["recipe", "layer", "index", "hopper", "slot", "mode", "draft", "baseRevision", "baseValue"]) {
    assert.ok(doc.includes(field), `the editing record's ${field} is not documented`);
  }
  assert.match(doc, /recipe: current \| next/);
  assert.match(doc, /slot: resin \| pct \| source/);
  assert.match(doc, /mode: search \| typing/);
});

test("the editing record is stamped by Station with the recipe it addresses and the revision it began at", () => {
  const draw = body("drawStage");
  assert.match(draw, /onEditing: record => \{/);
  assert.match(draw, /recipe: "current"/);
  assert.match(draw, /baseRevision: current\.resolved \? current\.resolved\.revision : null/);
  // A render replaces the editor, so no control can still be active.
  assert.match(draw, /editing = null;/);
  assert.match(draw, /editorHandle = editor;/);
  assert.match(draw, /commands: commandsFor\(current\.resolved\),/, "the editor is not handed the command bridge for discovery");
});

test("commands are on offer only for the live source: demo data pinned in the host stays read-only", () => {
  /* The application connects the executor whatever Station shows. A write
   * against the live recipe while a demo line is on screen would change a
   * real recipe under a drawing of a demo one, so discovery is gated on
   * the resolved source being live. */
  const gate = body("commandsFor");
  assert.match(gate, /return commands && resolved && resolved\.live \? commands : null;/);
});

/* ----------------------------------------------------------------------
 *   The publish policy
 * -------------------------------------------------------------------- */

test("a publish goes through the policy, never straight to a full render", () => {
  assert.match(boot, /bridge\?\.subscribe\(\(\) => \{ onPublish\(\); \}\);/);
  assert.doesNotMatch(boot, /subscribe\(\(\) => \{ renderAll\(\); \}\)/);
  assert.equal((boot.match(/\.subscribe\(/g) || []).length, 1, "a second subscription appeared");
});

test("the policy classifies first, patches a value change in place, and renders only a structural one", () => {
  const publish = body("onPublish");
  assert.match(publish, /const kind = source\.classifyChange\(current\.resolved, resolved\);/);
  assert.match(publish, /if \(kind === "none"\) \{ current = \{ model, resolved \}; return; \}/);

  const values = publish.slice(publish.indexOf('if (kind === "values"'), publish.indexOf("return;", publish.indexOf('if (kind === "values"')));
  assert.match(values, /render\.patchStage\(mounts\.machine, model, \{/);
  assert.match(values, /editorHandle\.update\(\{ hopperState: resolved\.hopperState \}\)/);
  assert.match(values, /applyHighlight\(\);/);
  assert.match(values, /syncSelection\(\);/);
  assert.doesNotMatch(values, /renderAll\(\)|stage\.refresh\(|mountStage\(|focusEditor\.create\(/,
    "the value path rebuilds the stage or the editor");

  const structural = publish.slice(publish.indexOf("const abandoned = editing;"));
  assert.match(structural, /renderAll\(\);/);
  assert.match(structural, /changed underneath you; what you were entering for \$\{abandoned\.hopper\} was not applied/);
  assert.match(structural, /editorHandle\.note\(message\)/);
});

test("the value path is refused while the open layer is gone or a transition is in flight", () => {
  const publish = body("onPublish");
  assert.match(publish, /const openLayerGone = !!shown && \(!model \|\| !model\.layers\.some\(layer => layer\.id === shown\)\);/);
  assert.match(publish, /kind === "values" && !openLayerGone && stage\.getState\(\)\.phase !== "opening" && stage\.getState\(\)\.phase !== "closing"/);
  // Patched against the layout the DOM shows, not the one a flight is heading for.
  assert.match(publish, /const shown = stage\.getState\(\)\.shown;/);
});

test("the renderer's patch path leaves the workspace alone", () => {
  const render = fs.readFileSync(path.join(ROOT, "station/station-render.js"), "utf8");
  const at = render.indexOf("function patchStage(");
  const patch = render.slice(at, render.indexOf("\n  }\n", at));
  assert.doesNotMatch(patch, /workspace\(|foreignObject|focus-workspace|clear\(mount\)|appendChild\(svg\)/);
  assert.match(patch, /parts\.hopper\(doc, /, "a changed hopper is drawn by the same builder that drew it");
  assert.match(patch, /parts\.hopperStateKey\(runtime\)/);
  assert.match(patch, /cluster\.replaceChild\(fresh, old\)/);
});

/* ----------------------------------------------------------------------
 *   Still read-only
 * -------------------------------------------------------------------- */

test("Station discovers commands and never dispatches or connects one in this step", () => {
  assert.match(boot, /const commands = root\.PolynStationCommandBridge \|\| null;/);
  assert.doesNotMatch(boot, /\.dispatch\s*\(/, "station.js dispatches a command");
  assert.doesNotMatch(boot, /commands\.connect|PolynStationCommandBridge\.connect/, "station.js connects a producer");
  // lastOwnRevision is declared for the shape and never written in this phase.
  assert.equal((boot.match(/lastOwnRevision\s*=/g) || []).length, 1, "lastOwnRevision is written; no command can have produced a revision yet");
});
