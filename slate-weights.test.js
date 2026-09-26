"use strict";

/* slate-weights.js: the Weights section. The rows and their fields, the
 * shapes Smart Hoppers gives them, the switch, and the Weight Profiles
 * under them. Nothing is computed here; every write is one command or one
 * request through the seams. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click, key, makeCommands, makeTimers } = require("./tools/slate-test/fake-dom.js");
const contract = require("./station-command-contract.js");
const weights = require("./slate/slate-weights.js");
const actions = require("./slate/slate-weight-actions.js");
const profileActions = require("./slate/slate-profile-actions.js");
const source = require("./slate/slate-source.js");
const demo = require("./slate/slate-demo.js");

const ALL = [...contract.COMMANDS];
const tick = () => new Promise(resolve => setImmediate(resolve));

function snapshotWith(mutate) {
  const snap = demo.snapshot(5000);
  snap.revision = 3;
  snap.line.linked = true;
  if (mutate) mutate(snap);
  return snap;
}

function resolvedFrom(mutate) {
  return source.resolveSource({ snapshot: snapshotWith(mutate) });
}

/* A cylindrical line with Smart Hoppers on: A1 has a height and a computed
 * weight, A2 a height but no bulk density, A4 no resin. */
function smartLine(snap, options) {
  const settings = options || {};
  snap.smartHoppers = { enabled: settings.enabled !== false, geometryMode: settings.mode || "cylindrical", circumference: settings.circumference === undefined ? 30 : settings.circumference };
  const a = snap.layers[0].hoppers;
  a[0].usableHeight = 48;
  a[0].smartWeight = { value: 412.4, bulkDensity: 44.9, resinCode: "HX204" };
  a[0].effectiveWeight = 412.4;
  a[1].usableHeight = 48;
  a[3].usableHeight = 20;
}

function profileOf(id, name, extra) {
  return Object.assign({ id, name, updatedAt: "2026-09-21T10:00:00Z", lineType: 3, hopperNamingMode: "standard", hasGeometry: false,
    layers: [{ name: "A", weights: [400, 380, 120, 0, 0, 0] }, { name: "B", weights: [620, 260, 140, 0] }, { name: "C", weights: [500, 90, 0, 0, 0, 0] }] }, extra || {});
}

function bookOf(overrides) {
  return Object.assign({ assigned: true, workspace: { id: "ws-1", displayName: "Line 5" }, cachedAt: 1, refreshing: false, profiles: [profileOf("p1", "Standard"), profileOf("p2", "Heavy", { hasGeometry: true, layers: [{ name: "A", weights: [450, 380, 120, 0, 0, 0] }, { name: "B", weights: [620, 260, 140, 0] }, { name: "C", weights: [500, 90, 0, 0, 0, 0] }] })], count: 2 }, overrides || {});
}

function makeProfiles(book, options) {
  const settings = options || {};
  const requests = [];
  const listeners = new Set();
  let current = book;
  return {
    requests,
    isConnected: () => settings.connected !== false,
    capabilities: () => settings.capabilities || [...profileActions.ACTIONS],
    getBook: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async request(action, args) {
      requests.push(args === undefined ? { action } : { action, args });
      if (typeof settings.answer === "function") {
        const answered = settings.answer(action, args);
        if (answered !== undefined) return answered;
      }
      return { ok: true };
    },
    set(next) { current = next; for (const listener of listeners) listener(next); }
  };
}

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const commands = settings.commands === null ? null : (settings.commands || makeCommands({ capabilities: ALL }));
  const profiles = settings.profiles === null ? null : (settings.profiles || makeProfiles(bookOf()));
  const committed = [];
  const said = [];
  let readOnly = !!settings.readOnly;
  const timers = makeTimers();
  // How the round-hopper size is entered: these tests were written in
  // circumference; the diameter's own test asks for it.
  let measure = settings.measure || "circumference";
  const measureListeners = new Set();
  const display = {
    getMeasure: () => measure,
    setMeasure(value) { measure = value; for (const fn of [...measureListeners]) fn({ measure }); return measure; },
    subscribe(fn) { measureListeners.add(fn); return () => measureListeners.delete(fn); }
  };
  const view = weights.create(doc, {
    timers,
    display,
    tier: settings.touch ? () => ({ input: "touch", width: "wide" }) : undefined,
    alwaysDraft: !!settings.alwaysDraft,
    commands: () => commands,
    weightProfiles: profiles,
    readOnly: () => readOnly,
    onCommitted: result => { committed.push(result); if (settings.republish) settings.republish(view); },
    say: message => said.push(message)
  });
  doc.body.appendChild(view.element);
  return { doc, view, commands, profiles, committed, said, timers, display, setReadOnly: value => { readOnly = value; } };
}

const field = (view, key, kind) => view.element.querySelector(`.slate-weights__field[data-key='${key}'][data-kind='${kind || "weight"}']`);
const rowOf = (view, key) => view.element.querySelector(`.slate-weights__row[data-key='${key}']`);
function type(input, value) {
  input.dispatchEvent({ type: "focus", target: input });
  input.value = value;
  input.dispatchEvent({ type: "input", target: input });
}
const enter = input => key(input, "Enter");
const blur = input => input.dispatchEvent({ type: "blur", target: input });

/* ----------------------------------------------------------------------
 *   Words, pure
 * -------------------------------------------------------------------- */

test("the subtitle names the line, its hoppers and the switch; the switch's line is Station's; a hint says why nothing is computed", () => {
  const off = resolvedFrom();
  assert.equal(weights.subtitleFor(off, actions.smartFrom(off)), "Line 5 (demo) · 16 hoppers · Smart Hoppers unavailable · Live");
  const on = resolvedFrom(snap => smartLine(snap));
  assert.equal(weights.subtitleFor(on, actions.smartFrom(on)), "Line 5 (demo) · 16 hoppers · Smart Hoppers on · Live");
  const idle = resolvedFrom(snap => smartLine(snap, { enabled: false }));
  assert.equal(weights.subtitleFor(idle, actions.smartFrom(idle)), "Line 5 (demo) · 16 hoppers · Smart Hoppers off · Live");
  assert.equal(weights.subtitleFor(null), weights.NO_LINE);
  assert.equal(weights.smartText(actions.smartFrom(off)), actions.SMART_UNAVAILABLE_TEXT);
  assert.equal(weights.smartText(actions.smartFrom(on)), actions.SMART_ON_TEXT);
  assert.equal(weights.smartText(actions.smartFrom(idle)), actions.SMART_OFF_TEXT);
  const m = actions.MEASURE.cylindrical;
  const smart = { enabled: true, geometryMode: "cylindrical", circumference: 30 };
  assert.equal(weights.computedHint({ resinName: "", usableHeight: 48 }, smart, m), "no resin");
  assert.equal(weights.computedHint({ resinName: "HX204", usableHeight: 0 }, smart, m), "no height");
  assert.equal(weights.computedHint({ resinName: "HX204", usableGallons: 0 }, smart, actions.MEASURE.volume), "no capacity");
  assert.equal(weights.computedHint({ resinName: "HX204", usableHeight: 48 }, { enabled: true, geometryMode: "cylindrical", circumference: 0 }, m), "no hopper size", "the hint names neither diameter nor circumference: either may be how it is entered");
  assert.equal(weights.computedHint({ resinName: "HX204", usableHeight: 48 }, smart, m), "no bulk density");
  assert.equal(weights.computedHint({ resinName: "HX204", usableGallons: 12 }, { enabled: true, geometryMode: "volume", circumference: 0 }, actions.MEASURE.volume), "no bulk density");
});

