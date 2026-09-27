"use strict";

/* slate-formulas.js: the floor's arithmetic in the Timeline's place.
 * Pounds per thousand feet two ways, with a "?" that says what they
 * mean; under them Conversions, folded - a row per quantity, an entry,
 * the unit it was typed in, the figure in the other units. The
 * application's own arithmetic, nothing computed here. Its close hands
 * the aside back. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click } = require("./tools/slate-test/fake-dom.js");
const conversions = require("./unit-conversions.js");
const tool = require("./slate/slate-formulas.js");

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const backs = [];
  const view = tool.create(doc, Object.assign({ conversions: settings.conversions === undefined ? conversions : settings.conversions, back: () => backs.push(true) },
    settings.tier ? { tier: settings.tier } : {}, settings.densities ? { densities: settings.densities } : {}));
  doc.body.appendChild(view.element);
  const row = key => view.element.querySelector(`.slate-formulas__row[data-quantity='${key}']`);
  const input = key => row(key).querySelector(".slate-formulas__input");
  const type = (key, value) => { input(key).value = value; input(key).dispatchEvent({ type: "input", target: input(key) }); };
  return {
    doc, view, backs, row, input, type,
    unit: key => row(key).querySelector("[data-slate-unit]"),
    answer: key => row(key).querySelector(".slate-formulas__answer").textContent,
    note: key => row(key).querySelector(".slate-formulas__note")
  };
}

test("readingFor reads the entry in every other unit of its quantity with the application's rounding, or its refusal", () => {
  assert.equal(tool.readingFor(conversions, "pressure", "120", "psi").answer, "8.27 bar");
  assert.equal(tool.readingFor(conversions, "pressure", "120", "bar").answer, "1740.5 PSI");
  assert.equal(tool.readingFor(conversions, "thickness", "2", "mil").answer, "50.8 µm · 200 ga");
  assert.equal(tool.readingFor(conversions, "thickness", "50.8", "um").answer, "2.00 mil · 200 ga");
  assert.equal(tool.readingFor(conversions, "temperature", "400", "f").answer, "204.4 °C");
  assert.equal(tool.readingFor(conversions, "rate", "850", "lbhr").answer, "385.6 kg/hr");
  assert.deepEqual(tool.readingFor(conversions, "width", "  ", "in"), { answer: tool.EMPTY, error: "", result: null });
  assert.equal(tool.readingFor(conversions, "weight", "-3", "lb").error, "Weight in lb cannot be negative.");
  assert.equal(tool.readingFor(null, "weight", "3", "lb").error, tool.UNAVAILABLE);
  const film = conversions.quantityOf("thickness");
  assert.equal(tool.nextOf(film, "mil"), "um");
  assert.equal(tool.nextOf(film, "gauge"), "mil");
});

test("the panel is the aside's, titled Formulas; Conversions below is folded, a row per quantity, each typed in its base unit with no answer", () => {
  const { view, row, unit, answer, note, input } = boot();
  assert.ok(view.element.classList.contains("slate-panel"));
  assert.equal(view.element.querySelector(".slate-panel__title").textContent, "Formulas");
  const fold = view.element.querySelector("[data-slate-fold]");
  const body = view.element.querySelector(".slate-formulas__fold-body");
  assert.equal(fold.querySelector(".slate-formulas__toggle-label").textContent, "Conversions");
  assert.equal(fold.getAttribute("aria-expanded"), "false");
  assert.ok(body.hasAttribute("hidden") && view.isFolded());
  assert.ok(body.querySelector(".slate-formulas__list"), "the rows are not inside the fold");
  assert.equal(body.querySelector(".slate-formulas__caption").textContent, tool.CONVERSIONS_CAPTION);
  click(fold);
  assert.ok(!body.hasAttribute("hidden") && !view.isFolded());
  assert.equal(fold.getAttribute("aria-expanded"), "true");
  click(fold);
  assert.ok(body.hasAttribute("hidden"));
  assert.deepEqual(view.element.querySelectorAll(".slate-formulas__row").map(one => one.getAttribute("data-quantity")), conversions.QUANTITIES.map(one => one.key));
  for (const quantity of conversions.QUANTITIES) {
    assert.equal(row(quantity.key).querySelector(".slate-formulas__label").textContent, quantity.label);
    assert.equal(unit(quantity.key).textContent, quantity.units[0].label);
    assert.equal(answer(quantity.key), tool.EMPTY);
    assert.ok(note(quantity.key).hasAttribute("hidden"));
  }
  assert.equal(unit("pressure").getAttribute("title"), "Typed in PSI. Click to type in bar.");
  assert.equal(input("pressure").getAttribute("aria-label"), "Pressure in PSI");
});

test("typing reads across; the unit chip cycles the quantity's units and reads the same entry again from each", () => {
  const { view, type, unit, answer, row, input } = boot();
  type("thickness", "2");
  assert.equal(answer("thickness"), "50.8 µm · 200 ga");
  assert.ok(row("thickness").classList.contains("is-answered"));
  click(unit("thickness"));
  assert.equal(view.from("thickness"), "um");
  assert.equal(row("thickness").getAttribute("data-from"), "um");
  assert.equal(unit("thickness").getAttribute("title"), "Typed in µm. Click to type in ga.");
  assert.equal(answer("thickness"), "0.079 mil · 8 ga");
  assert.ok(input("thickness").focused, "the flip left the entry");
  click(unit("thickness"));
  assert.equal(view.from("thickness"), "gauge");
  assert.equal(answer("thickness"), "0.020 mil · 0.51 µm");
  click(unit("thickness"));
  assert.equal(view.from("thickness"), "mil");
  // One row's entry never moves another's.
  assert.equal(answer("pressure"), tool.EMPTY);
  type("thickness", "");
  assert.equal(answer("thickness"), tool.EMPTY);
  assert.equal(view.result("thickness"), null);
});

test("a refused entry shows the application's words under its own row and marks the field; a good one clears them", () => {
  const { type, answer, note, input } = boot();
  type("weight", "-3");
  assert.equal(answer("weight"), tool.EMPTY);
  assert.equal(note("weight").textContent, "Weight in lb cannot be negative.");
  assert.ok(!note("weight").hasAttribute("hidden"));
  assert.equal(input("weight").getAttribute("aria-invalid"), "true");
  assert.ok(note("length").hasAttribute("hidden"), "another row showed the refusal");
  type("weight", "310");
  assert.ok(note("weight").hasAttribute("hidden"));
  assert.equal(input("weight").getAttribute("aria-invalid"), null);
  assert.equal(answer("weight"), "140.61 kg");
});

test("Clear empties every row and turns each back to its base unit", () => {
  const { view, type, unit, answer, input } = boot();
  type("pressure", "120");
  click(unit("pressure"));
  type("length", "5000");
  click(view.element.querySelector("[data-slate-clear]"));
  assert.equal(input("pressure").value, "");
  assert.equal(input("length").value, "");
  assert.equal(view.from("pressure"), "psi");
  assert.equal(answer("pressure"), tool.EMPTY);
  assert.equal(answer("length"), tool.EMPTY);
});

test("without the shared conversions the panel says so and draws no rows", () => {
  const { view } = boot({ conversions: null });
  assert.equal(view.element.querySelectorAll(".slate-formulas__row").length, 0);
  assert.equal(view.element.querySelector(".slate-formulas__per-thousand"), null);
  assert.ok(view.element.querySelector("[data-slate-fold]").hasAttribute("disabled"));
  const status = view.element.querySelectorAll(".slate-formulas__note").find(one => !one.hasAttribute("hidden"));
  assert.equal(status.textContent, tool.UNAVAILABLE);
  assert.ok(view.element.querySelector("[data-slate-clear]").hasAttribute("disabled"));
  view.onShow();
});

test("the close hands the aside back; showing the panel focuses the first entry; nothing is computed, dispatched or stored here", () => {
  const { view, backs, input } = boot();
  const close = view.element.querySelector("[data-slate-back]");
  assert.equal(close.getAttribute("aria-label"), tool.CLOSE_LABEL);
  click(close);
  assert.deepEqual(backs, [true]);
  view.onShow();
  assert.ok(view.element.querySelector(".slate-formulas__field-input[data-field='rollWeight']").focused, "the first entry is not the one focused");
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/slate-formulas.js"), "utf8");
  assert.doesNotMatch(source, /\.dispatch\s*\(|localStorage|25\.4|0\.3048|0\.4535|14\.50|9 \/ 5/, "the panel computes or stores on its own");
});

test("under a finger the panel never pops the keyboard: showing it or changing a unit leaves the field unfocused", () => {
  const { view, unit, input } = boot({ tier: () => ({ input: "touch", width: "wide" }) });
  view.onShow();
  assert.equal(view.element.querySelectorAll("input").filter(one => one.focused).length, 0, "showing the panel focused a field");
  click(unit("pressure"));
  assert.notEqual(input("pressure").focused, true, "changing the unit focused the field");
});

/* ----------------------------------------------------------------------
 *   Pounds per thousand feet
 * -------------------------------------------------------------------- */

