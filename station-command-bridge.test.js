"use strict";

/* The command bridge (station-command-bridge.js): the letterbox from Station
 * into the application. What is pinned here is the guarantee, from the
 * consumer's side: with no producer nothing can be written and every request
 * is answered `unavailable`; with one, only a normalized request reaches it,
 * and nothing it throws or mangles reaches Station.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const bridgeModule = require("./station-command-bridge.js");
const contract = require("./station-command-contract.js");

const ARGS = { recipe: "current", layer: "A", index: 1, resin: "HX204" };

function producer(overrides) {
  const calls = [];
  const snapshot = Object.freeze({ revision: 3, layers: [] });
  const execute = (command, args) => {
    calls.push({ command, args });
    return contract.success({ changed: true, revision: 3, persisted: true, snapshot });
  };
  return Object.assign({ execute, capabilities: [...contract.COMMANDS], calls, snapshot }, overrides || {});
}

/* ----------------------------------------------------------------------
 *   Before anything connects: read-only by construction
 * -------------------------------------------------------------------- */

test("the module surface is the consumer's, plus one guarded connect", () => {
  assert.deepEqual(Object.keys(bridgeModule).sort(), ["capabilities", "connect", "create", "dispatch", "isAvailable"]);
  assert.ok(Object.isFrozen(bridgeModule));
  for (const name of ["execute", "publish", "state", "getState", "setState", "disconnect"]) {
    assert.equal(bridgeModule[name], undefined, `${name} is on the module surface`);
  }
});

test("with no producer, nothing is available and every request is answered unavailable", () => {
  const bridge = bridgeModule.create();
  assert.equal(bridge.isAvailable(), false);
  assert.deepEqual([...bridge.capabilities()], []);
  assert.ok(Object.isFrozen(bridge.capabilities()));
  for (const command of contract.COMMANDS) {
    const result = bridge.dispatch(command, ARGS);
    assert.equal(result.ok, false, `${command} was carried out with no producer`);
    assert.equal(result.code, "unavailable");
    assert.equal(typeof result.message, "string");
    assert.ok(Object.isFrozen(result));
  }
  // Including nonsense: no producer is the first thing a consumer learns.
  assert.equal(bridge.dispatch("nonsense", {}).code, "unavailable");
  assert.equal(bridge.dispatch().code, "unavailable");
});

test("the shared production instance starts with no producer - Station is read-only until app.js installs one", () => {
  assert.equal(bridgeModule.isAvailable(), false);
  assert.deepEqual([...bridgeModule.capabilities()], []);
  assert.equal(bridgeModule.dispatch("setHopperResin", ARGS).code, "unavailable");
});

/* ----------------------------------------------------------------------
 *   Connecting a producer
 * -------------------------------------------------------------------- */

test("only one producer may connect, and only the handle can disconnect it", () => {
  const bridge = bridgeModule.create();
  const first = producer();
  const handle = bridge.connect(first);
  assert.equal(bridge.isAvailable(), true);
  assert.throws(() => bridge.connect(producer()), /already connected/);
  assert.equal(bridge.disconnect, undefined);
  assert.ok(Object.isFrozen(handle));
  assert.equal(handle.isActive(), true);
  assert.equal(handle.disconnect(), true);
  assert.equal(handle.disconnect(), false);
  assert.equal(handle.isActive(), false);
  assert.equal(bridge.isAvailable(), false);
  assert.equal(bridge.dispatch("undo", { recipe: "next" }).code, "unavailable");
  // A new producer may connect once the old one is gone.
  assert.doesNotThrow(() => bridge.connect(producer()));
});

test("connect refuses a producer without an execute function, or with a capability outside the vocabulary", () => {
  const bridge = bridgeModule.create();
  assert.throws(() => bridge.connect({}), TypeError);
  assert.throws(() => bridge.connect({ execute: "not a function" }), TypeError);
  assert.throws(() => bridge.connect({ execute() {}, capabilities: ["setHopperResin", "formatDisk"] }), /formatDisk/);
  assert.equal(bridge.isAvailable(), false, "a refused connect must leave nothing behind");
});

