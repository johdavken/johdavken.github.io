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
  // The recipe the editor addresses is named once, explicitly, and is what
  // both the editing record and every command carry - never inherited from
  // the hidden Recipe editor's page.
  assert.match(draw, /const recipe = "current";/);
  assert.match(draw, /\n\s+recipe,\n/, "the editor is not told which recipe its commands address");
  assert.match(draw, /Object\.assign\(\{\n\s+recipe,\n/, "the editing record is not stamped with the recipe");
  assert.doesNotMatch(draw, /recipeEditHistoryKey|recipePageTab|activePage/);
  assert.match(draw, /baseRevision: current\.resolved \? current\.resolved\.revision : null/);
  // A render replaces the editor, so no control can still be active.
  assert.match(draw, /editing = null;/);
  assert.match(draw, /editorHandle = editor;/);
  assert.match(draw, /commands: commandsFor\(current\.resolved\),/, "the editor is not handed the command bridge");
});

test("a command's answer runs the same publish policy, marked as Station's own, and records the revision it produced", () => {
  const draw = body("drawStage");
  const at = draw.indexOf("onCommitted: result => {");
  assert.ok(at > -1, "the editor is not told what to do with a command's result");
  const committed = draw.slice(at, draw.indexOf("\n      }", at));
  assert.match(committed, /lastOwnRevision = Number\.isInteger\(result\.revision\) \? result\.revision : null;/);
  assert.match(committed, /onPublish\(\{ own: true \}\);/);
  // Nothing else: no patching of its own, no second render path, no note.
  assert.doesNotMatch(committed, /patchStage|renderAll|editorHandle|mountStage|note\(/);
  // And the boot file writes lastOwnRevision there, and in the other
  // places a command's answer arrives - a cluster control's toggle, the
  // header's job controls' onCommitted, a Blend Edit card's onCommitted
  // (the same editor, compact), the layer share editor's onCommitted, and
  // the rail's Reset Tracking - which run the identical two lines.
  assert.equal((boot.match(/lastOwnRevision\s*=/g) || []).length, 8, "lastOwnRevision is written somewhere other than its declaration, the editor's and the cards' onCommitted, toggleHopperControl, the job controls' onCommitted, the share editor's onCommitted, the Handbook's (Resin Totals' fields) onCommitted and the rail's resetTracking");
  const reset = boot.slice(boot.indexOf("function resetTracking() {"), boot.indexOf("\n  }\n", boot.indexOf("function resetTracking() {")));
  assert.match(reset, /lastOwnRevision = Number\.isInteger\(result\.revision\) \? result\.revision : null;\s+onPublish\(\{ own: true \}\);/);
  const cards = draw.slice(draw.indexOf("const card = focusEditor.create("), draw.indexOf("cardHandles[entry.id] = card;"));
  assert.match(cards, /onCommitted: result => \{\n\s+lastOwnRevision = Number\.isInteger\(result\.revision\) \? result\.revision : null;\n\s+onPublish\(\{ own: true \}\);/);
  assert.match(cards, /variant: "compact",/);
  assert.match(cards, /commands: commandsFor\(current\.resolved\),/, "a card is not handed the same command bridge");
  const job = boot.slice(boot.indexOf("jobPanel = jobControls.create("), boot.indexOf("mounts.job.appendChild"));
  assert.match(job, /onCommitted: result => \{\n\s+lastOwnRevision = Number\.isInteger\(result\.revision\) \? result\.revision : null;\n\s+onPublish\(\{ own: true \}\);/);
  const toggle = body("toggleHopperControl");
  assert.match(toggle, /lastOwnRevision = Number\.isInteger\(result\.revision\) \? result\.revision : null;\n\s+onPublish\(\{ own: true \}\);/);
  assert.doesNotMatch(toggle, /patchStage|renderAll|mountStage|setFocus|clearFocus/);
  const share = body("openShareEditor");
  assert.match(share, /onCommitted: result => \{\n\s+lastOwnRevision = Number\.isInteger\(result\.revision\) \? result\.revision : null;\n\s+onPublish\(\{ own: true \}\);/);
  assert.match(share, /commands: commandsFor\(current\.resolved\),/, "the share editor is not handed the same command bridge");
  assert.doesNotMatch(share, /patchStage|renderAll|mountStage|setFocus|clearFocus/);
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
  // Four subscriptions and no more: the state bridge, into the policy;
  // the recipes bridge, the weight-profiles bridge and the admin bridge,
  // each of which only tells the Handbook something it shows moved -
  // never the stage.
  assert.equal((boot.match(/\.subscribe\(/g) || []).length, 4, "a fifth subscription appeared");
  assert.match(boot, /recipes\?\.subscribe\(\(\) => \{ if \(handbookPanel\) handbookPanel\.update\(\); \}\);/);
  assert.match(boot, /weightProfiles\?\.subscribe\(\(\) => \{ if \(handbookPanel\) handbookPanel\.update\(\); \}\);/);
  assert.match(boot, /admin\?\.subscribe\(\(\) => \{ if \(handbookPanel\) handbookPanel\.update\(\); \}\);/);
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

  const structural = publish.slice(publish.indexOf("const abandoned = own ? null : editing;"));
  assert.match(structural, /renderAll\(\);/);
  // The abandoned control is named: the hopper, or the layer's share.
  assert.match(structural, /const what = abandoned\.hopper \? abandoned\.hopper : `layer \$\{abandoned\.layer\}'s share`;/);
  assert.match(structural, /changed underneath you; what you were entering for \$\{what\} was not applied/);
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
  assert.match(patch, /parts\.hopperStateKey\(runtime, settings\.hopperControls \|\| null\)/);
  assert.match(patch, /cluster\.replaceChild\(fresh, old\)/);
});

test("an own publish is the same policy with one difference: an interaction is not reported as abandoned", () => {
  const publish = body("onPublish");
  assert.match(publish, /function onPublish\(options\)/);
  assert.match(publish, /const own = !!\(options && options\.own\);/);
  // `own` decides nothing else: not the classification, not the patch path.
  const code = publish.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const uses = code.match(/\bown\b/g) || [];
  assert.equal(uses.length, 3, "own is consulted somewhere other than its declaration and the abandoned note");
  assert.match(publish, /const abandoned = own \? null : editing;/);
});

/* ----------------------------------------------------------------------
 *   The boot file's boundary
 * -------------------------------------------------------------------- */

test("the boot file hands the bridge over and never dispatches, connects, or publishes itself", () => {
  assert.match(boot, /const commands = root\.PolynStationCommandBridge \|\| null;/);
  assert.doesNotMatch(boot, /\.dispatch\s*\(/, "station.js dispatches a command; the editor is the one place that does");
  assert.doesNotMatch(boot, /commands\.connect|PolynStationCommandBridge\.connect/, "station.js connects a producer");
  assert.doesNotMatch(boot, /\.publish\s*\(|saveSession|notifyActiveJobMutation|localStorage/, "station.js reaches a write path of its own");
});
