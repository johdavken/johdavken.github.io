"use strict";

/* slate-resin-search.js: the catalog search and the combobox over it. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, key, click } = require("./tools/slate-test/fake-dom.js");
const search = require("./slate/slate-resin-search.js");

const CATALOG = [
  { resin_code: "AB120", density_g_cm3: 0.92 },
  { resin_code: "HX204", density_g_cm3: 0.951 },
  { resin_code: "LD105", density_g_cm3: null },
  { resin_code: "LL318", density_g_cm3: 0.918 },
  { resin_code: "SL710" },
  { resin_code: "HD622" },
  { resin_code: "EVA340" },
  { resin_code: "XLL9" },
  { resin_code: "LLX1" },
  { resin_code: "ZLL2" }
];

test("filterResins: starts-with before contains, catalog order within each, capped; blank lists the head", () => {
  assert.deepEqual(search.filterResins(CATALOG, "ll").map(one => one.resin_code), ["LL318", "LLX1", "XLL9", "ZLL2"]);
  assert.deepEqual(search.filterResins(CATALOG, " Hx ").map(one => one.resin_code), ["HX204"]);
  assert.equal(search.filterResins(CATALOG, "").length, search.RESULT_LIMIT);
  assert.equal(search.filterResins(CATALOG, "", 3).length, 3);
  assert.deepEqual(search.filterResins(CATALOG, "nothing"), []);
  assert.deepEqual(search.filterResins(null, "x"), []);
  assert.deepEqual(search.filterResins(["AB120", { code: "AB9" }], "ab").map(one => search.normalize(one.resin_code || one.code || one)), ["AB120", "AB9"]);
});

test("optionsFor adds the typed code as its own last option only when nothing matches it exactly", () => {
  const typed = search.optionsFor(CATALOG, "ll");
  assert.equal(typed[typed.length - 1].custom, true);
  assert.equal(typed[typed.length - 1].code, "ll");
  const exact = search.optionsFor(CATALOG, "ll318");
  assert.deepEqual(exact.map(one => [one.code, one.custom]), [["LL318", false]]);
  assert.equal(search.optionsFor(CATALOG, "").some(one => one.custom), false);
  assert.equal(search.optionsFor([], "brand-new")[0].code, "brand-new");
  assert.equal(search.optionsFor(CATALOG, "x".repeat(101)).length, 0, "an over-long code was offered");
  assert.equal(search.densityNote(CATALOG[1]), "0.951 g/cm³");
  assert.equal(search.densityNote(CATALOG[2]), "");
  assert.equal(search.optionsFor(CATALOG, "hx")[0].note, "0.951 g/cm³");
});

function open(options) {
  const doc = makeDocument();
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const chosen = [];
  let cancelled = 0;
  const box = search.open(doc, host, Object.assign({ resins: () => CATALOG, onChoose: code => chosen.push(code), onCancel: () => { cancelled += 1; } }, options || {}));
  return { doc, host, box, chosen, cancelled: () => cancelled };
}

test("the combobox opens on the current code, focused and selected, listing the matches with the first active", () => {
  const { host, box } = open({ value: "hx204" });
  assert.ok(host.querySelector(".slate-combobox") === box.element);
  assert.equal(box.input.getAttribute("role"), "combobox");
  assert.equal(box.input.value, "hx204");
  assert.equal(box.input.focused, true);
  assert.equal(box.input.selected, true);
  const options = box.list.querySelectorAll("[role='option']");
  assert.deepEqual(options.map(one => one.getAttribute("data-resin")), ["HX204"]);
  assert.equal(options[0].getAttribute("aria-selected"), "true");
  assert.equal(box.input.getAttribute("aria-activedescendant"), options[0].getAttribute("id"));
});

test("typing filters, arrows move the active option, Enter chooses it once and closes", () => {
  const { host, box, chosen } = open({ value: "" });
  box.input.value = "ll";
  box.input.dispatchEvent({ type: "input" });
  assert.deepEqual(box.options().map(one => one.code), ["LL318", "LLX1", "XLL9", "ZLL2", "ll"]);
  key(box.input, "ArrowDown");
  key(box.input, "ArrowDown");
  assert.equal(box.active(), 2);
  assert.equal(box.list.querySelectorAll("[role='option']")[2].classList.contains("is-active"), true);
  key(box.input, "ArrowUp");
  assert.equal(box.active(), 1);
  key(box.input, "Enter");
  assert.deepEqual(chosen, ["LLX1"]);
  assert.equal(box.isOpen(), false);
  assert.equal(host.querySelector(".slate-combobox"), null, "the combobox left its element behind");
  key(box.input, "Enter");
  assert.deepEqual(chosen, ["LLX1"], "a closed combobox chose again");
});

test("an unknown code is chosen as typed; an emptied field chooses nothing; Escape and an outside blur cancel", () => {
  const custom = open({ value: "" });
  custom.box.input.value = "  brand new ";
  custom.box.input.dispatchEvent({ type: "input" });
  const last = custom.box.options()[custom.box.options().length - 1];
  assert.equal(last.custom, true);
  for (let step = 0; step < custom.box.options().length - 1; step += 1) key(custom.box.input, "ArrowDown");
  key(custom.box.input, "Enter");
  assert.deepEqual(custom.chosen, ["brand new"]);

  const empty = open({ value: "HX204" });
  empty.box.input.value = "";
  empty.box.input.dispatchEvent({ type: "input" });
  key(empty.box.input, "Enter");
  assert.deepEqual(empty.chosen, [""]);

  const escaped = open({ value: "HX204" });
  const event = key(escaped.box.input, "Escape");
  assert.equal(event._stopped, true, "Escape was not stopped at the combobox");
  assert.equal(escaped.cancelled(), 1);
  assert.deepEqual(escaped.chosen, []);

  const blurred = open({ value: "HX204" });
  blurred.box.input.dispatchEvent({ type: "blur", relatedTarget: blurred.box.list.querySelector("[role='option']") });
  assert.equal(blurred.cancelled(), 0, "a blur into the list closed the search");
  blurred.box.input.dispatchEvent({ type: "blur", relatedTarget: null });
  assert.equal(blurred.cancelled(), 1);
});

test("clicking an option chooses it, and the press before it is prevented so the input keeps focus", () => {
  const { box, chosen } = open({ value: "" });
  const option = box.list.querySelectorAll("[role='option']")[1];
  const press = { type: "mousedown", _defaultPrevented: false, preventDefault() { this._defaultPrevented = true; } };
  for (const handler of option.listeners.mousedown) handler(press);
  assert.equal(press._defaultPrevented, true);
  click(option);
  assert.deepEqual(chosen, [CATALOG[1].resin_code]);
});

test("with no catalog the list says so and still offers what is typed; a throwing catalog is an empty one", () => {
  const none = open({ resins: () => [] });
  assert.equal(none.box.list.querySelector(".slate-combobox__empty").textContent, search.NO_CATALOG);
  none.box.input.value = "ZZ1";
  none.box.input.dispatchEvent({ type: "input" });
  assert.deepEqual(none.box.options().map(one => [one.code, one.custom]), [["ZZ1", true]]);
  const broken = open({ resins: () => { throw new Error("no service"); } });
  assert.equal(broken.box.list.querySelector(".slate-combobox__empty").textContent, search.NO_CATALOG);
});

test("with `before` the combobox stands where the caller says, and is placed before it takes focus", () => {
  const doc = makeDocument();
  const host = doc.createElement("div");
  const first = doc.createElement("span");
  const second = doc.createElement("span");
  host.appendChild(first);
  host.appendChild(second);
  let cancelled = 0;
  const box = search.open(doc, host, { value: "", resins: () => CATALOG, before: second, onChoose() {}, onCancel: () => { cancelled += 1; } });
  assert.ok(host.childNodes[1] === box.element, "the combobox was not placed before the given node");
  assert.equal(box.input.focused, true);
  assert.equal(cancelled, 0);
});