function perThousand(view) {
  const field = (method, key) => view.element.querySelector(`.slate-formulas__field-input[data-method='${method}'][data-field='${key}']`);
  const group = method => view.element.querySelector(`.slate-formulas__method[data-method='${method}']`);
  return {
    field, group,
    type(method, key, value) { const input = field(method, key); input.value = value; input.dispatchEvent({ type: "input", target: input }); },
    answer: method => group(method).querySelector(".slate-formulas__answer").textContent,
    note: method => group(method).querySelector(".slate-formulas__note")
  };
}

test("pounds per thousand feet leads the panel, above the unit rows, with its two ways each answering on its own", () => {
  const { view } = boot();
  const block = view.element.querySelector(".slate-formulas__per-thousand");
  assert.ok(block, "the block is missing");
  const children = view.element.querySelector(".slate-formulas__body").children;
  assert.ok(children.indexOf(block) < children.indexOf(view.element.querySelector(".slate-formulas__fold")), "the block is not above Conversions");
  assert.equal(block.querySelector(".slate-formulas__label").textContent, tool.PER_THOUSAND_TITLE);
  assert.deepEqual(block.querySelectorAll(".slate-formulas__method").map(one => one.getAttribute("data-method")), ["rolls", "width", "check"]);
  assert.deepEqual(block.querySelectorAll(".slate-formulas__field-label").map(one => one.textContent), ["Max roll weight", "Rolls per set", "Footage", "Width (on the roll)", "Thickness", "Density"]);

  const calc = perThousand(view);
  calc.type("rolls", "rollWeight", "500");
  calc.type("rolls", "rolls", "4");
  assert.equal(calc.answer("rolls"), tool.EMPTY, "an answer before every entry was in");
  assert.ok(calc.note("rolls").hasAttribute("hidden"), "a half-filled way was refused");
  calc.type("rolls", "footage", "10000");
  assert.equal(calc.answer("rolls"), "200.00 lb / 1,000 ft");
  assert.ok(calc.group("rolls").classList.contains("is-answered"));
  assert.equal(view.perThousand("rolls").lbPerThousand, 200);
  assert.equal(calc.answer("width"), tool.EMPTY, "one way answered for the other");

  calc.type("width", "width", "48");
  calc.type("width", "mil", "1.5");
  assert.equal(calc.answer("width"), "57.60 lb / 1,000 ft");

  calc.type("rolls", "footage", "0");
  assert.equal(calc.answer("rolls"), tool.EMPTY);
  assert.equal(calc.note("rolls").textContent, "Footage must be more than zero.");
  assert.equal(calc.answer("width"), "57.60 lb / 1,000 ft", "a refusal in one way moved the other");

  click(view.element.querySelector("[data-slate-clear]"));
  assert.equal(calc.field("rolls", "rollWeight").value, "");
  assert.equal(calc.answer("rolls"), tool.EMPTY);
  assert.ok(calc.note("rolls").hasAttribute("hidden"));
  assert.equal(calc.answer("width"), tool.EMPTY);
});