test("compatibility and preview: a profile for another line type or layer layout cannot load; the preview counts the entered weights that would change", () => {
  const resolved = resolvedFrom();
  const model = resolved.line;
  assert.equal(weights.compatibility(profileOf("p", "x"), model).ok, true);
  assert.match(weights.compatibility(profileOf("p", "x", { lineType: 5 }), model).message, /5-layer line; this line runs 3/);
  assert.match(weights.compatibility(profileOf("p", "x", { layers: [{ name: "A", weights: [] }, { name: "B", weights: [] }, { name: "D", weights: [] }] }), model).message, /layers \(A, B, D\) are not this line's \(A, B, C\)/);
  assert.match(weights.compatibility(profileOf("p", "x"), null).message, /No line is shown/);
  assert.equal(weights.compatibility(null, model).ok, false);
  const same = weights.previewFor(profileOf("p", "x"), resolved);
  assert.deepEqual(same, { changed: 0, total: 16, text: weights.NOTHING_CHANGES });
  const heavier = weights.previewFor(profileOf("p", "x", { layers: [{ name: "A", weights: [450, 380, 120, 0, 0, 0] }, { name: "B", weights: [620, 0, 140, 0] }, { name: "C", weights: [500, 90, 0, 0, 0, 0] }] }), resolved);
  assert.equal(heavier.changed, 2);
  assert.equal(heavier.text, "2 of 16 hopper weights change");
  const one = weights.previewFor(profileOf("p", "x", { layers: [{ name: "A", weights: [401, 380, 120, 0, 0, 0] }, { name: "B", weights: [620, 260, 140, 0] }, { name: "C", weights: [500, 90, 0, 0, 0, 0] }] }), resolved);
  assert.equal(one.text, "1 of 16 hopper weights changes");
  assert.equal(weights.previewFor(profileOf("p", "x"), null), null);
  // The preview compares ENTERED weights: a computed one changes nothing here.
  const smart = resolvedFrom(snap => smartLine(snap));
  assert.equal(weights.previewFor(profileOf("p", "x"), smart).changed, 0);
  assert.equal(weights.rowMeta(profileOf("p", "x", { hasGeometry: true })).split(" · ").pop(), "geometry");
});

/* ----------------------------------------------------------------------
 *   Shapes
 * -------------------------------------------------------------------- */

test("off: every hopper has a weight field and nothing else; the switch is withheld off an identified line; circumference is hidden", () => {
  const { view, said } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  assert.equal(view.element.getAttribute("data-shape"), "off");
  assert.equal(view.shape(), "off");
  const fields = view.element.querySelectorAll(".slate-weights__field[data-kind='weight']");
  assert.equal(fields.length, 16);
  assert.equal(view.element.querySelectorAll(".slate-weights__field[data-kind='geometry']").length, 0);
  assert.equal(view.element.querySelectorAll(".slate-weights__computed").length, 0);
  assert.equal(field(view, "A:0").value, "400");
  assert.equal(field(view, "A:3").value, "", "an empty hopper shows a zero");
  assert.ok(rowOf(view, "A:3").classList.contains("is-empty"));
  assert.equal(rowOf(view, "A:0").querySelector(".slate-weights__resin").textContent, "HX204");
  assert.equal(rowOf(view, "A:0").getAttribute("data-hopper"), "A1");
  // No heading row: each field carries its unit, and its name as its label.
  assert.equal(view.element.querySelectorAll(".slate-weights__columns, .slate-weights__column").length, 0);
  assert.equal(rowOf(view, "A:0").querySelector(".slate-weights__unit").textContent, "lb");
  assert.deepEqual(view.element.querySelectorAll(".slate-weights__layer").map(node => node.getAttribute("data-layer")), ["A", "B", "C"]);
  assert.equal(view.element.querySelector(".slate-section__subtitle").textContent, "Line 5 (demo) · 16 hoppers · Smart Hoppers unavailable · Live");
  assert.equal(view.element.querySelector(".slate-weights__smart-text").textContent, actions.SMART_UNAVAILABLE_TEXT);
  const toggle = view.element.querySelector("[data-slate-smart]");
  assert.equal(toggle.getAttribute("role"), "switch");
  assert.equal(toggle.getAttribute("aria-checked"), "false");
  assert.equal(toggle.getAttribute("data-able"), "false");
  assert.match(toggle.getAttribute("title"), /identified line/);
  click(toggle);
  assert.deepEqual(said, [`Smart Hoppers cannot be changed here: ${actions.SMART_UNAVAILABLE_TEXT}`]);
  assert.ok(view.element.querySelector(".slate-weights__circumference").hasAttribute("hidden"));
});

test("smart:cylindrical: a height field and a computed readout per row, the circumference in the bar; smart:volume: gallons and no circumference", () => {
  const { view } = boot();
  view.update(resolvedFrom(snap => smartLine(snap)), { kind: "structural" });
  assert.equal(view.element.getAttribute("data-shape"), "smart:cylindrical");
  assert.equal(view.element.querySelectorAll(".slate-weights__field[data-kind='geometry']").length, 16);
  assert.equal(view.element.querySelectorAll(".slate-weights__column").length, 0);
  assert.equal(rowOf(view, "A:0").querySelector(".slate-weights__geometry .slate-weights__unit").textContent, "in");
  assert.equal(field(view, "A:0", "geometry").value, "48");
  assert.equal(field(view, "A:0", "geometry").getAttribute("aria-label"), "A1 usable height, inches");
  assert.equal(rowOf(view, "A:0").querySelector(".slate-weights__geometry .slate-weights__unit").textContent, "in");
  const a1 = rowOf(view, "A:0").querySelector(".slate-weights__computed");
  assert.equal(a1.textContent, "✓ 412 lb");
  assert.equal(a1.getAttribute("data-kind"), "computed");
  assert.match(a1.getAttribute("title"), /A1's usable height and HX204's bulk density \(44\.9 lb\/ft³\)/);
  assert.ok(rowOf(view, "A:0").classList.contains("is-smart"));
  const a2 = rowOf(view, "A:1").querySelector(".slate-weights__computed");
  assert.equal(a2.textContent, "no bulk density");
  assert.equal(a2.getAttribute("data-kind"), "hint");
  assert.ok(!rowOf(view, "A:1").classList.contains("is-smart"));
  assert.equal(rowOf(view, "A:2").querySelector(".slate-weights__computed").textContent, "no height");
  assert.equal(rowOf(view, "A:3").querySelector(".slate-weights__computed").textContent, "no resin");
  const circumference = view.element.querySelector(".slate-weights__circumference");
  assert.ok(!circumference.hasAttribute("hidden"));
  assert.equal(field(view, "circumference", "circumference").value, "30");
  assert.equal(view.element.querySelector("[data-slate-smart]").getAttribute("aria-checked"), "true");
  assert.equal(view.element.querySelector(".slate-weights__smart-text").textContent, actions.SMART_ON_TEXT);

  view.update(resolvedFrom(snap => { smartLine(snap, { mode: "volume", circumference: 0 }); snap.layers[0].hoppers[0].usableGallons = 12; }), { kind: "values" });
  assert.equal(view.element.getAttribute("data-shape"), "smart:volume");
  assert.equal(field(view, "A:0", "geometry").value, "12");
  assert.equal(rowOf(view, "A:0").querySelector(".slate-weights__geometry .slate-weights__unit").textContent, "gal");
  assert.equal(rowOf(view, "A:1").querySelector(".slate-weights__computed").textContent, "no capacity");
  assert.ok(circumference.hasAttribute("hidden"), "a volume line has no shared circumference");
  assert.match(field(view, "A:0", "geometry").getAttribute("aria-label"), /capacity, gallons/i, "the geometry field lost its name");
});

test("a shape change rebuilds the rows; a values change patches the same field in place", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const before = field(view, "A:0");
  view.update(resolvedFrom(snap => { snap.layers[0].hoppers[0].weight = 420; snap.layers[0].hoppers[0].effectiveWeight = 420; }), { kind: "values" });
  assert.ok(field(view, "A:0") === before, "a values change rebuilt the row");
  assert.equal(before.value, "420");
  view.update(resolvedFrom(snap => smartLine(snap)), { kind: "values" });
  assert.ok(field(view, "A:0") !== before, "the switch flipping did not rebuild the rows");
  assert.ok(!view.element.contains(before));
  const smart = field(view, "A:0");
  view.update(resolvedFrom(snap => { smartLine(snap, { enabled: false }); }), { kind: "values" });
  assert.equal(view.element.getAttribute("data-shape"), "off");
  assert.ok(field(view, "A:0") !== smart);
  assert.equal(view.element.querySelectorAll(".slate-weights__field[data-kind='geometry']").length, 0);
});