test("capabilities are what the producer declared, frozen and de-duplicated", () => {
  const bridge = bridgeModule.create();
  bridge.connect(producer({ capabilities: ["undo", "redo", "undo"] }));
  assert.deepEqual([...bridge.capabilities()], ["undo", "redo"]);
  assert.ok(Object.isFrozen(bridge.capabilities()));
  assert.equal(bridge.capabilities(), bridge.capabilities(), "the same frozen list every time");
  // A declared subset: undeclared commands are unavailable, not attempted.
  const p = producer({ capabilities: ["undo"] });
  const b2 = bridgeModule.create();
  b2.connect(p);
  assert.equal(b2.dispatch("redo", { recipe: "current" }).code, "unavailable");
  assert.equal(p.calls.length, 0, "an undeclared command reached the producer");
  assert.equal(b2.dispatch("undo", { recipe: "current" }).ok, true);
});

/* ----------------------------------------------------------------------
 *   Dispatch
 * -------------------------------------------------------------------- */

test("a producer only ever sees a normalized request, and its result comes back frozen", () => {
  const bridge = bridgeModule.create();
  const p = producer();
  bridge.connect(p);
  const result = bridge.dispatch("setHopperBlend", { recipe: "next", layer: " B ", index: "2", pct: "12.5", extra: true });
  assert.deepEqual(p.calls, [{ command: "setHopperBlend", args: { recipe: "next", layer: "B", index: 2, pct: 12.5 } }]);
  assert.ok(Object.isFrozen(p.calls[0].args));
  assert.equal(result.ok, true);
  assert.equal(result.snapshot, p.snapshot, "the snapshot is passed through, not copied");
  assert.ok(Object.isFrozen(result));
});

test("bad input never reaches the producer: unknown commands and bad arguments are answered by the contract", () => {
  const bridge = bridgeModule.create();
  const p = producer();
  bridge.connect(p);
  assert.equal(bridge.dispatch("launch", {}).code, "unknown_command");
  assert.equal(bridge.dispatch("setHopperResin", { layer: "A", index: 0, resin: "X" }).code, "bad_argument");
  assert.equal(bridge.dispatch("setHopperResin", { layer: "A", index: 0, resin: "X" }).field, "recipe");
  assert.equal(bridge.dispatch("setHopperBlend", { recipe: "current", layer: "A", index: 1, pct: 500 }).code, "out_of_range");
  assert.equal(bridge.dispatch("clearHopper", { recipe: "current", layer: "A", index: 7 }).code, "unknown_hopper");
  assert.equal(p.calls.length, 0);
});

test("a producer that throws becomes a controlled internal failure, and the throw does not escape", () => {
  const bridge = bridgeModule.create();
  bridge.connect(producer({ execute: () => { throw new Error("secret stack"); } }));
  let result;
  assert.doesNotThrow(() => { result = bridge.dispatch("undo", { recipe: "current" }); });
  assert.deepEqual(result, { ok: false, code: "internal", message: contract.MESSAGES.internal });
  assert.ok(!JSON.stringify(result).includes("secret"), "the producer's error text leaked");
});

test("a producer that answers with something other than a result is reported as internal", () => {
  for (const answer of [undefined, null, "done", 42, {}, { ok: true }, { ok: false, code: "invented", message: "x" }]) {
    const bridge = bridgeModule.create();
    bridge.connect(producer({ execute: () => answer }));
    const result = bridge.dispatch("undo", { recipe: "current" });
    assert.equal(result.ok, false, `${JSON.stringify(answer)} passed through`);
    assert.equal(result.code, "internal");
  }
});

