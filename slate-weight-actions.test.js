"use strict";

/* slate-weight-actions.js: the Weights section's seam to the command
 * bridge. Every command's name and args are pinned against the contract,
 * and the abilities table; the reading helpers normalise what the source
 * carries. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeCommands } = require("./tools/slate-test/fake-dom.js");
const contract = require("./station-command-contract.js");
const actions = require("./slate/slate-weight-actions.js");

const ALL = [...contract.COMMANDS];

test("every command the seam names is in the contract; positional commands go to Current, the line-wide ones carry no recipe", () => {
  for (const name of Object.values(actions.COMMAND)) assert.ok(ALL.includes(name), `${name} is not a contract command`);
  const commands = makeCommands({ capabilities: ALL });
  actions.setWeight(commands, "A", 0, "450");
  actions.setWeight(commands, "B", 2, 0);
  actions.setGeometry(commands, "A", 0, "height", "48.5");
  actions.setGeometry(commands, "C", 1, "volume", "12");
  actions.setCircumference(commands, "30");
  actions.setSmart(commands, true);
  actions.setSmart(commands, 0);
  assert.deepEqual(commands.calls, [
    { command: "setHopperWeight", args: { recipe: "current", layer: "A", index: 0, weight: "450" } },
    { command: "setHopperWeight", args: { recipe: "current", layer: "B", index: 2, weight: 0 } },
    { command: "setHopperGeometry", args: { recipe: "current", layer: "A", index: 0, dimension: "height", value: "48.5" } },
    { command: "setHopperGeometry", args: { recipe: "current", layer: "C", index: 1, dimension: "volume", value: "12" } },
    { command: "setHopperCircumference", args: { circumference: "30" } },
    { command: "setSmartHoppers", args: { enabled: true } },
    { command: "setSmartHoppers", args: { enabled: false } }
  ]);
  // The contract accepts each exactly as sent: the draft text is its to read.
  for (const call of commands.calls) {
    const normalized = contract.normalizeArguments(call.command, call.args);
    assert.ok(!normalized.error, `${call.command}: ${normalized.error && normalized.error.message}`);
  }
  assert.equal(actions.RECIPE, "current");
});

test("a refusal comes back as the bridge gave it; no bridge answers unavailable and sends nothing", () => {
  const refusing = makeCommands({ capabilities: ALL, answer: () => ({ ok: false, code: "bad_argument", message: "This line measures its hoppers by usable volume (gallons), not height." }) });
  const result = actions.setGeometry(refusing, "A", 0, "height", "48");
  assert.equal(result.ok, false);
  assert.equal(result.code, "bad_argument");
  assert.match(result.message, /usable volume/);
  assert.equal(actions.setWeight(null, "A", 0, "1").code, "unavailable");
  assert.equal(actions.setWeight(null, "A", 0, "1").message, actions.NO_BRIDGE);
  assert.equal(actions.setSmart({}, true).code, "unavailable");
});

test("abilities follow the bridge's capabilities; read-only withholds all with its reason", () => {
  const full = makeCommands({ capabilities: ALL });
  assert.deepEqual(actions.abilities(full), { weight: true, geometry: true, circumference: true, smart: true });
  const some = makeCommands({ capabilities: ["setHopperWeight", "setLineRate"] });
  assert.deepEqual(actions.abilities(some), { weight: true, geometry: false, circumference: false, smart: false });
  assert.match(actions.reason(some, "geometry"), /does not offer setHopperGeometry/);
  const readOnly = actions.abilities(full, { readOnly: true });
  assert.ok(Object.values(readOnly).every(value => value === false));
  assert.equal(actions.reason(full, "weight", { readOnly: true }), actions.READ_ONLY_REASON);
  assert.ok(Object.values(actions.abilities(null)).every(value => value === false));
  assert.match(actions.reason(null, "weight"), /no application is connected/);
  const off = makeCommands({ capabilities: ALL, available: false });
  assert.ok(Object.values(actions.abilities(off)).every(value => value === false));
});

test("the switch needs the command and an identified line: off any line it is withheld with the floor UI's words", () => {
  const full = makeCommands({ capabilities: ALL });
  const identified = { enabled: false, geometryMode: "cylindrical", circumference: 0 };
  const unidentified = { enabled: false, geometryMode: null, circumference: 0 };
  assert.equal(actions.canToggleSmart(full, identified), true);
  assert.equal(actions.canToggleSmart(full, unidentified), false);
  assert.equal(actions.smartReason(full, unidentified), actions.SMART_UNAVAILABLE_TEXT);
  assert.equal(actions.smartReason(full, identified), "");
  assert.equal(actions.canToggleSmart(full, identified, { readOnly: true }), false);
  assert.equal(actions.smartReason(full, identified, { readOnly: true }), actions.READ_ONLY_REASON);
  assert.equal(actions.canToggleSmart(null, identified), false);
  assert.match(actions.smartReason(null, identified), /no application/);
  const without = makeCommands({ capabilities: ["setHopperWeight"] });
  assert.match(actions.smartReason(without, identified), /does not offer setSmartHoppers/);
});

test("reading: smartFrom is at rest for anything the source does not say, shapeOf names the fields a row carries, fieldText is blank for nothing", () => {
  assert.deepEqual(actions.smartFrom(null), { enabled: false, geometryMode: null, circumference: 0 });
  assert.deepEqual(actions.smartFrom({ smartHoppers: { enabled: "yes", geometryMode: "spherical", circumference: -1 } }), { enabled: false, geometryMode: null, circumference: 0 });
  const on = actions.smartFrom({ smartHoppers: { enabled: true, geometryMode: "volume", circumference: 30 } });
  assert.deepEqual(on, { enabled: true, geometryMode: "volume", circumference: 30 });
  assert.equal(actions.shapeOf(on), "smart:volume");
  assert.equal(actions.shapeOf({ enabled: true, geometryMode: "cylindrical" }), "smart:cylindrical");
  assert.equal(actions.shapeOf({ enabled: true, geometryMode: null }), "off", "no mode is no smart shape");
  assert.equal(actions.shapeOf({ enabled: false, geometryMode: "cylindrical" }), "off");
  assert.equal(actions.shapeOf(null), "off");
  assert.equal(actions.measureFor(on).dimension, "volume");
  assert.equal(actions.measureFor(on).unit, "gal");
  assert.equal(actions.measureFor({ geometryMode: "cylindrical" }).field, "usableHeight");
  assert.equal(actions.measureFor({ geometryMode: null }), null);
  assert.equal(actions.fieldText(400), "400");
  assert.equal(actions.fieldText(48.5), "48.5");
  assert.equal(actions.fieldText(0), "");
  assert.equal(actions.fieldText(NaN), "");
  assert.equal(actions.formatPounds(412.4), "412");
  assert.equal(actions.formatPounds(1250), "1,250");
  assert.equal(actions.formatPounds(0), "—");
});