test("perThousandFor is the application's arithmetic with its refusals, and nothing until every entry is in", () => {
  assert.deepEqual(tool.perThousandFor(conversions, "rolls", { rollWeight: "500", rolls: "", footage: "10000" }), { answer: tool.EMPTY, error: "", result: null });
  assert.equal(tool.perThousandFor(conversions, "rolls", { rollWeight: "620", rolls: "2", footage: "8000" }).answer, "155.00 lb / 1,000 ft");
  assert.equal(tool.perThousandFor(conversions, "rolls", { rollWeight: "500", rolls: "2.5", footage: "10000" }).error, "Rolls per set must be a whole number.");
  assert.equal(tool.perThousandFor(conversions, "width", { width: "36", mil: "2" }).answer, "57.60 lb / 1,000 ft");
  assert.equal(tool.perThousandFor(conversions, "width", { width: "-36", mil: "2" }).error, "Width (on the roll) must be more than zero.");
  assert.equal(tool.perThousandFor(null, "width", { width: "36", mil: "2" }).error, tool.UNAVAILABLE);
});

test("each way shows its formula - the film's as 12 ÷ 15 - and the \"?\" beside From the rolls opens what they mean, closing on a second press, Escape or the panel's close", () => {
  const { view, backs } = boot();
  assert.deepEqual(view.element.querySelectorAll(".slate-formulas__formula").map(one => one.textContent), ["Roll weight × rolls ÷ (footage ÷ 1,000)", "Width × mil × 12 ÷ 15"]);
  const infos = view.element.querySelectorAll("[data-slate-info]");
  assert.equal(infos.length, 1, "there is not exactly one ?");
  const button = infos[0];
  assert.ok(view.element.querySelector(".slate-formulas__method[data-method='rolls'] .slate-formulas__method-head").contains(button), "the ? is not beside From the rolls");
  assert.equal(button.getAttribute("aria-label"), tool.INFO_LABEL);
  const pop = view.element.querySelector(".slate-formulas__info-pop");
  assert.ok(pop.hasAttribute("hidden"));
  assert.equal(button.getAttribute("aria-expanded"), "false");
  click(button);
  assert.ok(!pop.hasAttribute("hidden") && view.isInfoOpen());
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.deepEqual(pop.querySelectorAll(".slate-formulas__info-heading").map(one => one.textContent), ["From the rolls", "From the film", "Width", "Density", "Weighed set check"]);
  const words = pop.querySelectorAll(".slate-formulas__info-line").map(one => one.textContent).join(" ");
  for (const fact of ["footage in feet", "after trim", "ground back into the screw", "6.7% heavy", "12,000 inches", "0.001 in", "30 cubic inches to the pound", "two walls", "30 ÷ 2", "0.8", "÷ 30", "0.92", "13.84 ÷ density"]) {
    assert.ok(words.includes(fact), `the ? does not say ${fact}`);
  }
  // Short: a line or three a section.
  assert.ok(words.length < 900, `the ? runs to ${words.length} characters`);
  click(button);
  assert.ok(pop.hasAttribute("hidden"), "a second press left it open");
  click(button);
  const wrap = view.element.querySelector(".slate-formulas__info");
  wrap.dispatchEvent({ type: "keydown", key: "Escape", target: wrap, stopPropagation() {} });
  assert.ok(pop.hasAttribute("hidden"), "Escape left it open");
  click(button);
  click(view.element.querySelector("[data-slate-back]"));
  assert.ok(pop.hasAttribute("hidden"), "closing the panel left it open");
  assert.deepEqual(backs, [true]);
});