/* ----------------------------------------------------------------------
 *   The fields
 * -------------------------------------------------------------------- */

test("a weight commits on Enter as one setHopperWeight to Current, the boot hears of it, and the field re-reads the line's value", () => {
  let resolved = resolvedFrom();
  const { view, commands, committed } = boot({
    republish(v) { resolved = resolvedFrom(snap => { snap.layers[0].hoppers[0].weight = 450; snap.layers[0].hoppers[0].effectiveWeight = 450; }); v.update(resolved, { kind: "values", own: true }); }
  });
  view.update(resolved, { kind: "structural" });
  const input = field(view, "A:0");
  type(input, "450");
  assert.ok(rowOf(view, "A:0").classList.contains("is-editing"));
  assert.deepEqual(view.editing(), { key: "A:0", kind: "weight", base: "400" });
  enter(input);
  assert.deepEqual(commands.calls, [{ command: "setHopperWeight", args: { recipe: "current", layer: "A", index: 0, weight: "450" } }]);
  assert.equal(committed.length, 1);
  assert.equal(input.value, "450");
  assert.equal(view.editing().base, "450", "the draft does not start from the committed value");
  assert.equal(input.getAttribute("aria-invalid"), null);
  // Enter again with nothing changed sends nothing; blur closes the draft.
  enter(input);
  assert.equal(commands.calls.length, 1);
  blur(input);
  assert.equal(commands.calls.length, 1);
  assert.equal(view.editing(), null);
  assert.ok(!rowOf(view, "A:0").classList.contains("is-editing"));
});

test("blank clears (0); blur commits once; geometry and circumference go as their own commands", () => {
  const { view, commands } = boot();
  view.update(resolvedFrom(snap => smartLine(snap)), { kind: "structural" });
  const weight = field(view, "B:0");
  type(weight, "");
  blur(weight);
  const height = field(view, "A:2", "geometry");
  type(height, "50");
  blur(height);
  enter(height);
  const circumference = field(view, "circumference", "circumference");
  type(circumference, "32");
  enter(circumference);
  assert.deepEqual(commands.calls, [
    { command: "setHopperWeight", args: { recipe: "current", layer: "B", index: 0, weight: 0 } },
    { command: "setHopperGeometry", args: { recipe: "current", layer: "A", index: 2, dimension: "height", value: "50" } },
    { command: "setHopperCircumference", args: { circumference: "32" } }
  ]);
  for (const call of commands.calls) assert.ok(!contract.normalizeArguments(call.command, call.args).error, call.command);
});

test("the hopper size is entered as an inside diameter by choice: shown as C / pi, sent as the circumference it stands for; the switch shows the same stored size either way", () => {
  const { view, commands, display } = boot({ measure: "diameter" });
  view.update(resolvedFrom(snap => smartLine(snap, { circumference: actions.circumferenceFrom(15) })), { kind: "structural" });
  const size = field(view, "circumference", "circumference");
  const options = view.element.querySelectorAll("[data-measure]");
  assert.deepEqual(options.map(one => one.getAttribute("data-measure")), ["diameter", "circumference"]);
  assert.deepEqual(options.map(one => one.getAttribute("aria-checked")), ["true", "false"]);
  assert.match(size.getAttribute("aria-label"), /inside diameter/);
  assert.equal(size.value, "15", "the stored circumference is not shown as its diameter");
  // A typed diameter goes to the line as its circumference.
  type(size, "16");
  enter(size);
  assert.deepEqual(commands.calls, [{ command: "setHopperCircumference", args: { circumference: actions.circumferenceFrom(16) } }]);
  assert.ok(!contract.normalizeArguments(commands.calls[0].command, commands.calls[0].args).error);
  blur(size);
  // Circumference chosen: the same stored size, shown as itself.
  click(options[1]);
  assert.equal(display.getMeasure(), "circumference");
  assert.deepEqual(options.map(one => one.getAttribute("aria-checked")), ["false", "true"]);
  assert.equal(size.value, String(actions.circumferenceFrom(15)));
  assert.match(size.getAttribute("aria-label"), /circumference/);
  assert.equal(commands.calls.length, 1, "switching the way it is entered sent something");
});

test("the size converts both ways without drift: a typed diameter comes back as typed, and nothing is not a size", () => {
  for (const d of [15, 14.5, 18.25, 22]) assert.equal(actions.diameterFrom(actions.circumferenceFrom(d)), d);
  assert.equal(actions.circumferenceFrom(0), 0);
  assert.equal(actions.diameterFrom(0), 0);
  assert.equal(actions.diameterFrom("x"), 0);
  assert.ok(Math.abs(actions.circumferenceFrom(15) - 47.124) < 1e-9);
});

test("a refusal keeps the draft, marks the field and says the application's words on the row; a good entry clears them", () => {
  const commands = makeCommands({ capabilities: ALL, answer: (command, args) => (args.weight === "-3" ? { ok: false, code: "out_of_range", message: "Pounds cannot be less than 0." } : undefined) });
  const { view, committed } = boot({ commands });
  view.update(resolvedFrom(), { kind: "structural" });
  const input = field(view, "A:0");
  type(input, "-3");
  enter(input);
  assert.equal(input.value, "-3");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  const note = rowOf(view, "A:0").querySelector(".slate-weights__row-note");
  assert.equal(note.textContent, "Pounds cannot be less than 0.");
  assert.ok(!note.hasAttribute("hidden"));
  assert.equal(committed.length, 0);
  type(input, "410");
  enter(input);
  assert.equal(input.getAttribute("aria-invalid"), null);
  assert.ok(note.hasAttribute("hidden"));
  assert.equal(committed.length, 1);
  // The circumference's refusal lands on the section's line.
  const refusing = makeCommands({ capabilities: ALL, answer: command => (command === "setHopperCircumference" ? { ok: false, code: "bad_argument", message: "This line measures its hoppers by volume; it has no shared circumference." } : undefined) });
  const other = boot({ commands: refusing });
  other.view.update(resolvedFrom(snap => smartLine(snap)), { kind: "structural" });
  const circumference = field(other.view, "circumference", "circumference");
  type(circumference, "40");
  enter(circumference);
  assert.equal(other.view.element.querySelector(".slate-weights__note").textContent, "This line measures its hoppers by volume; it has no shared circumference.");
  assert.equal(circumference.value, "40");
});

test("Escape restores the line's value and stops at the field; a draft dropped by Escape sends nothing", () => {
  const { view, commands } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const input = field(view, "A:0");
  type(input, "999");
  const escape = key(input, "Escape");
  assert.equal(escape._stopped, true);
  assert.equal(input.value, "400");
  assert.equal(commands.calls.length, 0);
  blur(input);
  assert.equal(commands.calls.length, 0);
});

test("a foreign publish under an open draft marks the field and says so without writing it; an own publish does not; a resting field follows", () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const input = field(view, "A:0");
  const other = field(view, "A:1");
  type(input, "45");
  view.update(resolvedFrom(snap => { snap.layers[0].hoppers[0].weight = 420; snap.layers[0].hoppers[1].weight = 390; }), { kind: "values", own: false });
  assert.equal(input.value, "45", "the draft was overwritten");
  assert.ok(input.classList.contains("is-changed-underneath"));
  assert.equal(rowOf(view, "A:0").querySelector(".slate-weights__row-note").textContent, "A1's weight is now 420 lb in the application; what you are entering has not been applied.");
  assert.equal(other.value, "390", "a resting field did not follow the line");
  // Escape drops the draft and the mark, and the field reads the line.
  key(input, "Escape");
  assert.equal(input.value, "420");
  assert.ok(!input.classList.contains("is-changed-underneath"));
  assert.ok(rowOf(view, "A:0").querySelector(".slate-weights__row-note").hasAttribute("hidden"));
  // An own echo under a draft is not someone else's change.
  type(input, "46");
  view.update(resolvedFrom(snap => { snap.layers[0].hoppers[0].weight = 421; }), { kind: "values", own: true });
  assert.ok(!input.classList.contains("is-changed-underneath"));
  assert.equal(input.value, "46");
});

