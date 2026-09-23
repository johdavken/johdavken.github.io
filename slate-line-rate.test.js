"use strict";

/* slate-line-rate.js: the line rate calculator - four prompts, the blend
 * average beside the density, the estimate, and Use through the Line
 * rate card's own path. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, makeEvent, click, key, makeCommands } = require("./tools/slate-test/fake-dom.js");
const lineRate = require("./slate/slate-line-rate.js");
const estimate = require("./line-rate-estimate.js");
const cards = require("./slate/slate-stat-cards.js");

function storage(initial) {
  const store = Object.assign({}, initial || {});
  return { getItem: key => (key in store ? store[key] : null), setItem(key, value) { store[key] = String(value); }, store };
}

const CATALOG = [{ resin_code: "HX204", density_g_cm3: 0.92 }, { resin_code: "LD105", density_g_cm3: 0.95 }, { resin_code: "LL318", density_g_cm3: 0.96 }, { resin_code: "NODENSITY", density_g_cm3: null }];
const RESOLVED = {
  job: { lineRate: 850 },
  hopperState: { "A:0": { resinName: "hx204", pct: 70 }, "A:1": { resinName: "LD105", pct: 30 }, "B:0": { resinName: "LL318", pct: 100 }, "B:1": { resinName: "", pct: 0 }, "C:0": { resinName: "NODENSITY", pct: 100 } },
  layerState: { A: { layerPct: 50 }, B: { layerPct: 50 }, C: { layerPct: 0 } }
};

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const applied = [];
  const said = [];
  const anchor = doc.createElement("button");
  doc.body.appendChild(anchor);
  const saved = settings.storage || storage();
  const view = lineRate.create(doc, {
    estimate: settings.estimate === null ? null : estimate,
    storage: saved,
    apply: value => { applied.push(value); return settings.apply ? settings.apply(value) : { ok: true, changed: true }; },
    blendDensity: () => (settings.blend === undefined ? 0.9234 : settings.blend),
    able: () => settings.able || { ok: true, reason: "" },
    say: message => said.push(message),
    anchor,
    view: doc
  });
  doc.body.appendChild(view.element);
  return { doc, view, applied, said, saved };
}

const q = (view, selector) => view.element.querySelector(selector);
const field = (view, name) => q(view, `[data-wizard-field='${name}']`);
const next = view => click(q(view, "[data-wizard='next']"));

test("blendItems reads each hopper's blend, its layer's share and its resin's catalog density, by code whatever the case; an unassigned hopper is left out", () => {
  const items = lineRate.blendItems(RESOLVED, CATALOG);
  assert.deepEqual(items, [
    { share: 50, pct: 70, density: 0.92 }, { share: 50, pct: 30, density: 0.95 }, { share: 50, pct: 100, density: 0.96 }, { share: 0, pct: 100, density: null }
  ]);
  assert.deepEqual(lineRate.blendItems(null, CATALOG), []);
  assert.deepEqual(lineRate.blendItems(RESOLVED, null).map(item => item.density), [null, null, null, null]);
});

test("four prompts in order with their units; the density prompt offers the blend average and starts on it when nothing was entered before; the estimate is the module's and Use hands the rounded rate on", () => {
  const { view, applied, said, saved } = boot();
  view.open();
  assert.equal(q(view, ".slate-wizard__title").textContent, lineRate.TITLE);
  assert.equal(q(view, ".slate-wizard__progress").textContent, "1 of 4");
  assert.equal(q(view, ".slate-wizard__question").textContent, "What’s the layflat width?");
  assert.equal(q(view, ".slate-wizard__unit").textContent, "in");
  next(view);
  assert.equal(q(view, ".slate-wizard__error").textContent, "Enter a value greater than zero.");
  field(view, "layflat").value = "40"; next(view);
  assert.equal(q(view, ".slate-wizard__question").textContent, "What’s the gauge?");
  assert.equal(q(view, ".slate-wizard__unit").textContent, "mil");
  field(view, "mil").value = "2"; key(field(view, "mil"), "Enter");
  assert.equal(q(view, ".slate-wizard__unit").textContent, "ft/min");
  field(view, "lineSpeed").value = "150"; next(view);
  assert.equal(q(view, ".slate-wizard__question").textContent, "What’s the product density on the traveler?");
  assert.equal(q(view, ".slate-wizard__unit").textContent, "g/cc");
  assert.equal(q(view, ".slate-wizard__hint").textContent, "Blend average from the recipe: 0.923 g/cc");
  assert.equal(field(view, "density").value, "0.923", "the empty density did not start on the blend average");
  field(view, "density").value = "0.92"; next(view);
  assert.equal(q(view, ".slate-wizard__progress").textContent, "Estimate");
  assert.equal(q(view, ".slate-wizard__question").textContent, "Estimated line rate");
  assert.equal(q(view, ".slate-wizard__result").textContent, "574 lb/hr");
  assert.equal(q(view, ".slate-wizard__lead").textContent, "80 in of film at 2 mil");
  assert.equal(q(view, ".slate-wizard__summary").textContent, "40 in layflat • 2 mil • 150 ft/min • 0.920 g/cc");
  assert.equal(q(view, "[data-wizard='use']").textContent, "Use 574 lb/hr");
  assert.deepEqual(JSON.parse(saved.store[estimate.STORAGE_KEY]), { layflat: "40", mil: "2", lineSpeed: "150", density: "0.92" });
  click(q(view, "[data-wizard='use']"));
  assert.deepEqual(applied, [574]);
  assert.ok(!view.isOpen());
  assert.deepEqual(said, ["Line rate set to 574 lb/hr."]);
  // Next time the traveler's figure stands, not the average; and without an average the hint says so.
  view.open();
  for (let i = 0; i < 3; i += 1) next(view);
  assert.equal(field(view, "density").value, "0.92");
  const none = boot({ blend: null });
  none.view.open();
  for (let i = 0; i < 3; i += 1) { field(none.view, ["layflat", "mil", "lineSpeed"][i]).value = "1"; next(none.view); }
  assert.equal(q(none.view, ".slate-wizard__hint").textContent, lineRate.NO_BLEND);
  assert.equal(field(none.view, "density").value, "");
});

test("a refusal keeps the estimate open with the application's words; an unable Use is withheld; without the module it says so", () => {
  const refused = boot({ apply: () => ({ ok: false, code: "bad_argument", message: "The line rate cannot be negative." }), storage: storage({ [estimate.STORAGE_KEY]: JSON.stringify({ layflat: "40", mil: "2", lineSpeed: "150", density: "0.92" }) }) });
  refused.view.open();
  for (let i = 0; i < 4; i += 1) next(refused.view);
  click(q(refused.view, "[data-wizard='use']"));
  assert.ok(refused.view.isOpen());
  assert.equal(q(refused.view, ".slate-wizard__error").textContent, "The line rate cannot be negative.");
  const held = boot({ able: { ok: false, reason: "Slate is read-only on this line." }, storage: storage({ [estimate.STORAGE_KEY]: JSON.stringify({ layflat: "40", mil: "2", lineSpeed: "150", density: "0.92" }) }) });
  held.view.open();
  for (let i = 0; i < 4; i += 1) next(held.view);
  assert.equal(q(held.view, "[data-wizard='use']").getAttribute("data-able"), "false");
  click(q(held.view, "[data-wizard='use']"));
  assert.deepEqual(held.applied, []);
  const bare = boot({ estimate: null });
  bare.view.open();
  assert.equal(q(bare.view, ".slate-wizard__unavailable").textContent, lineRate.UNAVAILABLE);
});

/* ----------------------------------------------------------------------
 *   On the Line rate card
 * -------------------------------------------------------------------- */

