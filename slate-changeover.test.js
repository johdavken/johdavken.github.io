"use strict";

/* slate-changeover.js: the floor UI's changeover wizard as a popover -
 * the six prompts in order, the wizard's checks and words, the estimate,
 * Use through the card's own path, and the records it leaves behind. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click, key, pointer, makeCommands } = require("./tools/slate-test/fake-dom.js");
const changeover = require("./slate/slate-changeover.js");
const estimate = require("./changeover-estimate.js");
const cards = require("./slate/slate-stat-cards.js");

// A fixed instant: 2026-09-21 10:00 local.
const NOW = new Date(2026, 8, 21, 10, 0, 0).getTime();
const HOUR = 3600 * 1000;
const clock = at => { const d = new Date(at); const h = d.getHours() % 12 || 12; return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`; };

function storage(initial) {
  const store = Object.assign({}, initial || {});
  return { getItem: key => (key in store ? store[key] : null), setItem(key, value) { store[key] = String(value); }, removeItem(key) { delete store[key]; }, store };
}

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const applied = [];
  const said = [];
  const changes = [];
  const anchor = doc.createElement("button");
  doc.body.appendChild(anchor);
  const saved = settings.storage || storage();
  const view = changeover.create(doc, {
    estimate: settings.estimate === null ? null : estimate,
    storage: saved,
    now: () => NOW,
    clock,
    apply: at => { applied.push(at); return settings.apply ? settings.apply(at) : { ok: true, changed: true, revision: 1 }; },
    able: () => settings.able || { ok: true, reason: "" },
    say: message => said.push(message),
    onChange: on => changes.push(on),
    anchor,
    view: doc
  });
  doc.body.appendChild(view.element);
  return { doc, view, applied, said, changes, saved, anchor };
}

const q = (view, selector) => view.element.querySelector(selector);
const qa = (view, selector) => view.element.querySelectorAll(selector);
const field = (view, name) => q(view, `[data-wizard-field='${name}']`);
const next = view => click(q(view, "[data-wizard='next']"));

/* The wizard's own arithmetic over one set of answers: 120 ft/min, 6000
 * ft rolls, 2 up on both winders, 1h30 left on the set, 12 rolls left. */
const ANSWERS = { lineSpeed: "120", footagePerRoll: "6000", numberUp: 2, bothWinders: true, hours: 1, minutes: 30, rollsLeft: "12" };

test("the popover walks the six prompts in the wizard's order with its words, and a bad answer stays on the step with the wizard's message", () => {
  const { view, changes } = boot();
  assert.ok(view.element.hasAttribute("hidden"));
  view.open();
  assert.deepEqual(changes, [true]);
  assert.ok(!view.element.hasAttribute("hidden"));
  assert.equal(view.element.getAttribute("role"), "dialog");
  assert.equal(q(view, ".slate-wizard__progress").textContent, "1 of 6");
  assert.equal(q(view, ".slate-wizard__question").textContent, "What’s the line speed?");
  assert.equal(q(view, ".slate-wizard__unit").textContent, "ft/min");
  assert.equal(q(view, "[data-wizard='back']"), null, "the first step offers Back");
  next(view);
  assert.equal(view.step(), 0);
  assert.equal(q(view, ".slate-wizard__error").textContent, "Enter a value greater than zero.");
  field(view, "lineSpeed").value = "120";
  key(field(view, "lineSpeed"), "Enter");
  assert.equal(view.step(), 1);
  assert.equal(q(view, ".slate-wizard__progress").textContent, "2 of 6");
  assert.equal(q(view, ".slate-wizard__question").textContent, "What’s the footage per roll?");
  assert.ok(q(view, "[data-wizard='back']"));
  field(view, "footagePerRoll").value = "6000";
  next(view);
  assert.equal(q(view, ".slate-wizard__question").textContent, "How many up?");
  assert.equal(qa(view, "[data-wizard-choice]").length, 10);
  assert.equal(q(view, "[role='radiogroup']").getAttribute("aria-label"), "Rolls per winder");
  // A tile picks and advances at once.
  click(q(view, "[data-wizard-choice='2']"));
  assert.equal(view.step(), 3);
  assert.equal(q(view, ".slate-wizard__question").textContent, "Using both winders?");
  assert.deepEqual(qa(view, "[data-wizard-choice]").map(one => one.textContent), ["Yes", "No"]);
  assert.equal(q(view, "[data-wizard-choice='true']").getAttribute("aria-checked"), "true", "the saved default (both) is marked");
  // Next alone confirms the marked choice.
  next(view);
  assert.equal(view.step(), 4);
  assert.equal(q(view, ".slate-wizard__question").textContent, "How long is left on the current set?");
  field(view, "hours").value = "30";
  next(view);
  assert.equal(view.step(), 4);
  assert.equal(q(view, ".slate-wizard__error").textContent, "Hours must be 0 to 24.");
  field(view, "hours").value = "1";
  field(view, "minutes").value = "30";
  next(view);
  assert.equal(q(view, ".slate-wizard__question").textContent, "How many rolls are left on the order?");
  field(view, "rollsLeft").value = "-1";
  next(view);
  assert.equal(q(view, ".slate-wizard__error").textContent, "Enter zero or more rolls.");
  field(view, "rollsLeft").value = "12";
  next(view);
  assert.equal(view.step(), changeover.ESTIMATE_STEP);
  assert.deepEqual(view.answers(), ANSWERS);
  // Back walks the other way; the answer given stands in the field.
  click(q(view, "[data-wizard='adjust']"));
  assert.equal(view.step(), 0);
  assert.equal(field(view, "lineSpeed").value, "120");
  next(view);
  click(q(view, "[data-wizard='back']"));
  assert.equal(view.step(), 0);
});

