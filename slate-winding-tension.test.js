"use strict";

/* slate-winding-tension.js: the calculator in the Timeline's place.
 * Thickness, width and ups in; the application's own recommendation out
 * - target, PLI, range, wind type, taper - and nothing computed here. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click } = require("./tools/slate-test/fake-dom.js");
const winding = require("./winding-tension.js");
const tool = require("./slate/slate-winding-tension.js");

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const backs = [];
  const view = tool.create(doc, { winding: settings.winding === undefined ? winding : settings.winding, back: () => backs.push(true) });
  doc.body.appendChild(view.element);
  const field = key => view.element.querySelector(`.slate-winding__input[data-field='${key}']`);
  const type = (key, value) => { const input = field(key); input.value = value; input.dispatchEvent({ type: "input", target: input }); };
  const textOf = selector => view.element.querySelector(selector).textContent;
  return { doc, view, backs, field, type, textOf, result: () => view.element.querySelector(".slate-winding__result"), note: () => view.element.querySelector(".slate-winding__note") };
}

/* ----------------------------------------------------------------------
 *   The reading
 * -------------------------------------------------------------------- */

test("readingFor prompts while a required entry is blank, refuses in the application's words, and otherwise is the application's calculate()", () => {
  assert.deepEqual(tool.readingFor(winding, { thickness: "", width: "", ups: "1" }), { result: null, message: tool.PROMPT, invalid: false });
  assert.deepEqual(tool.readingFor(winding, { thickness: "2", width: " ", ups: "1" }), { result: null, message: tool.PROMPT, invalid: false });
  const refused = tool.readingFor(winding, { thickness: "0", width: "40", ups: "1" });
  assert.equal(refused.result, null);
  assert.equal(refused.message, "Film thickness must be a number greater than 0.");
  assert.equal(refused.invalid, true);
  assert.equal(tool.readingFor(winding, { thickness: "2", width: "40", ups: "0" }).message, "Number of ups must be a whole number of 1 or more.");
  assert.equal(tool.readingFor(winding, { thickness: "2", width: "40", ups: "" }).message, "Number of ups must be a whole number of 1 or more.");
  const good = tool.readingFor(winding, { thickness: "2.3", width: "40", ups: "1" });
  assert.deepEqual(good.result, winding.calculate({ filmThicknessMil: "2.3", rollWidthIn: "40", ups: "1" }));
  assert.equal(good.message, "");
  assert.equal(tool.readingFor(null, { thickness: "2", width: "40", ups: "1" }).message, tool.UNAVAILABLE);
});

/* ----------------------------------------------------------------------
 *   The panel
 * -------------------------------------------------------------------- */

test("the panel asks for thickness, width and ups (1 by default), and draws the application's answer once the required two are in", () => {
  const { view, field, type, textOf, result, note } = boot();
  assert.ok(view.element.classList.contains("slate-panel"));
  assert.equal(textOf(".slate-panel__title"), tool.TITLE);
  assert.deepEqual(view.element.querySelectorAll(".slate-winding__input").map(input => input.getAttribute("data-field")), ["thickness", "width", "ups"]);
  assert.equal(field("ups").value, "1");
  assert.equal(field("thickness").getAttribute("aria-label"), "Film thickness (mil)");
  assert.ok(result().hasAttribute("hidden"));
  assert.equal(note().textContent, tool.PROMPT);
  assert.ok(!note().classList.contains("is-invalid"));

  type("thickness", "2.3");
  assert.ok(result().hasAttribute("hidden"), "an answer with no width");
  assert.equal(note().textContent, tool.PROMPT);
  type("width", "40");
  const expected = winding.calculate({ filmThicknessMil: "2.3", rollWidthIn: "40", ups: "1" });
  assert.ok(!result().hasAttribute("hidden"));
  assert.ok(view.element.classList.contains("is-answered"));
  assert.ok(note().hasAttribute("hidden"));
  assert.equal(textOf(".slate-winding__target"), winding.formatTension(expected.target));
  assert.equal(textOf(".slate-winding__target"), "13.2");
  assert.equal(textOf(".slate-winding__pli"), "0.33 PLI");
  assert.equal(textOf(".slate-winding__end[data-end='min'] .slate-winding__end-value"), "8.0");
  assert.equal(textOf(".slate-winding__end[data-end='target'] .slate-winding__end-value"), "13.2");
  assert.equal(textOf(".slate-winding__end[data-end='max'] .slate-winding__end-value"), "16.0");
  assert.equal(textOf("[data-advice='wind']"), "Surface Wind or Center/Surface");
  assert.equal(textOf("[data-advice='taper']"), "30 – 50%");
  assert.equal(textOf(".slate-winding__notice"), winding.NOTICE);
  assert.deepEqual(view.result(), expected);

  // Ups scale the pounds, not the PLI.
  type("ups", "2");
  assert.equal(textOf(".slate-winding__target"), "26.4");
  assert.equal(textOf(".slate-winding__pli"), "0.33 PLI");
  assert.equal(textOf(".slate-winding__end[data-end='max'] .slate-winding__end-value"), "32.0");
});

test("a refused entry hides the answer and says why in red; the answer returns when it is put right", () => {
  const { view, type, result, note } = boot();
  type("thickness", "2");
  type("width", "40");
  type("ups", "1.5");
  assert.ok(result().hasAttribute("hidden"));
  assert.equal(note().textContent, "Number of ups must be a whole number of 1 or more.");
  assert.ok(note().classList.contains("is-invalid"));
  assert.equal(view.result(), null);
  type("ups", "3");
  assert.ok(!result().hasAttribute("hidden"));
  assert.ok(note().hasAttribute("hidden"));
  assert.ok(!note().classList.contains("is-invalid"));
});

test("Clear empties the entries, puts ups back to 1, and returns to the prompt with the first entry focused", () => {
  const { view, field, type, result, note } = boot();
  type("thickness", "8");
  type("width", "60");
  type("ups", "2");
  assert.ok(!result().hasAttribute("hidden"));
  click(view.element.querySelector("[data-slate-clear]"));
  assert.deepEqual(view.entries(), { thickness: "", width: "", ups: "1" });
  assert.ok(result().hasAttribute("hidden"));
  assert.equal(note().textContent, tool.PROMPT);
  assert.ok(field("thickness").focused);
});

test("without the shared calculation the panel says so and takes no entry", () => {
  const { view, field, note, result } = boot({ winding: null });
  assert.equal(note().textContent, tool.UNAVAILABLE);
  assert.ok(!note().classList.contains("is-invalid"));
  assert.ok(result().hasAttribute("hidden"));
  for (const key of ["thickness", "width", "ups"]) assert.ok(field(key).hasAttribute("disabled"));
  view.onShow();
  assert.ok(!field("thickness").focused, "a disabled entry was focused");
});

test("the close hands the aside back; showing the panel focuses thickness; nothing is dispatched and no band lives here", () => {
  const { view, backs, field } = boot();
  const close = view.element.querySelector("[data-slate-back]");
  assert.equal(close.getAttribute("aria-label"), tool.CLOSE_LABEL);
  click(close);
  assert.deepEqual(backs, [true]);
  view.onShow();
  assert.ok(field("thickness").focused);
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/slate-winding-tension.js"), "utf8");
  assert.doesNotMatch(source, /\.dispatch\s*\(|localStorage|TENSION_BANDS|0\.15|0\.80|Surface Wind/, "the panel computes or stores on its own");
});