/* ----------------------------------------------------------------------
 *   The film's density
 * -------------------------------------------------------------------- */

const known = () => ({
  traveler: { density: 0.923, missing: [] },
  current: { density: 0.9181, missing: [], empty: false },
  next: { density: null, missing: ["AB120", "WHITE-MB"], empty: false }
});

test("the film's density is optional: empty is the floor's 12 ÷ 15; given, the 15 is worked out for it and the formula line says so", () => {
  const { view } = boot();
  const calc = perThousand(view);
  const formula = () => calc.group("width").querySelector(".slate-formulas__formula").textContent;
  assert.equal(calc.field("width", "density").getAttribute("placeholder"), "optional");
  calc.type("width", "width", "48");
  calc.type("width", "mil", "1.5");
  assert.equal(calc.answer("width"), "57.60 lb / 1,000 ft");
  assert.equal(formula(), "Width × mil × 12 ÷ 15");
  calc.type("width", "density", "0.95");
  assert.equal(calc.answer("width"), "59.31 lb / 1,000 ft at 0.950 g/cc");
  assert.equal(formula(), "Width × mil × 12 ÷ 14.57 (at 0.950 g/cc)");
  calc.type("width", "density", "12");
  assert.equal(calc.note("width").textContent, "Density must be 10 or less.");
  assert.equal(formula(), "Width × mil × 12 ÷ 15");
  calc.type("width", "density", "");
  assert.equal(calc.answer("width"), "57.60 lb / 1,000 ft");
});