test("the estimate is the wizard's arithmetic and words; Use hands the instant to apply, records the answers and the running estimate under the application's keys, closes and says so", () => {
  const { view, applied, said, saved, changes } = boot();
  view.open();
  for (const [name, value] of [["lineSpeed", "120"], ["footagePerRoll", "6000"]]) { field(view, name).value = value; next(view); }
  click(q(view, "[data-wizard-choice='2']"));
  click(q(view, "[data-wizard-choice='true']"));
  field(view, "hours").value = "1"; field(view, "minutes").value = "30"; next(view);
  field(view, "rollsLeft").value = "12"; next(view);
  const expected = estimate.estimate(ANSWERS, NOW);
  // 1h30 on the set + 2 future sets of 50 min = 3h10.
  assert.equal(expected.remainingMinutes, 190);
  assert.equal(q(view, ".slate-wizard__progress").textContent, "Estimate");
  assert.equal(q(view, ".slate-wizard__result").textContent, clock(NOW + 190 * 60000));
  assert.equal(q(view, ".slate-wizard__lead").textContent, "3 hr 10 min remaining");
  assert.equal(q(view, ".slate-wizard__summary").textContent, "12 rolls • 4 rolls/set • 2 future sets");
  const use = q(view, "[data-wizard='use']");
  assert.equal(use.textContent, `Use ${clock(expected.estimatedAt)}`);
  assert.equal(use.getAttribute("data-able"), "true");
  // Every step saved the answers as the wizard does; nothing has started an estimate yet.
  assert.deepEqual(JSON.parse(saved.store[estimate.STORAGE_KEYS.answers]), ANSWERS);
  assert.equal(saved.store[estimate.STORAGE_KEYS.estimate], undefined);
  click(use);
  assert.deepEqual(applied, [expected.estimatedAt]);
  assert.ok(view.element.hasAttribute("hidden"));
  assert.deepEqual(changes, [true, false]);
  assert.deepEqual(said, [`Changeover set to ${clock(expected.estimatedAt)}.`]);
  const running = estimate.readProductionEstimate(saved);
  assert.equal(running.startedAt, NOW);
  assert.equal(running.rollsPerSet, 4);
  assert.equal(running.totalMinutesRemaining, 190);
});

test("a refused Use keeps the estimate open with the application's words and records nothing; an unable Use is withheld with the reason", () => {
  const refused = boot({ apply: () => ({ ok: false, code: "bad_argument", message: "That is more than a day away." }) });
  refused.view.open();
  for (const [name, value] of [["lineSpeed", "120"], ["footagePerRoll", "6000"]]) { field(refused.view, name).value = value; next(refused.view); }
  click(q(refused.view, "[data-wizard-choice='2']"));
  click(q(refused.view, "[data-wizard-choice='true']"));
  next(refused.view);
  field(refused.view, "rollsLeft").value = "12"; next(refused.view);
  click(q(refused.view, "[data-wizard='use']"));
  assert.equal(refused.applied.length, 1);
  assert.ok(!refused.view.element.hasAttribute("hidden"));
  assert.equal(q(refused.view, ".slate-wizard__error").textContent, "That is more than a day away.");
  assert.equal(refused.saved.store[estimate.STORAGE_KEYS.estimate], undefined);
  assert.deepEqual(refused.said, []);

  const held = boot({ able: { ok: false, reason: "Slate is read-only on this line." }, storage: storage({ [estimate.STORAGE_KEYS.answers]: JSON.stringify(ANSWERS) }) });
  held.view.open();
  // The saved answers come back, so Next alone walks to the estimate.
  assert.equal(field(held.view, "lineSpeed").value, "120");
  for (let i = 0; i < 6; i += 1) next(held.view);
  assert.equal(held.view.step(), changeover.ESTIMATE_STEP);
  const use = q(held.view, "[data-wizard='use']");
  assert.equal(use.getAttribute("data-able"), "false");
  assert.match(use.getAttribute("title"), /read-only/);
  click(use);
  assert.equal(held.applied.length, 0);
  assert.match(q(held.view, ".slate-wizard__error").textContent, /read-only/);
});