test("a structural publish drops an open draft and says so when it was foreign", () => {
  const { view, said, commands } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const input = field(view, "A:0");
  type(input, "45");
  view.update(resolvedFrom(snap => { snap.line.hopperCounts = [6, 6, 6]; }), { kind: "structural", own: false });
  assert.deepEqual(said, [weights.ABANDONED]);
  assert.equal(view.editing(), null);
  assert.equal(commands.calls.length, 0);
  assert.equal(field(view, "A:0").value, "400");
  // The switch flipping under a draft: the rows are rebuilt, the draft is
  // the operator's own doing when the publish is.
  type(field(view, "A:0"), "46");
  view.update(resolvedFrom(snap => smartLine(snap)), { kind: "values", own: true });
  assert.deepEqual(said, [weights.ABANDONED]);
  assert.equal(view.editing(), null);
});

test("read-only withholds every field and the switch with the reason; refresh() after the flip re-enables them; onHide drops a draft", () => {
  const { view, commands, said, setReadOnly } = boot({ readOnly: true });
  view.update(resolvedFrom(snap => smartLine(snap)), { kind: "structural" });
  assert.ok(view.element.classList.contains("is-readonly"));
  const input = field(view, "A:0");
  assert.ok(input.hasAttribute("readonly"));
  assert.equal(input.getAttribute("aria-disabled"), "true");
  assert.match(input.getAttribute("title"), /read-only/);
  assert.ok(field(view, "A:0", "geometry").hasAttribute("readonly"));
  assert.ok(field(view, "circumference", "circumference").hasAttribute("readonly"));
  const toggle = view.element.querySelector("[data-slate-smart]");
  assert.equal(toggle.getAttribute("data-able"), "false");
  click(toggle);
  assert.equal(said[0], `Smart Hoppers cannot be changed here: ${actions.READ_ONLY_REASON}`);
  // A readonly field opens no draft: focus is ignored, Enter sends nothing.
  input.dispatchEvent({ type: "focus", target: input });
  assert.equal(view.editing(), null);
  input.value = "1";
  enter(input);
  assert.equal(commands.calls.length, 0);
  input.value = "400";
  setReadOnly(false);
  view.refresh();
  assert.ok(!input.hasAttribute("readonly"));
  assert.equal(toggle.getAttribute("data-able"), "true");
  assert.ok(!view.element.classList.contains("is-readonly"));
  type(input, "455");
  view.onHide();
  assert.equal(view.editing(), null);
  assert.equal(input.value, "400");
  assert.equal(commands.calls.length, 0, "leaving the section committed the draft");
});

test("the switch dispatches setSmartHoppers for the other state and the boot hears of it; a refusal shows on the section's line", () => {
  const { view, commands, committed } = boot();
  view.update(resolvedFrom(snap => smartLine(snap, { enabled: false })), { kind: "structural" });
  const toggle = view.element.querySelector("[data-slate-smart]");
  assert.equal(toggle.getAttribute("data-able"), "true");
  assert.equal(toggle.getAttribute("aria-checked"), "false");
  click(toggle);
  assert.deepEqual(commands.calls, [{ command: "setSmartHoppers", args: { enabled: true } }]);
  assert.equal(committed.length, 1);
  assert.equal(toggle.getAttribute("aria-checked"), "false", "the switch moved before the line said so");
  view.update(resolvedFrom(snap => smartLine(snap)), { kind: "values", own: true });
  assert.equal(toggle.getAttribute("aria-checked"), "true");
  click(toggle);
  assert.deepEqual(commands.calls[1], { command: "setSmartHoppers", args: { enabled: false } });
  const refusing = makeCommands({ capabilities: ALL, answer: () => ({ ok: false, code: "unavailable", message: actions.SMART_UNAVAILABLE_TEXT }) });
  const other = boot({ commands: refusing });
  other.view.update(resolvedFrom(snap => smartLine(snap, { enabled: false })), { kind: "structural" });
  click(other.view.element.querySelector("[data-slate-smart]"));
  assert.equal(other.view.element.querySelector(".slate-weights__note").textContent, actions.SMART_UNAVAILABLE_TEXT);
  assert.ok(other.view.element.querySelector(".slate-weights__note").classList.contains("is-error"));
  assert.equal(other.committed.length, 0);
});

test("a demo or absent bridge withholds the fields; no line draws no rows and says so", () => {
  const { view } = boot({ commands: null });
  view.update(resolvedFrom(), { kind: "structural" });
  assert.ok(field(view, "A:0").hasAttribute("readonly"));
  assert.match(field(view, "A:0").getAttribute("title"), /no application is connected/);
  view.update(null, { kind: "structural" });
  assert.equal(view.element.querySelectorAll(".slate-weights__row").length, 0);
  assert.ok(!view.element.querySelector(".slate-weights__empty").hasAttribute("hidden"));
  assert.equal(view.element.querySelector(".slate-section__subtitle").textContent, weights.NO_LINE);
});

/* ----------------------------------------------------------------------
 *   The profiles
 * -------------------------------------------------------------------- */

test("the profiles list the line's saved weights; selecting one shows its weights and the actions; Load confirms in the floor UI's words with a preview", async () => {
  const { view } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const rows = view.element.querySelectorAll(".slate-book__row[data-profile]");
  assert.deepEqual(rows.map(row => row.getAttribute("data-profile")), ["p1", "p2"]);
  assert.equal(rows[1].querySelector(".slate-book__row-meta").textContent, "3 layers · Sep 21 · geometry");
  assert.equal(view.element.querySelector(".slate-weights__profiles .slate-section__subtitle").textContent, "Line 5 · 2 saved");
  assert.equal(view.element.querySelector(".slate-book__hint").textContent, weights.SELECT_HINT);
  click(rows[1]);
  assert.equal(view.element.querySelector(".slate-book__detail-name").textContent, "Heavy");
  assert.equal(view.element.querySelectorAll(".slate-book__hopper").length, 8);
  assert.equal(view.element.querySelector(".slate-book__hopper .slate-book__hopper-resin").textContent, "450 lb");
  click(view.element.querySelector("[data-book-action='load']"));
  const confirm = view.element.querySelector(".slate-book__confirm");
  assert.equal(confirm.getAttribute("data-kind"), "load");
  assert.equal(confirm.querySelector(".slate-book__confirm-text").textContent, `Heavy. ${profileActions.LOAD_TEXT} ${profileActions.GEOMETRY_TEXT}`);
  assert.equal(confirm.querySelector(".slate-book__preview").textContent, "1 of 16 hopper weights changes");
  assert.equal(confirm.querySelector("[data-book-action='confirm']").textContent, "Load Weights");
  // Without geometry the profile's confirm has no geometry line. (The
  // list is repainted on a selection: query the row afresh.)
  click(view.element.querySelector(".slate-book__row[data-profile='p1']"));
  click(view.element.querySelector("[data-book-action='load']"));
  assert.equal(view.element.querySelector(".slate-book__confirm-text").textContent, `Standard. ${profileActions.LOAD_TEXT}`);
  assert.equal(view.element.querySelector(".slate-book__preview").textContent, "Nothing would change");
});