const ALL = ["setChangeover", "setLineRate", "setProductionPounds", "setScrapPounds"];

test("on a phone the sheets offer the calculators the tiles have no room for: the Line rate editor's Calculate and the picker's send nothing, close what was open and open the card's calculator", () => {
  const doc = makeDocument();
  const commands = makeCommands({ capabilities: ALL });
  const view = cards.create(doc, {
    commands: () => commands, now: () => Date.now(),
    estimate: require("./changeover-estimate.js"), estimateStorage: storage(), lineRate: estimate, lineRateStorage: storage(), resins: () => CATALOG
  });
  doc.body.appendChild(view.element);
  view.update(RESOLVED);
  // The typed editor says what it edits, and its Calculate comes first.
  const rate = view.card("rate");
  assert.equal(rate.editor.querySelector(".slate-card__editor-title").textContent, "Line rate");
  const calc = rate.editor.querySelector("[data-slate-card-action='calc']");
  assert.equal(calc.textContent, "Calculate");
  assert.ok(calc.parentNode.firstChild === calc);
  // The draft left behind is not committed by the blur the press causes.
  view.open("rate");
  rate.input.value = "999";
  const press = makeEvent("pointerdown", { pointerType: "touch" });
  calc.dispatchEvent(press);
  assert.equal(press._defaultPrevented, true, "the press would take the field's focus and commit its draft");
  rate.input.dispatchEvent(makeEvent("blur"));
  click(calc);
  assert.equal(view.editing(), null);
  assert.ok(view.calculator("rate").isOpen());
  assert.deepEqual(commands.calls, []);
  // Only the calculators' own cards carry one.
  assert.equal(view.card("production").editor.querySelector("[data-slate-card-action='calc']"), null);
  // The picker's Calculate closes it unsent and opens the changeover's calculator.
  click(view.card("changeover").trigger);
  const picker = view.picker();
  assert.ok(picker.isOpen());
  assert.ok(!view.calculator("rate").isOpen(), "two things stood open together");
  click(picker.element.querySelector("[data-time-calc]"));
  assert.ok(!picker.isOpen());
  assert.ok(view.calculator("changeover").isOpen());
  assert.deepEqual(commands.calls, [], "Calculate on the picker set the changeover");
});