test("Escape, the close and a press outside close it and give focus back to its button; a press inside or on the button does not; without the estimate module it says so", () => {
  const { view, doc, anchor, changes } = boot();
  view.open();
  key(view.element, "Escape");
  assert.ok(view.element.hasAttribute("hidden"));
  assert.ok(doc.activeElement === anchor);
  view.open();
  click(q(view, ".slate-wizard__close"));
  assert.ok(view.element.hasAttribute("hidden"));
  view.open();
  pointer("pointerdown", field(view, "lineSpeed"));
  assert.ok(!view.element.hasAttribute("hidden"), "a press inside closed it");
  pointer("pointerdown", anchor);
  assert.ok(!view.element.hasAttribute("hidden"), "a press on its own button closed it");
  pointer("pointerdown", doc.body);
  assert.ok(view.element.hasAttribute("hidden"));
  assert.deepEqual(changes, [true, false, true, false, true, false]);
  view.toggle();
  assert.ok(view.isOpen());
  view.toggle();
  assert.ok(!view.isOpen());

  const bare = boot({ estimate: null });
  bare.view.open();
  assert.equal(q(bare.view, ".slate-wizard__unavailable").textContent, changeover.UNAVAILABLE);
  assert.equal(q(bare.view, "[data-wizard='next']"), null);
});

/* ----------------------------------------------------------------------
 *   On the Changeover card
 * -------------------------------------------------------------------- */

const ALL = ["setChangeover", "setLineRate", "setProductionPounds", "setScrapPounds"];

test("the Changeover card carries the calculator's button; Use sends one setChangeover for the estimate, the boot hears of it, and the card's editor and the popover never stand open together", () => {
  const doc = makeDocument();
  const commands = makeCommands({ capabilities: ALL });
  const committed = [];
  const said = [];
  const saved = storage();
  const view = cards.create(doc, { commands: () => commands, onCommitted: result => committed.push(result), now: () => NOW, estimate, estimateStorage: saved, say: m => said.push(m) });
  doc.body.appendChild(view.element);
  view.update({ job: { lineRate: 850, changeoverTime: "12:30", changeoverSetAt: NOW - HOUR } });
  const button = view.card("changeover").calc;
  assert.ok(button, "no calculator button");
  assert.equal(button.getAttribute("aria-label"), changeover.OPEN_LABEL);
  assert.ok(button.querySelector(".slate-wizard__glyph"));
  assert.equal(view.card("production").calc, null);
  const calculator = view.calculator("changeover");
  click(button);
  assert.ok(calculator.isOpen());
  assert.equal(button.getAttribute("aria-expanded"), "true");
  // Opening the card's own editor closes the popover, and the other way round.
  view.open("changeover");
  assert.ok(!calculator.isOpen());
  assert.equal(button.getAttribute("aria-expanded"), "false");
  click(button);
  assert.equal(view.editing(), null);
  assert.ok(calculator.isOpen());
  // Another card's editor closes too: one thing open at a time.
  view.open("rate");
  assert.ok(!calculator.isOpen());
  assert.equal(view.editing(), "rate");
  click(button);
  assert.equal(view.editing(), null);
  assert.ok(calculator.isOpen());
  const popover = calculator.element;
  for (const [name, value] of [["lineSpeed", "120"], ["footagePerRoll", "6000"]]) { popover.querySelector(`[data-wizard-field='${name}']`).value = value; click(popover.querySelector("[data-wizard='next']")); }
  click(popover.querySelector("[data-wizard-choice='2']"));
  click(popover.querySelector("[data-wizard-choice='true']"));
  popover.querySelector("[data-wizard-field='hours']").value = "1"; popover.querySelector("[data-wizard-field='minutes']").value = "30"; click(popover.querySelector("[data-wizard='next']"));
  popover.querySelector("[data-wizard-field='rollsLeft']").value = "12"; click(popover.querySelector("[data-wizard='next']"));
  click(popover.querySelector("[data-wizard='use']"));
  const expected = estimate.estimate(ANSWERS, NOW);
  assert.deepEqual(commands.calls, [{ command: "setChangeover", args: { at: expected.estimatedAt } }]);
  assert.equal(committed.length, 1);
  assert.ok(!calculator.isOpen());
  assert.match(said[0], /^Changeover set to /);
  assert.ok(estimate.readProductionEstimate(saved));

  // With no bridge the popover still calculates; only Use is withheld.
  const bare = cards.create(doc, { commands: () => null, now: () => NOW, estimate, estimateStorage: storage() });
  doc.body.appendChild(bare.element);
  bare.update({ job: {} });
  click(bare.card("changeover").calc);
  assert.ok(bare.calculator("changeover").isOpen());
  const none = cards.create(doc, { commands: () => commands, now: () => NOW });
  assert.equal(none.card("changeover").calc, null, "a button with nothing to calculate with");
  assert.equal(none.calculator("changeover"), null);
});