test("Load, Update and Delete each send one request after their confirm; the note says what happened; a vanished profile clears the selection", async () => {
  const profiles = makeProfiles(bookOf());
  const { view } = boot({ profiles });
  view.update(resolvedFrom(), { kind: "structural" });
  click(view.element.querySelector(".slate-book__row[data-profile='p1']"));
  click(view.element.querySelector("[data-book-action='load']"));
  click(view.element.querySelector(".slate-book__confirm [data-book-action='confirm']"));
  assert.equal(view.getState().pending, "load");
  assert.ok(view.element.querySelector("[data-book-action='update']").hasAttribute("disabled"), "actions stayed live while a request was out");
  await tick();
  assert.equal(view.getState().pending, null);
  assert.equal(view.element.querySelector(".slate-book__note").textContent, profileActions.WORDING.loaded("Standard"));
  click(view.element.querySelector("[data-book-action='update']"));
  assert.equal(view.element.querySelector(".slate-book__confirm").getAttribute("data-kind"), "update");
  assert.equal(view.element.querySelector(".slate-book__confirm-text").textContent, profileActions.WORDING.confirmUpdate("Standard"));
  click(view.element.querySelector(".slate-book__confirm [data-book-action='confirm']"));
  await tick();
  click(view.element.querySelector("[data-book-action='more']"));
  click(view.element.querySelector("[data-book-action='delete']"));
  assert.equal(view.element.querySelector(".slate-book__confirm").getAttribute("data-kind"), "delete");
  click(view.element.querySelector(".slate-book__confirm [data-book-action='confirm']"));
  await tick();
  assert.deepEqual(profiles.requests, [
    { action: "loadWeightProfile", args: { id: "p1" } },
    { action: "replaceWeightProfile", args: { id: "p1" } },
    { action: "deleteWeightProfile", args: { id: "p1" } }
  ]);
  assert.equal(view.getState().selectedId, null);
  assert.equal(view.element.querySelector(".slate-book__note").textContent, profileActions.WORDING.deleted("Standard"));
  // The bridge publishes the profile gone: nothing is selected, nothing breaks.
  profiles.set(bookOf({ profiles: [profileOf("p2", "Heavy")], count: 1 }));
  assert.equal(view.element.querySelectorAll(".slate-book__row[data-profile]").length, 1);
});

test("an incompatible profile cannot be loaded, with the reason; a not_found answer drops the selection", async () => {
  const profiles = makeProfiles(bookOf({ profiles: [profileOf("p9", "Five layer", { lineType: 5 }), profileOf("p1", "Standard")], count: 2 }), { answer: (action, args) => (action === "loadWeightProfile" && args.id === "p1" ? { ok: false, code: "not_found", message: "That profile is gone." } : undefined) });
  const { view } = boot({ profiles });
  view.update(resolvedFrom(), { kind: "structural" });
  click(view.element.querySelector(".slate-book__row[data-profile='p9']"));
  assert.match(view.element.querySelector(".slate-book__compat[data-kind='incompatible']").textContent, /5-layer line/);
  click(view.element.querySelector("[data-book-action='load']"));
  const go = view.element.querySelector(".slate-book__confirm [data-book-action='confirm']");
  assert.ok(go.hasAttribute("disabled"));
  assert.match(go.getAttribute("title"), /5-layer/);
  assert.match(view.element.querySelector(".slate-book__preview").textContent, /5-layer/);
  click(view.element.querySelector(".slate-book__row[data-profile='p1']"));
  click(view.element.querySelector("[data-book-action='load']"));
  click(view.element.querySelector(".slate-book__confirm [data-book-action='confirm']"));
  await tick();
  assert.equal(view.getState().selectedId, null);
  assert.equal(view.element.querySelector(".slate-book__note").textContent, "That profile is gone.");
});

test("Save current weights takes a name; a collision offers Replace existing, which replaces that profile; rename and duplicate go by id", async () => {
  const collide = { ok: false, code: "duplicate_name", message: "exists", field: "name" };
  const profiles = makeProfiles(bookOf(), { answer: (action, args) => (action === "saveCurrentWeights" && args.name === "Standard" ? collide : (action === "saveCurrentWeights" ? { ok: true, id: "p3" } : undefined)) });
  const { view } = boot({ profiles });
  view.update(resolvedFrom(), { kind: "structural" });
  click(view.element.querySelector("[data-book-action='save']"));
  const entry = view.element.querySelector(".slate-book__entry");
  assert.ok(!entry.hasAttribute("hidden"));
  assert.equal(entry.querySelector(".slate-book__entry-label").textContent, "Save the line's current weights as");
  const name = entry.querySelector(".slate-book__name");
  assert.ok(name.focused);
  key(name, "Enter");
  assert.equal(view.element.querySelector(".slate-book__note").textContent, profileActions.WORDING.nameNeeded);
  name.value = "Standard";
  key(name, "Enter");
  await tick();
  assert.equal(view.element.querySelector(".slate-book__note").textContent, profileActions.WORDING.duplicateOffer("Standard"));
  const replace = entry.querySelector("[data-book-action='replace']");
  assert.ok(!replace.hasAttribute("hidden"));
  assert.equal(view.getState().selectedId, "p1");
  click(replace);
  await tick();
  assert.ok(entry.hasAttribute("hidden"));
  assert.equal(view.element.querySelector(".slate-book__note").textContent, profileActions.WORDING.replaced("Standard"));
  click(view.element.querySelector("[data-book-action='save']"));
  name.value = "  New   one ";
  click(entry.querySelector("[data-book-action='confirm-entry']"));
  await tick();
  assert.equal(view.element.querySelector(".slate-book__note").textContent, profileActions.WORDING.saved("New one"));
  assert.equal(view.getState().selectedId, "p3");
  // Rename and duplicate from the detail of a selected profile.
  click(view.element.querySelector(".slate-book__row[data-profile='p2']"));
  click(view.element.querySelector("[data-book-action='more']"));
  click(view.element.querySelector("[data-book-action='rename']"));
  assert.equal(name.value, "Heavy");
  name.value = "Heavier";
  key(name, "Enter");
  await tick();
  click(view.element.querySelector("[data-book-action='more']"));
  click(view.element.querySelector("[data-book-action='duplicate']"));
  assert.equal(name.value, "Heavy copy");
  key(name, "Enter");
  await tick();
  assert.deepEqual(profiles.requests, [
    { action: "saveCurrentWeights", args: { name: "Standard" } },
    { action: "replaceWeightProfile", args: { id: "p1" } },
    { action: "saveCurrentWeights", args: { name: "New one" } },
    { action: "renameWeightProfile", args: { id: "p2", name: "Heavier" } },
    { action: "duplicateWeightProfile", args: { id: "p2", name: "Heavy copy" } }
  ]);
});

test("read-only keeps only Refresh among the profile actions and says why; Refresh is busy while the line reads; no bridge lists nothing", () => {
  const profiles = makeProfiles(bookOf({ refreshing: true }));
  const { view, said } = boot({ profiles, readOnly: true });
  view.update(resolvedFrom(), { kind: "structural" });
  const save = view.element.querySelector("[data-book-action='save']");
  assert.equal(save.getAttribute("data-able"), "false");
  click(save);
  assert.equal(said[0], `Save current weights is unavailable: ${profileActions.READ_ONLY_REASON}`);
  const refresh = view.element.querySelector("[data-book-action='refresh']");
  assert.ok(refresh.classList.contains("is-busy"));
  assert.equal(refresh.textContent, "Refreshing…");
  click(view.element.querySelector(".slate-book__row[data-profile='p1']"));
  assert.equal(view.element.querySelector("[data-book-action='load']").getAttribute("data-able"), "false");
  const without = boot({ profiles: null });
  without.view.update(resolvedFrom(), { kind: "structural" });
  assert.equal(without.view.element.querySelector(".slate-book__empty").textContent, weights.emptyText(null, false));
  assert.equal(without.view.element.querySelector(".slate-weights__profiles .slate-section__subtitle").textContent, "Not connected");
});

test("a weight being edited carries Revert: its press wins over the blur it causes - the draft goes back and nothing is sent", () => {
  const { view, commands } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  const input = field(view, "A:1");
  const revert = input.parentNode.querySelector("[data-slate-revert]");
  assert.ok(revert, "the field has no Revert");
  assert.ok(revert.hasAttribute("hidden"), "Revert shows before the field is edited");
  const resting = input.value;
  type(input, "999");
  assert.ok(!revert.hasAttribute("hidden"), "Revert is not offered while the field is edited");
  const press = { type: "pointerdown", pointerType: "touch", _defaultPrevented: false, preventDefault() { this._defaultPrevented = true; } };
  for (const handler of revert.listeners.pointerdown) handler(press);
  assert.equal(press._defaultPrevented, true);
  blur(input);
  click(revert);
  assert.deepEqual(commands.calls, [], "Revert sent the draft");
  assert.equal(input.value, resting);
  assert.ok(revert.hasAttribute("hidden"));

  // Without Revert, a blur commits as it always has.
  type(input, "999");
  blur(input);
  assert.equal(commands.calls.length, 1);
});

