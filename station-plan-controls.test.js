"use strict";

/* The plan controls (station/station-plan-controls.js): the seam the
 * machine rail's two moves under the Next face go through - the plan
 * promoted over the running recipe, the running recipe copied into the
 * plan - and the words for what a promotion would change. One command
 * each on the bridge it is handed; no state, no DOM, no reach for a
 * global.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const plan = require("./station/station-plan-controls.js");
const contract = require("./station-command-contract.js");
const commandBridge = require("./station-command-bridge.js");
const stationSource = require("./station/station-source.js");

const ROOT = __dirname;
const boot = fs.readFileSync(path.join(ROOT, "station/station.js"), "utf8");

function connectedBridge(capabilities, execute) {
  const bridge = commandBridge.create();
  const calls = [];
  bridge.connect({
    execute(command, args) { calls.push({ command, args }); return execute ? execute(command, args) : contract.success({ changed: true, revision: 7, snapshot: Object.freeze({}) }); },
    capabilities
  });
  return { bridge, calls };
}

function snapshot(withPlan) {
  const snap = {
    line: { lineNumber: 9, displayName: "Line 9", layerCount: 2, layerAPosition: "outside", hopperNamingMode: "standard", linked: true },
    job: { lineRate: 900, changeoverTime: "" },
    sources: { current: {}, next: {} },
    layers: ["A", "B"].map((name, i) => ({
      name, layerPct: 50,
      hoppers: Array.from({ length: 6 }, (_, index) => ({ index, pct: index === 0 ? 60 : index === 1 ? 40 : 0, resinName: index === 0 ? `HX${i}` : index === 1 ? `LD${i}` : "", weight: 0, track: false, pumpOff: false }))
    })),
    revision: 1
  };
  if (withPlan) {
    snap.nextRecipe = { layers: ["A", "B"].map((name, i) => ({
      name, layerPct: i === 0 ? 55 : 45,
      hoppers: Array.from({ length: 6 }, (_, index) => ({ index, pct: index === 0 ? 60 : index === 1 ? 40 : 0, resinName: index === 0 ? `HX${i}` : index === 1 ? (i === 0 ? "NEW" : `LD${i}`) : "" }))
    })) };
  }
  return snap;
}

test("promote and copy are one command each - promoteNextRecipe, copyCurrentToNext, with no arguments - on the bridge handed in, and their answers come back untouched", () => {
  const { bridge, calls } = connectedBridge([...contract.COMMANDS]);
  const promoted = plan.promote(bridge);
  assert.equal(promoted.ok, true);
  assert.equal(promoted.revision, 7);
  const copied = plan.copy(bridge);
  assert.equal(copied.ok, true);
  assert.deepEqual(calls, [{ command: "promoteNextRecipe", args: {} }, { command: "copyCurrentToNext", args: {} }]);
  // A refusal is the application's own, passed through.
  const { bridge: refusing } = connectedBridge([...contract.COMMANDS], () => contract.failure("no_plan"));
  const refused = plan.promote(refusing);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "no_plan");
  assert.equal(refused.message, contract.MESSAGES.no_plan);
  assert.equal(plan.dispatch(bridge, "burn").code, "unavailable");
  assert.deepEqual(plan.COMMAND, { promote: "promoteNextRecipe", copy: "copyCurrentToNext" });
});

test("each move is on offer only when the producer declared its command; with no bridge, or none connected, it is unavailable and says why", () => {
  const { bridge: full } = connectedBridge([...contract.COMMANDS]);
  assert.equal(plan.can(full, "promote"), true);
  assert.equal(plan.can(full, "copy"), true);
  const { bridge: half } = connectedBridge([...contract.COMMANDS].filter(name => name !== "copyCurrentToNext"));
  assert.equal(plan.can(half, "promote"), true);
  assert.equal(plan.can(half, "copy"), false);
  assert.equal(plan.reason(half, "copy"), "the application does not offer Copy Current into Next from Station.");
  assert.equal(plan.can(null, "promote"), false);
  assert.equal(plan.reason(null, "promote"), "no application is connected to Station commands.");
  const idle = commandBridge.create();
  assert.equal(plan.can(idle, "promote"), false);
  assert.equal(plan.promote(null).code, "unavailable");
  assert.equal(plan.copy(idle).code, "unavailable");
  assert.equal(plan.can(full, "burn"), false);
});

test("summarize counts what a promotion would change off the resolved source - shares, resins, blends - and words it; nothing planned is null", () => {
  const none = stationSource.resolveSource({ snapshot: snapshot(false), mode: "auto" });
  assert.equal(plan.summarize(none), null);
  assert.equal(plan.summaryText(plan.summarize(none)), "nothing is planned");
  const some = stationSource.resolveSource({ snapshot: snapshot(true), mode: "auto" });
  const summary = plan.summarize(some);
  assert.deepEqual(summary, { layers: 2, resins: 1, blends: 0, unchanged: false });
  assert.ok(Object.isFrozen(summary));
  assert.equal(plan.summaryText(summary), "1 resin change · 2 layer shares");
  // A plan that matches the running recipe.
  const same = snapshot(true);
  same.nextRecipe.layers.forEach((layer, i) => { layer.layerPct = 50; layer.hoppers[1].resinName = `LD${i}`; });
  const matched = plan.summarize(stationSource.resolveSource({ snapshot: same, mode: "auto" }));
  assert.deepEqual(matched, { layers: 0, resins: 0, blends: 0, unchanged: true });
  assert.equal(plan.summaryText(matched), "the plan matches the running recipe");
  // A blend change alone, in the singular.
  const blend = snapshot(true);
  blend.nextRecipe.layers.forEach((layer, i) => { layer.layerPct = 50; layer.hoppers[1].resinName = `LD${i}`; });
  blend.nextRecipe.layers[0].hoppers[1].pct = 35;
  assert.equal(plan.summaryText(plan.summarize(stationSource.resolveSource({ snapshot: blend, mode: "auto" }))), "1 percentage change");
  assert.equal(plan.summarize(null), null);
});

test("the module is pure: no DOM, no state, no timers, no reach for the global bridges", () => {
  const source = fs.readFileSync(path.join(ROOT, "station/station-plan-controls.js"), "utf8");
  for (const pattern of [/\bdocument\b/, /\bwindow\b/, /localStorage/, /setTimeout|requestAnimationFrame/, /PolynStationCommandBridge\s*\./, /PolynStationStateBridge/, /\.connect\s*\(/, /\.publish\s*\(/, /saveSession|notifyActiveJobMutation/]) {
    assert.doesNotMatch(source, pattern, `the module reaches outside itself (${pattern})`);
  }
  assert.equal((source.match(/commands\.dispatch\s*\(/g) || []).length, 1, "one call on the bridge, for either move");
});

test("the boot file routes the rail's two moves through the seam and the offer through can(); the summary words come from the module", () => {
  assert.match(boot, /const planControls = root\.PolynStationPlanControls \|\| null;/);
  assert.match(boot, /onPromote: promoteNextRecipe,\n\s+onCopy: copyCurrentToNext,/);
  const rail = boot.slice(boot.indexOf("function syncRail() {"), boot.indexOf("function promoteNextRecipe() {"));
  assert.match(rail, /const promoteOffered = !!\(planControls && planControls\.can\(commandsNow, "promote"\)\);/);
  assert.match(rail, /const copyOffered = !!\(planControls && planControls\.can\(commandsNow, "copy"\)\);/);
  assert.match(rail, /summary: planControls \? planControls\.summaryText\(planControls\.summarize\(current\.resolved\)\) : ""/);
  assert.match(rail, /next: \{ active: modeIs\("next"\), available: canEnterBlendEdit\(\), planned \}/);
  assert.doesNotMatch(boot, /promoteNextRecipe"|copyCurrentToNext"/, "the boot file names a plan command itself");
});

test("the module is loaded by both hosts, beside the hopper controls and before the boot file, and by nothing else", () => {
  const host = fs.readFileSync(path.join(ROOT, "station-host.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "station/station.html"), "utf8");
  const order = (source, quote) => ["station-hopper-controls.js", "station-plan-controls.js", "station-machine-rail.js", "station.js"].map(name => source.indexOf(quote(name)));
  for (const [source, quote] of [[host, name => `"station/${name}"`], [html, name => `src="${name}?v=`]]) {
    const at = order(source, quote);
    assert.ok(at.every(index => index > -1), "a host does not load the module");
    assert.ok(at[0] < at[1] && at[1] < at[2] && at[2] < at[3], "the module must be evaluated before the rail and station.js");
  }
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), /station-plan-controls/, "index.html loads Station modules through the host only");
});
