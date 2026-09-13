"use strict";

/* The hopper cluster's operational controls (station/station-hopper-controls.js)
 * and the boot file's use of them: a click on a hopper's receiver or its
 * body becomes one Station command through the bridge the
 * boot file was handed, and the answer runs the same publish policy the
 * editor's commands run. The module is pure and state-free; the boot
 * file's routing is pinned at source, as the publish policy is, and the
 * behaviour in a real engine by tools/station-browser/spec.js.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const controls = require("./station/station-hopper-controls.js");
const contract = require("./station-command-contract.js");
const commandBridge = require("./station-command-bridge.js");

const ROOT = __dirname;
const boot = fs.readFileSync(path.join(ROOT, "station/station.js"), "utf8");

function body(name) {
  const at = boot.indexOf(`function ${name}(`);
  assert.ok(at > -1, `${name} is not defined`);
  return boot.slice(at, boot.indexOf("\n  }\n", at) + 4);
}

/* A control's element as the renderer writes it. */
function controlElement(attributes) {
  return {
    attributes,
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; }
  };
}

function connectedBridge(capabilities, execute) {
  const bridge = commandBridge.create();
  const calls = [];
  bridge.connect({
    execute(command, args) { calls.push({ command, args }); return execute ? execute(command, args) : contract.success({ changed: true, revision: 7, snapshot: Object.freeze({}) }); },
    capabilities
  });
  return { bridge, calls };
}

/* ----------------------------------------------------------------------
 *   The module
 * -------------------------------------------------------------------- */

test("two controls, each on its own command and its own hopper flag, named in the floor UI's words", () => {
  assert.deepEqual([...controls.CONTROLS], ["tracking", "pump"]);
  assert.deepEqual(controls.COMMAND, { tracking: "setHopperTracking", pump: "setPumpOff" });
  assert.deepEqual(controls.FLAG, { tracking: "track", pump: "pumpOff" });
  assert.equal(controls.stateLabel("tracking", true), "Tracked");
  assert.equal(controls.stateLabel("tracking", false), "Not tracked");
  assert.equal(controls.stateLabel("pump", true), "Pump off");
  assert.equal(controls.stateLabel("pump", false), "Pump running");
  assert.equal(controls.actionLabel("tracking", true), "stop tracking");
  assert.equal(controls.actionLabel("pump", false), "mark the pump off");
  assert.ok(Object.isFrozen(controls));
  for (const name of Object.keys(controls.COMMAND)) assert.ok(contract.COMMANDS.includes(controls.COMMAND[name]), `${name} rides a command outside the contract`);
});

test("abilities come from the bridge's offer, per control, for the Current recipe only", () => {
  const both = connectedBridge([...contract.COMMANDS]).bridge;
  assert.deepEqual(controls.abilities(both, "current"), { tracking: true, pump: true });
  assert.ok(Object.isFrozen(controls.abilities(both, "current")));
  assert.deepEqual(controls.abilities(both, "next"), { tracking: false, pump: false }, "the plan carries no runtime state");
  const one = connectedBridge(["setHopperResin", "setPumpOff"]).bridge;
  assert.deepEqual(controls.abilities(one, "current"), { tracking: false, pump: true });
  assert.deepEqual(controls.abilities(commandBridge.create(), "current"), { tracking: false, pump: false }, "unconnected: nothing");
  assert.deepEqual(controls.abilities(null, "current"), { tracking: false, pump: false }, "no bridge (a pinned demo): nothing");
  assert.match(controls.reason(null, "current", "tracking"), /no application is connected/);
  assert.match(controls.reason(both, "next", "pump"), /only the running job/);
  assert.match(controls.reason(one, "current", "tracking"), /does not offer tracking/);
  assert.match(controls.reason(one, "current", "pump"), /does not offer pump-off/);
});