test("a locked weight says why on a tap, since its title never shows under a finger", () => {
  const { view, said } = boot({ readOnly: true });
  view.update(resolvedFrom(), { kind: "structural" });
  const input = field(view, "A:1");
  assert.ok(input.hasAttribute("readonly"));
  click(input);
  assert.match(said[said.length - 1], /^Cannot be changed here: /);
});

test("a hopper empty in both recipes is marked vacant (a phone leaves it out), unless one is being typed in; Show empty hoppers brings them back and says how many", () => {
  const { view } = boot();
  const plan = resolvedFrom(snap => {
    snap.nextRecipe = { layers: snap.layers.map(layer => ({ name: layer.name, layerPct: layer.layerPct, hoppers: layer.hoppers.map(h => ({ index: h.index, pct: h.pct, resinName: h.resinName })) })) };
    snap.nextRecipe.layers[0].hoppers[5].resinName = "FILL1";
  });
  view.update(plan, { kind: "structural" });
  const button = view.element.querySelector(".slate-weights__show-empty");
  const vacant = () => view.element.querySelectorAll(".slate-weights__row.is-vacant").map(row => row.getAttribute("data-key")).sort();
  const before = vacant();
  assert.ok(before.length > 0, "the demo line has no empty hopper");
  assert.ok(!before.includes("A:5"), "a hopper the plan fills was left out");
  for (const key of before) assert.equal(rowOf(view, key).querySelector(".slate-weights__resin").textContent, "—");
  assert.ok(!button.hasAttribute("hidden"));
  assert.equal(button.textContent, `Show empty hoppers (${before.length})`);
  click(button);
  assert.deepEqual(vacant(), []);
  assert.equal(button.textContent, "Hide empty hoppers");
  assert.equal(button.getAttribute("aria-pressed"), "true");
  click(button);
  assert.deepEqual(vacant(), before);
});

/* ----------------------------------------------------------------------
 *   Bulk edit
 * -------------------------------------------------------------------- */

const bulkSwitch = view => view.element.querySelector("[data-slate-weights-bulk]");
const bulkFoot = view => view.element.querySelector(".slate-weights__bulk-foot");
const bulkDo = (view, what) => view.element.querySelector(`[data-slate-weights-bulk-do='${what}']`);
const typed = (input, value) => { input.value = value; input.dispatchEvent({ type: "input", target: input }); };
const idOf = (view, key) => rowOf(view, key).querySelector(".slate-weights__id");

test("Bulk edit makes every weight a draft: typing sends nothing, a blur or Enter commits nothing, the switch, circumference and profiles stand aside, and the foot says what would change", () => {
  const { view, commands } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  assert.equal(bulkSwitch(view).getAttribute("data-able"), "true");
  assert.ok(bulkFoot(view).hasAttribute("hidden"));
  click(bulkSwitch(view));
  assert.ok(view.bulk());
  assert.equal(bulkSwitch(view).getAttribute("aria-pressed"), "true");
  assert.ok(view.element.hasAttribute("data-bulk"), "the profiles do not stand aside (weights.css keys on data-bulk)");
  assert.ok(!bulkFoot(view).hasAttribute("hidden"));
  assert.equal(field(view, "A:0").focused, true, "with a mouse the first field takes the typing");
  assert.equal(view.element.querySelector("[data-slate-smart]").getAttribute("data-able"), "false");
  assert.equal(view.element.querySelector(".slate-weights__field[data-kind='circumference']").hasAttribute("readonly"), true);

  const a1 = field(view, "A:0");
  typed(a1, "450");
  enter(a1);
  blur(a1);
  const b2 = field(view, "B:1");
  b2.dispatchEvent({ type: "focus", target: b2 });
  typed(b2, "");
  blur(b2);
  assert.equal(commands.calls.length, 0, "a draft reached the line");
  assert.equal(view.bulk().changes, 2);
  assert.ok(a1.classList.contains("is-drafted") && b2.classList.contains("is-drafted"));
  assert.ok(!field(view, "A:1").classList.contains("is-drafted"));
  assert.match(view.element.querySelector(".slate-recipe__bulk-summary").textContent, /^2 weights change on Apply/);
  // A typed value equal to the line's is no change.
  typed(field(view, "A:1"), "380.0");
  assert.equal(view.bulk().changes, 2);
  // Escape in a changed field puts it back.
  key(b2, "Escape");
  assert.equal(b2.value, "260");
  assert.equal(view.bulk().changes, 1);
});

test("Apply sends ONE setHopperWeights naming only what changed - blank as 0 - the form closes and the section says how many", () => {
  const { view, commands, committed, said } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  click(bulkSwitch(view));
  typed(field(view, "A:0"), "450");
  typed(field(view, "C:1"), "");
  click(bulkDo(view, "apply"));
  assert.deepEqual(commands.calls, [{ command: "setHopperWeights", args: { recipe: "current", weights: [{ layer: "A", index: 0, weight: 450 }, { layer: "C", index: 1, weight: 0 }] } }]);
  assert.equal(committed.length, 1);
  assert.equal(view.bulk(), null);
  assert.ok(bulkFoot(view).hasAttribute("hidden"));
  assert.equal(said[said.length - 1], "Applied 2 changes.");
  assert.equal(view.element.querySelector("[data-slate-smart]").getAttribute("data-able"), "false", "(no identified line in the demo: the switch stays unable, not bulk-held)");
});

test("nothing changed withholds Apply; a field that is not a number is marked and nothing is sent; a refusal keeps every draft with the application's words", () => {
  const refuse = makeCommands({ capabilities: ALL, answer: command => (command === "setHopperWeights" ? { ok: false, code: "bad_argument", message: "Hopper Z9 does not exist." } : undefined) });
  const { view, said } = boot({ commands: refuse });
  view.update(resolvedFrom(), { kind: "structural" });
  click(bulkSwitch(view));
  assert.equal(bulkDo(view, "apply").getAttribute("data-able"), "false");
  click(bulkDo(view, "apply"));
  assert.equal(refuse.calls.length, 0);
  typed(field(view, "A:0"), "heavy");
  typed(field(view, "A:1"), "-4");
  click(bulkDo(view, "apply"));
  assert.equal(refuse.calls.length, 0, "an unreadable draft was sent");
  assert.equal(field(view, "A:0").getAttribute("aria-invalid"), "true");
  assert.equal(field(view, "A:1").getAttribute("aria-invalid"), "true");
  assert.equal(view.element.querySelector(".slate-recipe__bulk-note").textContent, weights.BULK_INVALID);
  typed(field(view, "A:0"), "450");
  typed(field(view, "A:1"), "380");
  click(bulkDo(view, "apply"));
  assert.equal(refuse.calls.length, 1);
  assert.ok(view.bulk(), "a refusal closed the form");
  assert.equal(field(view, "A:0").value, "450");
  assert.equal(view.element.querySelector(".slate-recipe__bulk-note").textContent, "Hopper Z9 does not exist.");
  assert.ok(!said.includes("Applied 1 change."));
});