test("a producer's failure result passes through as it is, with the application's own wording", () => {
  const bridge = bridgeModule.create();
  bridge.connect(producer({
    execute: () => contract.failure("blend_total", { total: 130, message: "Hopper percentages 2–6 cannot total more than 100%." })
  }));
  const result = bridge.dispatch("setHopperBlend", { recipe: "current", layer: "A", index: 1, pct: 40 });
  assert.deepEqual(result, { ok: false, code: "blend_total", message: "Hopper percentages 2–6 cannot total more than 100%.", total: 130 });
});

test("a success carrying an unfrozen snapshot does not cross - live state cannot leak through a result", () => {
  const bridge = bridgeModule.create();
  const live = { layers: [{ name: "A" }] };
  bridge.connect(producer({ execute: () => ({ ok: true, changed: true, revision: 1, persisted: true, snapshot: live }) }));
  const result = bridge.dispatch("undo", { recipe: "current" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "internal");
  assert.equal(result.snapshot, undefined);
});

/* ----------------------------------------------------------------------
 *   Discipline
 * -------------------------------------------------------------------- */

test("the bridge holds no state, persists nothing, and reaches no service", () => {
  const source = fs.readFileSync(path.join(__dirname, "station-command-bridge.js"), "utf8");
  for (const pattern of [/\bdocument\b/, /localStorage/, /sessionStorage/, /\bfetch\s*\(/, /XMLHttpRequest/, /supabase/i,
    /setTimeout/, /setInterval/, /addEventListener/, /\bstate\.layers\b/, /nextRecipeWorking/, /hookupSources/, /outbox/i, /Realtime/i]) {
    assert.doesNotMatch(source, pattern, `the command bridge reaches outside itself (${pattern})`);
  }
  // It validates through the contract rather than restating a rule.
  assert.match(source, /contract\.normalizeArguments\(command, args\)/);
  assert.match(source, /contract\.isResult\(result\)/);
});

test("the state bridge and the command bridge are two files: the state bridge gained no write path", () => {
  const state = fs.readFileSync(path.join(__dirname, "station-state-bridge.js"), "utf8");
  assert.doesNotMatch(state, /dispatch|execute|PolynStationCommand/);
  const command = fs.readFileSync(path.join(__dirname, "station-command-bridge.js"), "utf8");
  assert.doesNotMatch(command, /PolynStationStateBridge|getSnapshot|\.publish\s*\(/,
    "the command bridge must not reach into the state bridge");
});

test("exactly one producer exists, and it is the application's: app.js connects once, nothing else ever does", () => {
  /* Step 5 installed connectStationCommands() in app.js. The boundary now
   * is that it is the ONLY producer: Station and every other module remain
   * consumers, and app.js installs it in one place, beside the state
   * bridge, with the same optional, failure-tolerant shape. */
  const root = __dirname;
  const files = fs.readdirSync(root).filter(name => name.endsWith(".js") && !name.endsWith(".test.js"))
    .concat(fs.readdirSync(path.join(root, "station")).filter(name => name.endsWith(".js")).map(name => `station/${name}`));
  for (const file of files) {
    if (file === "station-command-bridge.js" || file === "app.js") continue;
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /PolynStationCommandBridge\s*\.\s*connect\b/, `${file} connects a command producer`);
    assert.doesNotMatch(source, /connectStationCommands/, `${file} installs the Station command executor`);
    assert.doesNotMatch(source, /stationCommandHandle/, `${file} holds a command producer handle`);
  }
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(app, /const stationCommands = window\.PolynStationCommandBridge \|\| null;/);
  assert.match(app, /const stationCommandContract = window\.PolynStationCommandContract \|\| null;/);
  assert.equal((app.match(/stationCommands\.connect\s*\(/g) || []).length, 1, "app.js must connect the executor in exactly one place");
  assert.equal((app.match(/function connectStationCommands\(\)/g) || []).length, 1);
  assert.doesNotMatch(app, /window\.PolynStationCommandBridge\s*=/, "app.js must not replace the command bridge module");
  // The application asks nothing of its own executor: dispatch is Station's verb.
  assert.doesNotMatch(app, /\.dispatch\s*\(/);
});