test("the Line rate card carries its own calculator; the blend average comes from the live recipe and the catalog; Use sends one setLineRate; the two calculators, the picker and the editors never stand open together", () => {
  const doc = makeDocument();
  const commands = makeCommands({ capabilities: ALL });
  const committed = [];
  const view = cards.create(doc, {
    commands: () => commands, onCommitted: result => committed.push(result), now: () => Date.now(),
    estimate: require("./changeover-estimate.js"), estimateStorage: storage(), lineRate: estimate, lineRateStorage: storage(), resins: () => CATALOG
  });
  doc.body.appendChild(view.element);
  view.update(RESOLVED);
  const button = view.card("rate").calc;
  assert.ok(button, "no calculator on the Line rate card");
  assert.equal(button.getAttribute("aria-label"), lineRate.OPEN_LABEL);
  assert.ok(view.card("rate").card.classList.contains("has-calc"));
  assert.ok(view.card("changeover").card.classList.contains("has-calc"));
  assert.equal(view.card("production").calc, null);
  const calculator = view.calculator("rate");
  const other = view.calculator("changeover");
  click(button);
  assert.ok(calculator.isOpen());
  click(view.card("changeover").calc);
  assert.ok(!calculator.isOpen());
  assert.ok(other.isOpen());
  click(button);
  assert.ok(!other.isOpen());
  assert.ok(calculator.isOpen());
  click(view.card("changeover").trigger);
  assert.ok(!calculator.isOpen());
  assert.ok(view.picker().isOpen());
  click(button);
  assert.ok(!view.picker().isOpen());
  view.open("scrap");
  assert.ok(!calculator.isOpen());
  click(button);
  assert.equal(view.editing(), null);
  const popover = calculator.element;
  for (const [name, value] of [["layflat", "40"], ["mil", "2"], ["lineSpeed", "150"]]) { popover.querySelector(`[data-wizard-field='${name}']`).value = value; click(popover.querySelector("[data-wizard='next']")); }
  // The recipe above: (0.5x0.7x0.92 + 0.5x0.3x0.95 + 0.5x0.96) / 1 = 0.9445.
  assert.equal(popover.querySelector(".slate-wizard__hint").textContent, "Blend average from the recipe: 0.945 g/cc");
  assert.equal(popover.querySelector("[data-wizard-field='density']").value, "0.945");
  click(popover.querySelector("[data-wizard='next']"));
  click(popover.querySelector("[data-wizard='use']"));
  const expected = estimate.estimate({ layflat: 40, mil: 2, lineSpeed: 150, density: "0.945" }).lbPerHourRounded;
  assert.deepEqual(commands.calls, [{ command: "setLineRate", args: { lineRate: expected } }]);
  assert.equal(committed.length, 1);
  assert.ok(!calculator.isOpen());
});