test("a hopper id picks its row, Shift a run within the layer, the layer's name the layer; Fill writes one weight into every picked field - still the draft - and Clear selection empties it", () => {
  const { view, commands } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  click(bulkSwitch(view));
  const fill = view.element.querySelector(".slate-recipe__fill");
  assert.ok(fill.hasAttribute("hidden"));
  click(idOf(view, "A:1"));
  idOf(view, "A:3").dispatchEvent({ type: "click", target: idOf(view, "A:3"), shiftKey: true });
  assert.deepEqual(view.bulk().picked, ["A:1", "A:2", "A:3"]);
  assert.ok(rowOf(view, "A:2").classList.contains("is-picked"));
  assert.ok(!fill.hasAttribute("hidden"));
  assert.equal(view.element.querySelector(".slate-recipe__fill-count").textContent, "3 selected");
  assert.ok(view.element.querySelector("[data-slate-weights-fill='clear']").classList.contains("is-lit"), "several picks left Clear selection unlit");
  click(view.element.querySelector(".slate-weights__layer[data-layer='B'] .slate-weights__layer-name"));
  assert.equal(view.bulk().picked.length, 7);
  // Nothing to fill says so.
  click(view.element.querySelector("[data-slate-weights-fill='fill']"));
  assert.equal(view.element.querySelector(".slate-recipe__bulk-note").textContent, weights.FILL_NOTHING);
  const fillWeight = view.element.querySelector("[data-slate-weights-fill-field='weight']");
  fillWeight.value = "500";
  click(view.element.querySelector("[data-slate-weights-fill='fill']"));
  for (const keyName of ["A:1", "A:2", "A:3", "B:0", "B:1", "B:2", "B:3"]) assert.equal(field(view, keyName).value, "500", `${keyName} was not filled`);
  assert.equal(field(view, "A:0").value, "400", "an unpicked field was filled");
  assert.equal(commands.calls.length, 0, "Fill reached the line");
  assert.equal(view.bulk().changes, 7);
  click(view.element.querySelector("[data-slate-weights-fill='clear']"));
  assert.deepEqual(view.bulk().picked, []);
  assert.ok(fill.hasAttribute("hidden"));
  assert.ok(!view.element.querySelector("[data-slate-weights-fill='clear']").classList.contains("is-lit"));
  click(bulkDo(view, "apply"));
  assert.equal(commands.calls.length, 1);
  assert.equal(commands.calls[0].command, "setHopperWeights");
  assert.equal(commands.calls[0].args.weights.length, 7);
});

test("with Smart Hoppers the geometry is drafted too: Apply sends one setHopperWeights and one setHopperGeometries in the line's dimension", () => {
  const { view, commands } = boot();
  view.update(resolvedFrom(snap => smartLine(snap)), { kind: "structural" });
  click(bulkSwitch(view));
  typed(field(view, "A:1"), "390");
  typed(field(view, "A:1", "geometry"), "50");
  assert.match(view.element.querySelector(".slate-recipe__bulk-summary").textContent, /1 weight and 1 height change/);
  assert.ok(!view.element.querySelector("[data-slate-weights-fill-field='geometry']").hasAttribute("hidden"));
  click(bulkDo(view, "apply"));
  assert.deepEqual(commands.calls, [
    { command: "setHopperWeights", args: { recipe: "current", weights: [{ layer: "A", index: 1, weight: 390 }] } },
    { command: "setHopperGeometries", args: { recipe: "current", geometries: [{ layer: "A", index: 1, dimension: "height", value: 50 }] } }
  ]);
  assert.equal(view.bulk(), null);
});

test("Cancel closes at once with nothing changed; with changes it arms, disarms after a moment, and a second press - or Escape twice - discards and says what was lost", () => {
  const { view, said, timers, commands } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  click(bulkSwitch(view));
  click(bulkDo(view, "cancel"));
  assert.equal(view.bulk(), null);
  click(bulkSwitch(view));
  typed(field(view, "A:0"), "450");
  click(bulkDo(view, "cancel"));
  assert.ok(view.bulk().armed);
  assert.equal(bulkDo(view, "cancel").textContent, "Discard 1 change");
  timers.advance(weights.BULK_ARM_MS || 4000);
  assert.equal(view.bulk().armed, false);
  assert.equal(bulkDo(view, "cancel").textContent, "Cancel");
  click(bulkDo(view, "cancel"));
  click(bulkDo(view, "cancel"));
  assert.equal(view.bulk(), null);
  assert.equal(field(view, "A:0").value, "400", "the discarded draft stayed in the field");
  assert.equal(said[said.length - 1], "The bulk edit was closed; 1 change was not applied.");
  click(bulkSwitch(view));
  typed(field(view, "A:0"), "450");
  key(view.element.querySelector(".slate-recipe__bulk-summary"), "Escape");
  key(view.element.querySelector(".slate-recipe__bulk-summary"), "Escape");
  assert.equal(view.bulk(), null);
  assert.equal(commands.calls.length, 0);
});

test("under the form a publish: an untouched field follows the line, a drafted one stands and says the move; a structural publish, read-only and a hide close it and say so", () => {
  const { view, said, setReadOnly } = boot();
  view.update(resolvedFrom(), { kind: "structural" });
  click(bulkSwitch(view));
  typed(field(view, "A:0"), "450");
  view.update(resolvedFrom(snap => { snap.layers[0].hoppers[0].weight = 410; snap.layers[0].hoppers[1].weight = 385; }), { kind: "values" });
  assert.equal(field(view, "A:0").value, "450", "another device's value took the draft");
  assert.ok(field(view, "A:0").classList.contains("is-changed-underneath"));
  assert.match(rowOf(view, "A:0").querySelector(".slate-weights__row-note").textContent, /is now 410 lb in the application/);
  assert.equal(field(view, "A:1").value, "385", "an untouched field did not follow the line");
  assert.equal(view.bulk().changes, 1);

  view.update(resolvedFrom(), { kind: "structural" });
  assert.equal(view.bulk(), null);
  assert.equal(said[said.length - 1], weights.BULK_ABANDONED);

  click(bulkSwitch(view));
  typed(field(view, "A:0"), "450");
  setReadOnly(true);
  view.refresh();
  assert.equal(view.bulk(), null);
  assert.equal(said[said.length - 1], weights.BULK_READ_ONLY);
  assert.equal(bulkSwitch(view).getAttribute("data-able"), "false");
  setReadOnly(false);
  view.refresh();

  click(bulkSwitch(view));
  typed(field(view, "A:0"), "450");
  view.onHide();
  assert.equal(view.bulk(), null);
  assert.equal(said[said.length - 1], "The bulk edit was closed; 1 change was not applied.");
});

test("without setHopperWeights Bulk edit is unable with the reason; under a finger it opens without taking the focus", () => {
  const some = makeCommands({ capabilities: ["setHopperWeight"] });
  const { view, said } = boot({ commands: some });
  view.update(resolvedFrom(), { kind: "structural" });
  assert.equal(bulkSwitch(view).getAttribute("data-able"), "false");
  assert.match(bulkSwitch(view).getAttribute("title"), /does not offer setHopperWeights/);
  click(bulkSwitch(view));
  assert.equal(view.bulk(), null);
  assert.match(said[said.length - 1], /setHopperWeights/);
  const finger = boot({ touch: true });
  finger.view.update(resolvedFrom(), { kind: "structural" });
  click(bulkSwitch(finger.view));
  assert.ok(finger.view.bulk());
  assert.notEqual(field(finger.view, "A:0").focused, true);
});

/* ----------------------------------------------------------------------
 *   Always a draft (a desktop's page)
 * -------------------------------------------------------------------- */

const fillWindow = view => view.element.querySelector(".slate-recipe__fill");

test("always a draft: no Bulk edit button; the page is a draft from its first publish, the fill window always up with the switch and the circumference in it; Apply leaves a fresh draft", () => {
  const { view, commands, said } = boot({ alwaysDraft: true });
  assert.equal(view.bulk(), null, "a draft with no rows");
  view.update(resolvedFrom(snap => smartLine(snap, { enabled: false })), { kind: "structural" });
  assert.equal(bulkSwitch(view), null, "the Bulk edit button is still there");
  assert.ok(view.bulk(), "the page is not a draft");
  assert.ok(!bulkFoot(view).hasAttribute("hidden"));
  assert.ok(!fillWindow(view).hasAttribute("hidden"), "the fill window waits for a pick");
  assert.ok(fillWindow(view).querySelector("[data-slate-smart]"), "the switch is not in the fill window");
  assert.ok(fillWindow(view).querySelector(".slate-weights__circumference"), "the circumference is not in the fill window");
  assert.equal(view.element.querySelector(".slate-weights__bar [data-slate-smart]"), null, "the switch stayed in the bar");
  assert.equal(view.element.querySelector(".slate-recipe__fill-count").textContent, weights.NONE_PICKED);
  assert.equal(view.element.querySelector("[data-slate-weights-fill='fill']").getAttribute("data-able"), "false");
  assert.equal(view.element.querySelector(".slate-recipe__bulk-summary").textContent, weights.DRAFT_IDLE);
  assert.ok(bulkDo(view, "cancel").hasAttribute("hidden"), "Cancel stands with nothing to discard");
  assert.ok(!view.element.hasAttribute("data-bulk"), "the profiles were set aside");
  assert.notEqual(field(view, "A:0").focused, true, "a publish took the focus");

  typed(field(view, "A:0"), "450");
  assert.ok(!bulkDo(view, "cancel").hasAttribute("hidden"));
  enter(field(view, "A:0"));
  blur(field(view, "A:0"));
  assert.equal(commands.calls.length, 0);
  click(bulkDo(view, "apply"));
  assert.deepEqual(commands.calls, [{ command: "setHopperWeights", args: { recipe: "current", weights: [{ layer: "A", index: 0, weight: 450 }] } }]);
  assert.equal(said[said.length - 1], "Applied 1 change.");
  assert.ok(view.bulk(), "after Apply the page is not a fresh draft");
  assert.equal(view.bulk().changes, 0);

  // Cancel with changes arms, a second press discards, and the page is a draft again.
  typed(field(view, "A:1"), "999");
  click(bulkDo(view, "cancel"));
  click(bulkDo(view, "cancel"));
  assert.equal(field(view, "A:1").value, "380");
  assert.ok(view.bulk() && view.bulk().changes === 0);
});

