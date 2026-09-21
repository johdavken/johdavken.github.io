"use strict";

/* slate-stat-cards.js: the job's cards, their editors, and the four job
 * commands they ride on. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click, key, makeCommands } = require("./tools/slate-test/fake-dom.js");
const cards = require("./slate/slate-stat-cards.js");
const scheduling = require("./scheduling.js");

const ALL = ["setChangeover", "setLineRate", "setProductionPounds", "setScrapPounds"];
// A fixed instant: 2026-09-21 10:00 local.
const NOW = new Date(2026, 8, 21, 10, 0, 0).getTime();
const HOUR = 3600 * 1000;

function jobAt(overrides) {
  return Object.assign({ lineRate: 850, changeoverTime: "12:30", changeoverSetAt: NOW - HOUR, prodResinLb: 12400, scrapResinLb: 310 }, overrides || {});
}

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const commands = settings.commands === null ? null : (settings.commands || makeCommands({ capabilities: ALL }));
  const committed = [];
  const view = cards.create(doc, { commands: () => commands, onCommitted: result => committed.push(result), now: () => (settings.now || NOW) });
  doc.body.appendChild(view.element);
  return { doc, commands, committed, view };
}

test("display: each card's value and sub line, at a fixed clock", () => {
  const job = jobAt();
  assert.deepEqual(cards.display("rate", job, NOW), { value: "850 lb/hr", sub: "", stale: false, at: null });
  assert.equal(cards.display("rate", { lineRate: 0 }, NOW).value, cards.NOT_SET);
  assert.equal(cards.display("production", job, NOW).value, "12,400 lb");
  assert.equal(cards.display("scrap", { scrapResinLb: "" }, NOW).value, cards.EMPTY);
  assert.equal(cards.display("scrap", { scrapResinLb: "1,250" }, NOW).value, cards.EMPTY, "a string with a separator is not a number here");
  const changeover = cards.display("changeover", job, NOW);
  assert.equal(changeover.value, scheduling.parseChangeoverDate("12:30", new Date(NOW)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  assert.equal(changeover.sub, "in 2h 30m");
  assert.equal(changeover.at, NOW + 2.5 * HOUR);
  assert.equal(cards.display("changeover", { changeoverTime: "" }, NOW).value, cards.NOT_SET);
  // A deadline set long enough ago is flagged for confirming, by scheduling's own rule.
  const stale = cards.display("changeover", jobAt({ changeoverSetAt: NOW - 3 * 24 * HOUR }), NOW);
  assert.equal(stale.stale, scheduling.isChangeoverStale(NOW - 3 * 24 * HOUR, new Date(NOW)));
});

test("requestFor: empty clears, numbers go as typed, the changeover goes as an instant", () => {
  assert.deepEqual(cards.requestFor("rate", "", NOW), { command: "setLineRate", args: { lineRate: 0 } });
  assert.deepEqual(cards.requestFor("rate", " 1,200 ", NOW), { command: "setLineRate", args: { lineRate: "1,200" } });
  assert.deepEqual(cards.requestFor("production", "500", NOW), { command: "setProductionPounds", args: { pounds: "500" } });
  assert.deepEqual(cards.requestFor("scrap", "", NOW), { command: "setScrapPounds", args: { pounds: 0 } });
  assert.deepEqual(cards.requestFor("changeover", "", NOW), { command: "setChangeover", args: { at: null } });
  assert.deepEqual(cards.requestFor("changeover", "12:30", NOW), { command: "setChangeover", args: { at: NOW + 2.5 * HOUR } });
  assert.deepEqual(cards.requestFor("changeover", "nonsense", NOW), { error: cards.BAD_TIME });
  assert.equal(cards.draftFor("changeover", jobAt(), NOW), "12:30");
  assert.equal(cards.draftFor("rate", jobAt(), NOW), "850");
  assert.equal(cards.draftFor("production", { prodResinLb: "" }, NOW), "");
});

test("the four cards render, and an update repaints them", () => {
  const { view } = boot();
  const fields = view.element.querySelectorAll(".slate-card");
  assert.deepEqual(fields.map(card => card.getAttribute("data-field")), cards.FIELDS);
  view.update({ job: jobAt() }, {});
  assert.equal(view.card("rate").value.textContent, "850 lb/hr");
  assert.equal(view.card("changeover").sub.textContent, "in 2h 30m");
  assert.ok(!view.card("rate").card.classList.contains("is-readonly"));
  view.update({ job: jobAt({ lineRate: 0 }) }, {});
  assert.equal(view.card("rate").value.textContent, cards.NOT_SET);
  assert.ok(view.card("rate").card.classList.contains("is-unset"));
});

test("click opens the editor with the current value; Enter commits one command and the boot hears of it", () => {
  const { view, commands, committed } = boot();
  view.update({ job: jobAt() }, {});
  const rate = view.card("rate");
  click(rate.trigger);
  assert.equal(view.editing(), "rate");
  assert.ok(rate.card.classList.contains("is-editing"));
  assert.ok(!rate.editor.hasAttribute("hidden"));
  assert.equal(rate.input.value, "850");
  assert.equal(rate.input.focused, true);
  rate.input.value = "900";
  key(rate.input, "Enter");
  assert.deepEqual(commands.calls, [{ command: "setLineRate", args: { lineRate: "900" } }]);
  assert.equal(committed.length, 1);
  assert.equal(view.editing(), null);
  assert.ok(rate.editor.hasAttribute("hidden"));
  assert.equal(rate.trigger.focused, true, "focus did not return to the trigger");
});

test("blur commits, Escape cancels without dispatching, and opening another card closes the first", () => {
  const { view, commands } = boot();
  view.update({ job: jobAt() }, {});
  const production = view.card("production");
  click(production.trigger);
  production.input.value = "13000";
  production.input.dispatchEvent({ type: "blur" });
  assert.deepEqual(commands.calls, [{ command: "setProductionPounds", args: { pounds: "13000" } }]);

  const scrap = view.card("scrap");
  click(scrap.trigger);
  scrap.input.value = "999";
  const escape = key(scrap.input, "Escape");
  assert.equal(escape._stopped, true, "Escape was not stopped at the card");
  assert.equal(view.editing(), null);
  assert.equal(commands.calls.length, 1);

  click(scrap.trigger);
  click(view.card("rate").trigger);
  assert.equal(view.editing(), "rate");
  assert.ok(scrap.editor.hasAttribute("hidden"));
});

test("the changeover is entered as a clock time and sent as an instant; a bad time never dispatches", () => {
  const { view, commands } = boot();
  view.update({ job: jobAt() }, {});
  const changeover = view.card("changeover");
  assert.equal(changeover.input.getAttribute("type"), "time");
  click(changeover.trigger);
  changeover.input.value = "14:00";
  key(changeover.input, "Enter");
  assert.deepEqual(commands.calls, [{ command: "setChangeover", args: { at: NOW + 4 * HOUR } }]);

  click(changeover.trigger);
  changeover.input.value = "later";
  const result = view.commit();
  assert.equal(result.ok, false);
  assert.equal(commands.calls.length, 1);
  assert.equal(changeover.note.textContent, cards.BAD_TIME);
  assert.equal(changeover.input.getAttribute("aria-invalid"), "true");
  assert.equal(view.editing(), "changeover", "the editor closed on a bad time");

  click(changeover.trigger);
  changeover.input.value = "";
  key(changeover.input, "Enter");
  assert.deepEqual(commands.calls[1], { command: "setChangeover", args: { at: null } });
});

test("a refusal keeps the editor open and shows the application's own words; an unchanged answer closes quietly", () => {
  const answers = [
    { ok: false, code: "out_of_range", field: "at", message: "That changeover time has already passed." },
    { ok: true, changed: false, revision: 3, persisted: false, snapshot: null }
  ];
  const commands = makeCommands({ capabilities: ALL, answer: () => answers.shift() });
  const { view, committed } = boot({ commands });
  view.update({ job: jobAt() }, {});
  const changeover = view.card("changeover");
  click(changeover.trigger);
  changeover.input.value = "09:59";
  key(changeover.input, "Enter");
  assert.equal(view.editing(), "changeover");
  assert.equal(changeover.note.textContent, "That changeover time has already passed.");
  assert.equal(changeover.input.getAttribute("aria-invalid"), "true");
  assert.equal(committed.length, 0);
  key(changeover.input, "Enter");
  assert.equal(view.editing(), null);
  assert.equal(committed.length, 0, "an unchanged answer was reported as a commit");
});

test("with no bridge every card is read-only, says why, and never opens", () => {
  const { view } = boot({ commands: null });
  view.update({ job: jobAt() }, {});
  for (const field of cards.FIELDS) {
    const card = view.card(field);
    assert.ok(card.card.classList.contains("is-readonly"));
    assert.equal(card.trigger.getAttribute("aria-disabled"), "true");
    assert.match(card.trigger.getAttribute("title"), /no application is connected/);
    click(card.trigger);
    assert.equal(view.editing(), null);
    assert.match(card.note.textContent, /cannot be changed here/);
  }
  const partial = boot({ commands: makeCommands({ capabilities: ["setLineRate"] }) });
  partial.view.update({ job: jobAt() }, {});
  assert.ok(!partial.view.card("rate").card.classList.contains("is-readonly"));
  assert.ok(partial.view.card("scrap").card.classList.contains("is-readonly"));
  assert.match(cards.reason(makeCommands({ capabilities: [] }), "scrap"), /does not offer setScrapPounds/);
});

test("another device's change while editing keeps the draft and says so; our own does not", () => {
  const { view } = boot();
  view.update({ job: jobAt() }, {});
  const rate = view.card("rate");
  click(rate.trigger);
  rate.input.value = "12";
  view.update({ job: jobAt({ lineRate: 700 }) }, { own: false });
  assert.equal(rate.input.value, "12", "the draft was replaced");
  assert.equal(rate.note.textContent, cards.CHANGED_ELSEWHERE);
  assert.equal(rate.value.textContent, "700 lb/hr", "the value behind the editor did not follow");
  view.update({ job: jobAt({ lineRate: 720 }) }, { own: true });
  assert.equal(rate.note.textContent, cards.CHANGED_ELSEWHERE, "the note was cleared by our own echo");
  key(rate.input, "Escape");
  assert.equal(rate.note.textContent, "");
});

test("refresh walks the changeover's remaining time as the clock moves", () => {
  let now = NOW;
  const doc = makeDocument();
  const view = cards.create(doc, { commands: () => null, now: () => now });
  view.update({ job: jobAt() }, {});
  assert.equal(view.card("changeover").sub.textContent, "in 2h 30m");
  now = NOW + HOUR;
  view.refresh();
  assert.equal(view.card("changeover").sub.textContent, "in 1h 30m");
  // A clock time that has passed means tomorrow, by scheduling's own reading.
  now = NOW + 3 * HOUR;
  view.refresh();
  assert.equal(view.card("changeover").sub.textContent, "in 23h 30m");
});