test("Traveler, Current and Next fill the density in one press and the answer names the source; typing over it makes it the operator's own", () => {
  const { view } = boot({ densities: known });
  const calc = perThousand(view);
  const chip = key => view.element.querySelector(`.slate-formulas__source[data-source='${key}']`);
  const value = key => chip(key).querySelector(".slate-formulas__source-value").textContent;
  assert.deepEqual(view.element.querySelectorAll(".slate-formulas__source").map(one => one.getAttribute("data-source")), ["traveler", "current", "next"]);
  assert.equal(view.element.querySelectorAll(".slate-formulas__method[data-method='rolls'] .slate-formulas__source").length, 0, "the rolls' way offers densities");
  assert.equal(value("traveler"), "0.923");
  assert.equal(value("current"), "0.918");
  assert.equal(value("next"), tool.EMPTY);
  assert.ok(!chip("traveler").hasAttribute("disabled") && !chip("current").hasAttribute("disabled"));
  assert.ok(chip("next").hasAttribute("disabled"), "a recipe missing a density offered one");
  const note = view.element.querySelector(".slate-formulas__sources-note");
  assert.ok(!note.hasAttribute("hidden"));
  assert.equal(note.textContent, "Next: no density for AB120, WHITE-MB.");

  calc.type("width", "width", "48");
  calc.type("width", "mil", "1.5");
  click(chip("current"));
  assert.equal(calc.field("width", "density").value, "0.918");
  assert.equal(calc.answer("width"), "57.31 lb / 1,000 ft at 0.918 g/cc (Current)");
  click(chip("traveler"));
  assert.equal(calc.answer("width"), "57.62 lb / 1,000 ft at 0.923 g/cc (Traveler)");
  click(chip("next"));
  assert.equal(calc.field("width", "density").value, "0.923", "a disabled source filled the entry");
  calc.type("width", "density", "0.93");
  assert.equal(calc.answer("width"), "58.06 lb / 1,000 ft at 0.930 g/cc", "a typed density kept a source's name");
  click(view.element.querySelector("[data-slate-clear]"));
  assert.equal(calc.field("width", "density").value, "");
});

test("the sources are read again as the panel is shown and as the state changes; without any, every source is dimmed and nothing is said", () => {
  let now = { traveler: { density: null, missing: [] }, current: { density: null, missing: [], empty: true }, next: { density: null, missing: [], empty: true } };
  const { view } = boot({ densities: () => now });
  const chip = key => view.element.querySelector(`.slate-formulas__source[data-source='${key}']`);
  assert.ok(["traveler", "current", "next"].every(key => chip(key).hasAttribute("disabled")));
  assert.ok(view.element.querySelector(".slate-formulas__sources-note").hasAttribute("hidden"), "an empty recipe was reported as missing densities");
  assert.equal(chip("next").getAttribute("title"), "Nothing planned");
  now = known();
  view.update({}, {});
  assert.ok(!chip("current").hasAttribute("disabled"));
  now = { traveler: { density: 0.95, missing: [] }, current: now.current, next: now.next };
  view.onShow();
  assert.equal(chip("traveler").querySelector(".slate-formulas__source-value").textContent, "0.950");
  // No densities function at all: dimmed, never thrown.
  const bare = boot();
  assert.ok(bare.view.element.querySelector(".slate-formulas__source[data-source='current']").hasAttribute("disabled"));
});

