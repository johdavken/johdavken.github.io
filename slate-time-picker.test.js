"use strict";

/* slate-time-picker.js: the changeover's picker - hour and minute tiles,
 * AM or PM, the exact minute, the preview, and Set / Clear / Cancel
 * through the card's own path. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click, key, pointer, makeCommands } = require("./tools/slate-test/fake-dom.js");
const pickerModule = require("./slate/slate-time-picker.js");
const cards = require("./slate/slate-stat-cards.js");

// A fixed instant: 2026-09-21 10:00 local.
const NOW = new Date(2026, 8, 21, 10, 0, 0).getTime();
const HOUR = 3600 * 1000;
const at = (h, m) => new Date(2026, 8, 21, h, m, 0).getTime();

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const applied = [];
  const changes = [];
  const anchor = doc.createElement("button");
  doc.body.appendChild(anchor);
  const view = pickerModule.create(doc, {
    now: () => NOW,
    apply: value => { applied.push(value); return settings.apply ? settings.apply(value) : { ok: true, changed: true }; },
    preview: value => { const m = /^(\d\d):(\d\d)$/.exec(value); if (!m) return null; let t = at(Number(m[1]), Number(m[2])); if (t < NOW) t += 24 * HOUR; return t; },
    clock: t => { const d = new Date(t); const h = d.getHours() % 12 || 12; return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`; },
    remaining: ms => `${Math.floor(ms / HOUR)}h ${String(Math.round((ms % HOUR) / 60000)).padStart(2, "0")}m`,
    able: () => settings.able || { ok: true, reason: "" },
    onChange: on => changes.push(on),
    anchor,
    view: doc
  });
  doc.body.appendChild(view.element);
  return { doc, view, applied, changes, anchor };
}

const q = (view, selector) => view.element.querySelector(selector);
const qa = (view, selector) => view.element.querySelectorAll(selector);
const checked = (view, attr) => qa(view, `[${attr}]`).filter(one => one.getAttribute("aria-checked") === "true").map(one => one.getAttribute(attr));

test("the clock arithmetic: twelve-hour choices to and from HH:MM, and the next five minutes", () => {
  assert.equal(pickerModule.toClock(12, 0, "AM"), "00:00");
  assert.equal(pickerModule.toClock(12, 30, "PM"), "12:30");
  assert.equal(pickerModule.toClock(5, 7, "PM"), "17:07");
  assert.equal(pickerModule.toClock(11, 59, "AM"), "11:59");
  assert.deepEqual(pickerModule.fromClock("00:05"), { hour12: 12, minute: 5, period: "AM" });
  assert.deepEqual(pickerModule.fromClock("12:30"), { hour12: 12, minute: 30, period: "PM" });
  assert.deepEqual(pickerModule.fromClock("17:07"), { hour12: 5, minute: 7, period: "PM" });
  assert.equal(pickerModule.fromClock(""), null);
  assert.equal(pickerModule.fromClock("25:00"), null);
  assert.deepEqual(pickerModule.nextStep(at(10, 0)), { hour12: 10, minute: 5, period: "AM" });
  assert.deepEqual(pickerModule.nextStep(at(10, 2)), { hour12: 10, minute: 5, period: "AM" });
  assert.deepEqual(pickerModule.nextStep(at(23, 58)), { hour12: 12, minute: 0, period: "AM" });
});

test("it opens marked with the time it is given - or the next five minutes - and says what the choice means; tiles and the exact minute move the choice", () => {
  const { view, changes } = boot();
  view.open("12:30");
  assert.deepEqual(changes, [true]);
  assert.equal(view.element.getAttribute("role"), "dialog");
  assert.equal(qa(view, "[data-time-hour]").length, 12);
  assert.deepEqual(qa(view, "[data-time-minute]").map(one => one.getAttribute("data-time-minute")), ["0", "5", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]);
  assert.deepEqual(checked(view, "data-time-hour"), ["12"]);
  assert.deepEqual(checked(view, "data-time-minute"), ["30"]);
  assert.deepEqual(checked(view, "data-time-period"), ["PM"]);
  assert.equal(q(view, "[data-time-field='minute']").value, "30");
  assert.equal(q(view, ".slate-time__preview").textContent, "12:30 PM · in 2h 30m");
  assert.ok(!q(view, "[data-time='clear']").hasAttribute("hidden"), "Clear is withheld with a changeover set");
  assert.ok(q(view, "[data-time-hour='12']").focused);

  click(q(view, "[data-time-hour='2']"));
  assert.deepEqual(checked(view, "data-time-hour"), ["2"]);
  assert.equal(view.value(), "14:30");
  assert.equal(q(view, ".slate-time__preview").textContent, "2:30 PM · in 4h 30m");
  click(q(view, "[data-time-minute='5']"));
  assert.equal(view.value(), "14:05");
  assert.equal(q(view, "[data-time-field='minute']").value, "05");
  click(q(view, "[data-time-period='AM']"));
  assert.equal(view.value(), "02:05");
  // A passed clock time reads as tomorrow, the way the card reads it.
  assert.equal(q(view, ".slate-time__preview").textContent, "2:05 AM · in 16h 05m");
  // The exact minute: a tile in fives is only a shortcut.
  const field = q(view, "[data-time-field='minute']");
  field.value = "7";
  field.dispatchEvent({ type: "input" });
  assert.equal(view.value(), "02:07");
  assert.deepEqual(checked(view, "data-time-minute"), []);
  field.value = "61";
  field.dispatchEvent({ type: "input" });
  assert.equal(view.value(), "02:07", "an impossible minute moved the choice");

  const fresh = boot();
  fresh.view.open("");
  assert.deepEqual(fresh.view.choice(), { hour12: 10, minute: 5, period: "AM" });
  assert.ok(q(fresh.view, "[data-time='clear']").hasAttribute("hidden"), "Clear offered with nothing to clear");
});

test("Set hands the clock time to apply and closes on an accepted answer; a refusal keeps it open with the application's words; Clear hands an empty value; an unable Set is withheld with the reason", () => {
  const { view, applied, changes } = boot();
  view.open("12:30");
  click(q(view, "[data-time-hour='3']"));
  click(q(view, "[data-time='set']"));
  assert.deepEqual(applied, ["15:30"]);
  assert.ok(!view.isOpen());
  assert.deepEqual(changes, [true, false]);
  view.open("12:30");
  const field = q(view, "[data-time-field='minute']");
  field.value = "75";
  key(field, "Enter");
  assert.equal(applied.length, 1);
  assert.equal(q(view, ".slate-time__error").textContent, pickerModule.BAD_MINUTE);
  field.value = "45";
  key(field, "Enter");
  assert.deepEqual(applied[1], "12:45");
  view.open("12:30");
  click(q(view, "[data-time='clear']"));
  assert.deepEqual(applied[2], "");
  assert.ok(!view.isOpen());

  const refused = boot({ apply: () => ({ ok: false, code: "bad_argument", message: "That is more than a day away." }) });
  refused.view.open("12:30");
  refused.view.set();
  assert.ok(refused.view.isOpen());
  assert.equal(q(refused.view, ".slate-time__error").textContent, "That is more than a day away.");

  const held = boot({ able: { ok: false, reason: "Slate is read-only on this line." } });
  held.view.open("12:30");
  assert.equal(q(held.view, "[data-time='set']").getAttribute("data-able"), "false");
  assert.match(q(held.view, "[data-time='set']").getAttribute("title"), /read-only/);
  click(q(held.view, "[data-time='set']"));
  assert.deepEqual(held.applied, []);
  assert.match(q(held.view, ".slate-time__error").textContent, /read-only/);
});

test("Cancel, Escape, the close and a press outside close it with nothing sent and give focus back; a press inside or on the anchor does not", () => {
  const { view, doc, anchor, applied } = boot();
  view.open("12:30");
  click(q(view, "[data-time='cancel']"));
  assert.ok(!view.isOpen());
  assert.ok(doc.activeElement === anchor);
  view.open("12:30");
  const escape = key(view.element, "Escape");
  assert.equal(escape._stopped, true);
  assert.ok(!view.isOpen());
  view.open("12:30");
  click(q(view, ".slate-time__close"));
  assert.ok(!view.isOpen());
  view.open("12:30");
  pointer("pointerdown", q(view, "[data-time-hour='4']"));
  pointer("pointerdown", anchor);
  assert.ok(view.isOpen());
  pointer("pointerdown", doc.body);
  assert.ok(!view.isOpen());
  assert.deepEqual(applied, []);
});

/* ----------------------------------------------------------------------
 *   On the Changeover card
 * -------------------------------------------------------------------- */