test("always a draft: the switch waits while there are changes, and flips without them - the rebuilt page a fresh draft; Load and Update wait too; the circumference commits on its own", () => {
  const { view, commands, said } = boot({ alwaysDraft: true });
  view.update(resolvedFrom(snap => { snap.line.identified = true; smartLine(snap, { enabled: false }); }), { kind: "structural" });
  const toggle = view.element.querySelector("[data-slate-smart]");
  const ableBefore = toggle.getAttribute("data-able");
  typed(field(view, "A:0"), "450");
  assert.equal(toggle.getAttribute("data-able"), "false");
  assert.match(toggle.getAttribute("title"), /Apply or discard the weight changes first/);
  click(toggle);
  assert.equal(commands.calls.length, 0);
  assert.equal(said[said.length - 1], weights.DRAFT_BUSY);
  // A profile's Load and Update wait for the changes.
  click(view.element.querySelector(".slate-book__row[data-profile='p2']"));
  click(view.element.querySelector("[data-book-action='load']"));
  assert.equal(view.element.querySelector(".slate-book__confirm"), null, "Load confirmed over waiting changes");
  assert.equal(said[said.length - 1], weights.DRAFT_BUSY);
  click(view.element.querySelector("[data-book-action='update']"));
  assert.equal(said[said.length - 1], weights.DRAFT_BUSY);
  // Put back: the switch reads the bridge again, and a shape change rebuilds into a fresh draft.
  typed(field(view, "A:0"), "400");
  assert.equal(toggle.getAttribute("data-able"), ableBefore);
  view.update(resolvedFrom(snap => { snap.line.identified = true; smartLine(snap); }), { kind: "structural", own: true });
  assert.ok(view.bulk(), "the rebuilt page is not a draft");
  assert.equal(view.bulk().changes, 0);
  assert.equal(field(view, "A:1", "geometry").value, "48", "the rebuilt page's fields do not show the line");
  assert.equal(view.element.querySelectorAll(".slate-weights__field.is-changed-underneath").length, 0, "the rebuild marked fields as moved underneath");
  // The circumference, in the fill window, commits on its own.
  const circumference = view.element.querySelector(".slate-weights__field[data-kind='circumference']");
  assert.equal(circumference.hasAttribute("readonly"), false);
  circumference.dispatchEvent({ type: "focus", target: circumference });
  circumference.value = "32";
  enter(circumference);
  assert.deepEqual(commands.calls[commands.calls.length - 1], { command: "setHopperCircumference", args: { circumference: "32" } });
});

test("always a draft: a structural publish from another device drops the changes and says so, then the page is a fresh draft; read-only locks the fields and lifting it drafts again", () => {
  const { view, said, setReadOnly } = boot({ alwaysDraft: true });
  view.update(resolvedFrom(), { kind: "structural" });
  typed(field(view, "A:0"), "450");
  view.update(resolvedFrom(), { kind: "structural" });
  assert.equal(said[said.length - 1], weights.BULK_ABANDONED);
  assert.ok(view.bulk() && view.bulk().changes === 0);
  assert.equal(field(view, "A:0").value, "400");
  setReadOnly(true);
  view.refresh();
  assert.equal(field(view, "A:0").hasAttribute("readonly"), true);
  setReadOnly(false);
  view.refresh();
  assert.ok(view.bulk());
  assert.equal(field(view, "A:0").hasAttribute("readonly"), false);
});

test("the layer's head reads as the Recipe's - the word apart from the letter - and a desktop's page draws its fields plain, keeping an edge for a refusal and a move underneath", () => {
  const { view } = boot({ alwaysDraft: true });
  view.update(resolvedFrom(), { kind: "structural" });
  const name = view.element.querySelector(".slate-weights__layer[data-layer='A'] .slate-weights__layer-name");
  assert.equal(name.textContent, "Layer A");
  assert.equal(name.querySelector(".slate-weights__layer-word").textContent, "Layer ");
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/weights.css"), "utf8");
  assert.match(css, /\.slate-root\[data-weights-layers="grid"\] \.slate-weights__layer-word \{[^}]*color: var\(--slate-text-muted\);/);
  assert.match(css, /\.slate-weights\.is-always-draft \.slate-weights__field:not\(\[data-kind="circumference"\]\) \{[^}]*--slate-field-border: var\(--slate-stroke\) solid transparent;[^}]*--slate-field-bg: transparent;/);
  assert.match(css, /\.slate-weights\.is-always-draft \.slate-weights__field\.is-drafted \{[^}]*color: var\(--slate-accent-text\);/);
  assert.match(css, /\.slate-weights\.is-always-draft \.slate-weights__field\[aria-invalid="true"\] \{\s*--slate-field-border: var\(--slate-stroke\) solid var\(--slate-danger\);/);
  assert.match(css, /\.slate-weights\.is-always-draft \.slate-weights__field\.is-changed-underneath \{\s*--slate-field-border: var\(--slate-stroke\) solid var\(--slate-info\);/);
});

test("in the Grid a measured cell sets its weight and measure side by side and its readout on the line the Recipe's grab strip takes, so it is as tall as any other cell", () => {
  const { view } = boot({ alwaysDraft: true });
  view.update(resolvedFrom(snap => smartLine(snap)), { kind: "structural" });
  const a1 = rowOf(view, "A:0");
  assert.ok(a1.hasAttribute("data-measured"));
  assert.ok(a1.querySelector(".slate-weights__weight .slate-weights__field[data-kind='weight']"));
  assert.ok(a1.querySelector(".slate-weights__geometry .slate-weights__field[data-kind='geometry']"));
  const plain = boot({ alwaysDraft: true });
  plain.view.update(resolvedFrom(), { kind: "structural" });
  assert.equal(rowOf(plain.view, "A:0").hasAttribute("data-measured"), false);
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/weights.css"), "utf8");
  const rule = selector => { const at = css.indexOf(`${selector} {`); assert.ok(at > -1, `no rule for ${selector}`); return css.slice(at, css.indexOf("}", at)); };
  assert.match(rule('.slate-root[data-weights-layers="grid"] .slate-weights__row[data-key]'), /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
  assert.match(rule('.slate-root[data-weights-layers="grid"] .slate-weights__weight'), /grid-column: 1;/);
  assert.match(rule('.slate-root[data-weights-layers="grid"] .slate-weights__geometry'), /grid-column: 2;/);
  // The readout takes the grab strip's room: one line at its height, the measured cell's own bottom room reduced by it.
  assert.match(rule('.slate-root[data-weights-layers="grid"] .slate-weights__computed'), /line-height: var\(--slate-grid-grip\);[^}]*white-space: nowrap;/);
  assert.match(rule('.slate-root[data-weights-layers="grid"] .slate-weights__row[data-measured]'), /padding-bottom: calc\(var\(--slate-space-2\) - var\(--slate-space-1\)\);/);
});