test("with no resin database at all, the note says so once rather than naming every resin as missing", () => {
  const none = { density: null, missing: [], empty: false, noCatalog: true };
  const { view } = boot({ densities: () => ({ traveler: { density: null, missing: [] }, current: none, next: none }) });
  const note = view.element.querySelector(".slate-formulas__sources-note");
  assert.equal(note.textContent, tool.NO_CATALOG);
  assert.equal(tool.reasonFor("current", { density: null, missing: ["LL318"] }), "Current: no density for LL318.");
  assert.equal(tool.reasonFor("next", { density: 0.92, missing: [] }), "");
});

/* ----------------------------------------------------------------------
 *   The weighed set's check
 * -------------------------------------------------------------------- */

test("the weighed set's check waits for the rolls, then for the film's width, then works back to the density and gauge the set implies and how far it reads from the film", () => {
  const { view } = boot();
  const calc = perThousand(view);
  const group = view.element.querySelector(".slate-formulas__check");
  const prompt = () => group.querySelector("[data-check-prompt]");
  const value = key => { const node = group.querySelector(`[data-check='${key}']`); return node ? node.textContent : null; };
  assert.equal(group.querySelector(".slate-formulas__method-title").textContent, tool.CHECK_TITLE);
  assert.equal(prompt().textContent, tool.CHECK_PROMPT);
  assert.ok(group.querySelector(".slate-formulas__check-list").hasAttribute("hidden"));

  // Line 8: 72.5 in layflat, 0.395 mil; a set weighing 24.93 lb/1,000 ft.
  calc.type("rolls", "rollWeight", "249.3");
  calc.type("rolls", "rolls", "1");
  calc.type("rolls", "footage", "10000");
  assert.equal(calc.answer("rolls"), "24.93 lb / 1,000 ft");
  assert.equal(prompt().textContent, tool.CHECK_NEEDS_WIDTH);
  calc.type("width", "width", "72.5");
  assert.ok(prompt().hasAttribute("hidden"));
  assert.equal(value("gauge"), "0.430 mil (at 12 ÷ 15)");
  assert.equal(value("density"), null, "a density was implied without the mil");
  calc.type("width", "mil", "0.395");
  assert.equal(value("density"), "1.004 g/cc");
  assert.equal(value("difference"), "+8.8% heavier");
  assert.ok(group.classList.contains("is-answered"));
  // With the traveler's density the film's figure and the set agree.
  calc.type("width", "density", "1.0021");
  assert.equal(value("difference"), "+0.2% heavier");
  assert.equal(value("gauge"), "0.396 mil (at 1.002 g/cc)");
  // An impossible set is flagged, not trusted.
  calc.type("rolls", "rollWeight", "2493");
  const warning = group.querySelector(".slate-formulas__note");
  assert.ok(!warning.hasAttribute("hidden"));
  assert.match(warning.textContent, /^No film weighs 10\.040 g\/cc/);
  // Clear empties it back to the prompt.
  click(view.element.querySelector("[data-slate-clear]"));
  assert.equal(prompt().textContent, tool.CHECK_PROMPT);
  assert.ok(warning.hasAttribute("hidden"));
});

test("checkFor is the application's arithmetic, worded; a lighter set says so", () => {
  const rolls = { lbPerThousand: 22 };
  const film = conversions.poundsPerThousand("width", { width: "72.5", mil: "0.395" });
  const reading = tool.checkFor(conversions, rolls, { width: "72.5", mil: "0.395", density: "" }, film);
  assert.deepEqual(reading.lines.map(line => line.key), ["difference", "density", "gauge"]);
  assert.equal(reading.lines[0].value, "−4.0% lighter");
  assert.equal(tool.checkFor(conversions, rolls, { width: "72.5", mil: "0.395" }, { lbPerThousand: 22, density: null }).lines[0].value, "the same");
  assert.equal(tool.checkFor(conversions, null, {}, null).prompt, tool.CHECK_PROMPT);
  assert.equal(tool.checkFor(null, rolls, {}, null).prompt, tool.CHECK_PROMPT);
});