test("a request is read off the control's own element: address, state as drawn, whether it may act", () => {
  const element = controlElement({ "data-station-target": "tracking", "data-layer": "B", "data-hopper": "B3", "data-hopper-index": "2", "data-on": "true", "data-able": "true" });
  assert.deepEqual(controls.requestFrom(element), { control: "tracking", layer: "B", index: 2, hopper: "B3", on: true, able: true });
  assert.ok(Object.isFrozen(controls.requestFrom(element)));
  assert.deepEqual(controls.requestFrom(controlElement({ "data-station-target": "pump", "data-layer": "A", "data-hopper": "A1", "data-hopper-index": "0", "data-on": "false", "data-able": "false" })),
    { control: "pump", layer: "A", index: 0, hopper: "A1", on: false, able: false });
  // Not a control: the cluster, the mixer, the extruder, nothing.
  for (const other of ["cluster", "mixer", "extruder", "receiver"]) {
    assert.equal(controls.requestFrom(controlElement({ "data-station-target": other, "data-layer": "A", "data-hopper-index": "0" })), null);
  }
  assert.equal(controls.requestFrom(controlElement({ "data-station-target": "pump", "data-layer": "A" })), null, "no index, no request");
  assert.equal(controls.requestFrom(null), null);
});

test("toggle issues exactly one command on the bridge it is handed, stating the state wanted, addressed to Current", () => {
  const { bridge, calls } = connectedBridge([...contract.COMMANDS]);
  const on = controls.toggle(bridge, { control: "tracking", layer: "B", index: 2, next: true });
  assert.equal(on.ok, true);
  assert.equal(on.changed, true);
  assert.equal(on.revision, 7);
  assert.deepEqual(calls, [{ command: "setHopperTracking", args: { recipe: "current", layer: "B", index: 2, track: true } }]);
  controls.toggle(bridge, { control: "pump", layer: "A", index: 0, next: false });
  assert.deepEqual(calls[1], { command: "setPumpOff", args: { recipe: "current", layer: "A", index: 0, pumpOff: false } });
  assert.equal(calls.length, 2);
  // The contract's own refusals come back as values, never throws.
  assert.equal(controls.toggle(bridge, { control: "pump", layer: "A", index: 9, next: true }).code, "unknown_hopper");
  assert.equal(calls.length, 2, "a malformed request never reached the executor");
});

test("with no bridge, an unconnected bridge, or a bridge without the command, the answer is unavailable and nothing is asked", () => {
  assert.deepEqual(controls.toggle(null, { control: "tracking", layer: "A", index: 0, next: true }), { ok: false, code: "unavailable", message: "No application is connected to Station commands." });
  assert.equal(controls.toggle(commandBridge.create(), { control: "tracking", layer: "A", index: 0, next: true }).code, "unavailable");
  const { bridge, calls } = connectedBridge(["setHopperResin"]);
  assert.equal(controls.toggle(bridge, { control: "pump", layer: "A", index: 0, next: true }).code, "unavailable");
  assert.equal(calls.length, 0);
  assert.equal(controls.toggle(bridge, { control: "receiver", layer: "A", index: 0, next: true }).code, "unavailable");
  assert.equal(controls.toggle(bridge, {}).code, "unavailable");
});

