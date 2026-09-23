"use strict";

/* slate-pressure.js: the converter card in the Scrap card's place. One
 * entry, the unit it was typed in, the same pressure read in the other
 * unit - the application's own factor and roundings, nothing computed
 * here. Its close hands the slot back. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click } = require("./tools/slate-test/fake-dom.js");
const pressure = require("./pressure-conversion.js");
const tool = require("./slate/slate-pressure.js");

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const backs = [];
  const view = tool.create(doc, { pressure: settings.pressure === undefined ? pressure : settings.pressure, back: () => backs.push(true) });
  doc.body.appendChild(view.element);
  const input = view.element.querySelector(".slate-pressure__input");
  const type = value => { input.value = value; input.dispatchEvent({ type: "input", target: input }); };
  return { doc, view, backs, input, type, answer: () => view.element.querySelector(".slate-pressure__answer").textContent, note: () => view.element.querySelector(".slate-card__note") };
}

/* ----------------------------------------------------------------------
 *   The reading
 * -------------------------------------------------------------------- */

test("readingFor is the application's convert() over the entry, read in the other unit with the application's rounding", () => {
  const psi = tool.readingFor(pressure, "120", "psi");
  assert.equal(psi.answer, `${pressure.format(pressure.psiToBar(120), "bar")} bar`);
  assert.equal(psi.answer, "8.27 bar");
  assert.equal(psi.error, "");
  assert.equal(psi.result.psi, 120);
  const bar = tool.readingFor(pressure, "120", "bar");
  assert.equal(bar.answer, "1740.5 PSI");
  // Small pressures keep the extra place the application gives them.
  assert.equal(tool.readingFor(pressure, "1", "psi").answer, "0.069 bar");
  assert.equal(tool.readingFor(pressure, ".5", "bar").answer, "7.3 PSI");
  // Blank is not zero: no answer, no error.
  assert.deepEqual(tool.readingFor(pressure, "", "psi"), { answer: tool.EMPTY, error: "", result: null });
  assert.deepEqual(tool.readingFor(pressure, "   ", "bar"), { answer: tool.EMPTY, error: "", result: null });
  // The application's refusals, in its words.
  assert.equal(tool.readingFor(pressure, "-3", "psi").error, "Pressure in PSI cannot be negative.");
  assert.equal(tool.readingFor(pressure, "abc", "bar").error, "Pressure in bar must be a number.");
  assert.equal(tool.readingFor(pressure, "2000000", "psi").error, "Pressure in PSI must be 1,000,000 or less.");
  assert.equal(tool.readingFor(null, "120", "psi").error, tool.UNAVAILABLE);
  assert.equal(tool.otherOf("psi"), "bar");
  assert.equal(tool.otherOf("bar"), "psi");
});

/* ----------------------------------------------------------------------
 *   The card
 * -------------------------------------------------------------------- */

test("the card starts typed in PSI with no answer; typing reads the entry in bar, and the unit flips the same entry to bar read in PSI", () => {
  const { view, type, answer, note, input } = boot();
  assert.ok(view.element.classList.contains("slate-card"), "the converter is not one of the job's cards");
  assert.equal(view.element.getAttribute("data-from"), "psi");
  assert.equal(view.element.querySelector(".slate-card__label").textContent, tool.TITLE);
  assert.equal(answer(), tool.EMPTY);
  assert.ok(note().hasAttribute("hidden"));
  assert.ok(!view.element.classList.contains("is-answered"));
  const unit = view.element.querySelector("[data-slate-unit]");
  assert.equal(unit.textContent, "PSI");
  assert.equal(unit.getAttribute("title"), "Typed in PSI. Click to type in bar.");
  assert.equal(input.getAttribute("aria-label"), "Pressure in PSI");

  type("120");
  assert.equal(answer(), "8.27 bar");
  assert.ok(view.element.classList.contains("is-answered"));
  assert.equal(view.result().bar, pressure.psiToBar(120));

  // The flip keeps the figure and changes what it means.
  click(unit);
  assert.equal(view.from(), "bar");
  assert.equal(view.element.getAttribute("data-from"), "bar");
  assert.equal(unit.textContent, "bar");
  assert.equal(unit.getAttribute("title"), "Typed in bar. Click to type in PSI.");
  assert.equal(input.getAttribute("aria-label"), "Pressure in bar");
  assert.equal(view.entry(), "120");
  assert.equal(answer(), "1740.5 PSI");
  assert.ok(input.focused, "the flip left the entry");

  click(unit);
  assert.equal(view.from(), "psi");
  assert.equal(answer(), "8.27 bar");

  // Clearing the entry clears the answer.
  type("");
  assert.equal(answer(), tool.EMPTY);
  assert.ok(!view.element.classList.contains("is-answered"));
  assert.equal(view.result(), null);
});

test("a refused entry shows the application's words on the card and marks the field; a good one clears them", () => {
  const { view, type, answer, note, input } = boot();
  type("-3");
  assert.equal(answer(), tool.EMPTY);
  assert.ok(!note().hasAttribute("hidden"));
  assert.equal(note().textContent, "Pressure in PSI cannot be negative.");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(view.result(), null);
  type("30");
  assert.ok(note().hasAttribute("hidden"));
  assert.equal(input.getAttribute("aria-invalid"), null);
  assert.equal(answer(), "2.07 bar");
});

test("without the shared conversion the card says so and takes no entry", () => {
  const { view, answer, note, input } = boot({ pressure: null });
  assert.equal(answer(), tool.EMPTY);
  assert.equal(note().textContent, tool.UNAVAILABLE);
  assert.ok(!note().hasAttribute("hidden"));
  assert.ok(input.hasAttribute("disabled"));
  assert.equal(input.getAttribute("aria-invalid"), null, "an absent module is not the operator's mistake");
  view.onShow();
  assert.ok(!input.focused, "a disabled entry was focused");
});

test("the close hands the slot back; showing the card focuses the entry; nothing is dispatched and nothing persists", () => {
  const { view, backs, input } = boot();
  const close = view.element.querySelector("[data-slate-back]");
  assert.equal(close.getAttribute("aria-label"), tool.CLOSE_LABEL);
  assert.ok(close.classList.contains("slate-panel__close"), "the close is not the panels' close");
  click(close);
  assert.deepEqual(backs, [true]);
  view.onShow();
  assert.ok(input.focused);
  assert.equal(view.element.querySelectorAll("input").length, 1);
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/slate-pressure.js"), "utf8");
  assert.doesNotMatch(source, /\.dispatch\s*\(|localStorage|PSI_PER_BAR|6894|14\.50/, "the card computes or stores on its own");
});

test("under a finger the tool never pops the keyboard: showing it or flipping the unit leaves the field unfocused", () => {
  const doc = makeDocument();
  const view = tool.create(doc, { pressure, back: () => {}, tier: () => ({ input: "touch", width: "wide" }) });
  doc.body.appendChild(view.element);
  const input = view.element.querySelector(".slate-pressure__input");
  view.onShow();
  assert.notEqual(input.focused, true, "showing the tool focused the field");
  view.flip();
  assert.notEqual(input.focused, true, "flipping the unit focused the field");
  const mouse = boot();
  mouse.view.onShow();
  assert.equal(mouse.input.focused, true, "a mouse lost the field's focus on show");
});