const ALL = ["setChangeover", "setLineRate", "setProductionPounds", "setScrapPounds"];

test("on the card the picker, the calculator and the other cards' editors never stand open together; read-only withholds Set; a refusal shows the application's words", () => {
  const doc = makeDocument();
  const commands = makeCommands({ capabilities: ALL, answer: () => ({ ok: false, code: "bad_argument", message: "The changeover cannot be more than a day away." }) });
  let readOnly = false;
  const view = cards.create(doc, { commands: () => commands, now: () => NOW, readOnly: () => readOnly, estimate: require("./changeover-estimate.js"), estimateStorage: null });
  doc.body.appendChild(view.element);
  view.update({ job: { lineRate: 850, changeoverTime: "12:30", changeoverSetAt: NOW - HOUR } });
  const picker = view.picker();
  const calculator = view.calculator("changeover");
  click(view.card("changeover").trigger);
  assert.ok(picker.isOpen());
  click(view.card("changeover").calc);
  assert.ok(!picker.isOpen());
  assert.ok(calculator.isOpen());
  click(view.card("changeover").trigger);
  assert.ok(!calculator.isOpen());
  assert.ok(picker.isOpen());
  view.open("rate");
  assert.ok(!picker.isOpen());
  assert.equal(view.editing(), "rate");
  click(view.card("changeover").trigger);
  assert.equal(view.editing(), null);
  assert.ok(picker.isOpen());
  // The preview and Set read the clock time as the card does.
  click(picker.element.querySelector("[data-time-hour='9']"));
  click(picker.element.querySelector("[data-time-period='AM']"));
  assert.match(picker.element.querySelector(".slate-time__preview").textContent, /^9:30 AM · in 23h 30m$/);
  // Another device's change while the picker is open keeps the choice and says so; our own does not.
  click(picker.element.querySelector("[data-time-hour='7']"));
  view.update({ job: { lineRate: 850, changeoverTime: "13:00", changeoverSetAt: NOW } }, { own: false });
  assert.equal(picker.value(), "07:30");
  assert.equal(view.card("changeover").note.textContent, cards.CHANGED_ELSEWHERE);
  picker.close();
  assert.equal(view.card("changeover").note.textContent, "", "the note outlived the picker");
  click(view.card("changeover").trigger);
  view.update({ job: { lineRate: 850, changeoverTime: "13:30", changeoverSetAt: NOW } }, { own: true });
  assert.equal(view.card("changeover").note.textContent, "");
  picker.close();
  readOnly = true;
  view.refresh();
  click(view.card("changeover").trigger);
  assert.ok(!picker.isOpen(), "the picker opened under read-only");
  assert.match(view.card("changeover").note.textContent, /read-only/);
  readOnly = false;
  view.refresh();
  click(view.card("changeover").trigger);
  const result = picker.set();
  assert.equal(result.ok, false);
  assert.ok(picker.isOpen());
  assert.equal(picker.element.querySelector(".slate-time__error").textContent, "The changeover cannot be more than a day away.");
});