test("the module is pure: no DOM, no state, no timers, no reach for the global bridges", () => {
  const source = fs.readFileSync(path.join(ROOT, "station/station-hopper-controls.js"), "utf8");
  for (const pattern of [/\bdocument\b/, /\bwindow\b/, /localStorage/, /setTimeout|requestAnimationFrame/, /PolynStationCommandBridge\s*\./, /PolynStationStateBridge/, /\.connect\s*\(/, /\.publish\s*\(/, /saveSession|notifyActiveJobMutation/]) {
    assert.doesNotMatch(source, pattern, `the module reaches outside itself (${pattern})`);
  }
  assert.equal((source.match(/commands\.dispatch\s*\(/g) || []).length, 1, "one call on the bridge");
});

/* ----------------------------------------------------------------------
 *   The boot file's routing
 * -------------------------------------------------------------------- */

test("a click on a control is the control's alone: routed before the cluster, and never a focus change", () => {
  const listener = boot.slice(boot.indexOf('mounts.machine?.addEventListener("click", event => {'), boot.indexOf("    /* Hover and keyboard focus link a drawn hopper"));
  const controlsAt = listener.indexOf('if (target === "tracking" || target === "pump") {');
  assert.ok(controlsAt > -1, "the click handler does not route the controls");
  assert.match(listener.slice(controlsAt, controlsAt + 120), /toggleHopperControl\(hit\);\n\s+return;/);
  assert.equal(listener.indexOf('"receiver"'), -1, "no receiver fall-through remains: the receiver IS the pump control");
  assert.ok(controlsAt < listener.indexOf("setFocus({ layer, target, hopper });"), "controls are resolved before the cluster's selection");
  // But after the guards every target shares: a ghost's control, or one
  // on a layer that is not the open one, does nothing.
  assert.ok(controlsAt > listener.indexOf('if (bank && bank.classList.contains("is-dimmed")) return;'));
  assert.ok(controlsAt > listener.indexOf("if (shown && layer !== shown) return;"));

  const toggle = body("toggleHopperControl");
  assert.match(toggle, /hopperControls\.requestFrom\(element\)/);
  assert.match(toggle, /hopperControls\.toggle\(commandsFor\(current\.resolved\), \{/);
  assert.match(toggle, /next: !request\.on/, "the state wanted is the opposite of the state drawn");
  assert.doesNotMatch(toggle, /setFocus|clearFocus|stage\.request|highlight\(/, "a toggle changes no focus, selection or highlight");
  assert.doesNotMatch(toggle, /patchStage|renderAll|mountStage|\.dispatch\s*\(/, "the answer goes through the publish policy, not a path of its own");
  // The pending mark is put on and taken off on every path.
  assert.match(toggle, /element\.classList\.add\("is-pending"\);\n\s+try \{[\s\S]*\} finally \{\n\s+element\.classList\.remove\("is-pending"\);/);
  // A control that may not act says why and asks nothing.
  assert.match(toggle, /if \(!request\.able\) \{\n\s+say\([^\n]*hopperControls\.reason\(commandsFor\(current\.resolved\), "current", request\.control\)[^\n]*\);\n\s+return;/);
  assert.match(toggle, /if \(result\.changed\) \{\n\s+lastOwnRevision = Number\.isInteger\(result\.revision\) \? result\.revision : null;\n\s+onPublish\(\{ own: true \}\);/);
});

test("the offer reaches the drawing on every render and every patch, read once from the bridge, with no command named in the boot file", () => {
  assert.match(boot, /const hopperControls = root\.PolynStationHopperControls \|\| null;/);
  assert.match(body("controlsFor"), /hopperControls\.abilities\(commandsFor\(resolved\), "current"\)/);
  const draw = body("drawStage");
  assert.match(draw, /hopperControls: controlsFor\(current\.resolved\),/);
  const publish = body("onPublish");
  assert.match(publish, /hopperControls: controlsFor\(resolved\)/);
  for (const name of ["setHopperTracking", "setPumpOff"]) assert.doesNotMatch(boot, new RegExp(name), `${name} is named in the boot file`);
  assert.doesNotMatch(boot, /\.dispatch\s*\(/);
  // The inspector says the state in the module's words, and no longer
  // promises controls that are not there.
  assert.match(boot, /hopperControls\.stateLabel\("tracking", row\.track\)/);
  assert.match(boot, /hopperControls\.stateLabel\("pump", row\.pumpOff\)/);
  assert.doesNotMatch(boot, /nothing is wired up yet|will carry pump and tracking/);
});

test("the module is loaded by both hosts, before the boot file and after the editor, and by nothing else", () => {
  const host = fs.readFileSync(path.join(ROOT, "station-host.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "station/station.html"), "utf8");
  // The quoted asset names as each host writes them, so a comment that
  // mentions a file does not stand in for loading it.
  const order = (source, quote) => ["station-focus-editor.js", "station-hopper-controls.js", "station.js"].map(name => source.indexOf(quote(name)));
  for (const [source, quote] of [[host, name => `"station/${name}"`], [html, name => `src="${name}?v=`]]) {
    const at = order(source, quote);
    assert.ok(at.every(index => index > -1), "a host does not load the module");
    assert.ok(at[0] < at[1] && at[1] < at[2], "the module must be evaluated before station.js reads its global");
  }
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), /station-hopper-controls/, "index.html loads Station modules through the host only");
});
