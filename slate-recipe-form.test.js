"use strict";

/* slate-recipe-form.js: one tab of the Recipe section as a form - the
 * fields that stand in for the cells, what Enter and a suggestion do,
 * the blank that clears, H1's preview, a foreign rebase, and the
 * restore on destroy. Built over a body shaped as the section's. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, key } = require("./tools/slate-test/fake-dom.js");
const form = require("./slate/slate-recipe-form.js");
const draft = require("./slate/slate-recipe-draft.js");
const source = require("./slate/slate-source.js");
const demo = require("./slate/slate-demo.js");
const validation = require("./validation.js");

const CATALOG = [{ resin_code: "HX204", density_g_cm3: 0.951 }, { resin_code: "LL318" }, { resin_code: "LD105" }];

function element(doc, name, className, attributes) {
  const node = doc.createElement(name);
  if (className) node.setAttribute("class", className);
  if (attributes) for (const k of Object.keys(attributes)) node.setAttribute(k, attributes[k]);
  return node;
}

/* A body as slate-recipe.js builds one: rows keyed "A:0", each with a
 * resin cell, a blend cell and a note. */
function makeBody(doc, resolved, recipe) {
  const el = element(doc, "div", "slate-recipe__body", { "data-recipe": recipe });
  const rows = new Map();
  const state = source.stateFor(resolved, recipe);
  for (const layer of resolved.line.layers) {
    for (const hopper of layer.hoppers) {
      const k = `${layer.id}:${hopper.index}`;
      const slot = state.hoppers[k] || {};
      const row = element(doc, "div", "slate-hopper", { "data-layer": layer.id, "data-index": String(hopper.index), "data-hopper": hopper.id });
      const id = element(doc, "span", "slate-hopper__id"); id.textContent = hopper.id;
      const resin = element(doc, "button", "slate-hopper__resin"); resin.textContent = slot.resinName || "—";
      const pct = element(doc, "button", "slate-hopper__pct"); pct.textContent = slot.pct ? `${slot.pct}%` : "—";
      const weight = element(doc, "span", "slate-hopper__weight");
      const note = element(doc, "p", "slate-hopper__note", { hidden: "" });
      for (const node of [id, resin, pct, weight, note]) row.appendChild(node);
      rows.set(k, { row, cells: { resin, pct }, note, layer: layer.id, index: hopper.index, hopper: hopper.id, last: null });
      el.appendChild(row);
    }
  }
  doc.body.appendChild(el);
  return { recipe, el, rows };
}

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const resolved = source.resolveSource({ snapshot: demo.snapshot(5000) });
  const body = makeBody(doc, resolved, "current");
  const changes = [];
  let lastCount = 0;
  const view = form.create(doc, body, {
    base: draft.baseFrom(source.stateFor(resolved, "current"), resolved.line),
    model: resolved.line,
    resins: () => CATALOG,
    sameResin: source.sameResin,
    validate: validation.validateHopperPercentages,
    onChange: () => changes.push(view.changes().length),
    onLast: () => { lastCount += 1; }
  });
  return { doc, body, view, changes, last: () => lastCount, row: id => body.el.querySelector(`[data-hopper='${id}']`) };
}

const typed = (input, value) => { input.value = value; input.dispatchEvent({ type: "input" }); };

test("the fields stand in every row's resin and blend cells, seeded with what is shown; H1 has a preview instead of a blend field; the cells are hidden, never rewritten", () => {
  const { body, view, row } = boot();
  assert.ok(body.el.classList.contains("is-drafting"));
  const a1 = row("A1");
  const a2 = row("A2");
  assert.equal(a1.querySelector(".slate-hopper__draft-resin").value, "HX204");
  assert.equal(a1.querySelector(".slate-hopper__draft-pct"), null, "H1 got a blend field");
  assert.equal(a1.querySelector(".slate-hopper__draft-h1").textContent, "60%");
  assert.equal(a2.querySelector(".slate-hopper__draft-resin").value, "LD105");
  assert.equal(a2.querySelector(".slate-hopper__draft-pct").value, "30");
  assert.equal(row("A4").querySelector(".slate-hopper__draft-resin").value, "");
  assert.equal(row("A4").querySelector(".slate-hopper__draft-pct").value, "");
  assert.ok(a2.querySelector(".slate-hopper__resin").hasAttribute("hidden"));
  assert.ok(a2.querySelector(".slate-hopper__pct").hasAttribute("hidden"));
  assert.equal(a2.querySelector(".slate-hopper__resin").textContent, "LD105");
  assert.ok(a2.classList.contains("is-drafting"));
  // Tab order: A1's resin, then A2's resin and blend, and so on.
  const order = view.fields().slice(0, 4).map(field => `${field.key}/${field.kind}`);
  assert.deepEqual(order, ["A:0/resin", "A:1/resin", "A:1/pct", "A:2/resin"]);
  assert.equal(view.changes().length, 0);
});

test("typing moves the draft and tells the section; Enter moves on - resin to blend, blend to the next row, the last field to the section's Apply", () => {
  const { view, changes, row, last, doc } = boot();
  const a2resin = row("A2").querySelector(".slate-hopper__draft-resin");
  const a2pct = row("A2").querySelector(".slate-hopper__draft-pct");
  view.focusFirst();
  assert.ok(doc.activeElement === row("A1").querySelector(".slate-hopper__draft-resin"));
  typed(a2pct, "35");
  assert.deepEqual(changes, [1]);
  assert.deepEqual(view.changes(), [{ layer: "A", index: 1, pct: 35 }]);
  assert.equal(row("A1").querySelector(".slate-hopper__draft-h1").textContent, "55%", "H1's preview did not follow");
  // Enter on a resin field with no list open goes to the blend.
  const enter = key(a2resin, "Enter");
  assert.ok(enter._defaultPrevented);
  assert.ok(doc.activeElement === a2pct);
  key(a2pct, "Enter");
  assert.ok(doc.activeElement === row("A3").querySelector(".slate-hopper__draft-resin"));
  // The last field: the section's.
  const fields = view.fields();
  key(fields[fields.length - 1].input, "Enter");
  assert.equal(last(), 1);
});

test("a suggestion chosen with Enter takes the code into the field, is spent, and moves on; Tab and a blur keep what was typed", () => {
  const { view, row, doc } = boot();
  const a4 = row("A4");
  const resin = a4.querySelector(".slate-hopper__draft-resin");
  const pct = a4.querySelector(".slate-hopper__draft-pct");
  typed(resin, "ll");
  const list = a4.querySelector(".slate-combobox__list");
  assert.ok(list && !list.hasAttribute("hidden"), "typing did not open the list");
  assert.equal(list.querySelector(".is-active").getAttribute("data-resin"), "LL318");
  key(resin, "Enter");
  assert.equal(resin.value, "LL318");
  assert.ok(list.hasAttribute("hidden"));
  assert.ok(doc.activeElement === pct, "Enter on the chosen code did not move to the blend");
  assert.deepEqual(view.changes(), [{ layer: "A", index: 3, resin: "LL318" }]);
  // Typed, then left: the text is the code.
  typed(resin, "brand-new");
  resin.dispatchEvent({ type: "blur", relatedTarget: null });
  assert.equal(resin.value, "brand-new");
  assert.ok(a4.querySelector(".slate-combobox__list").hasAttribute("hidden"));
  assert.deepEqual(view.changes(), [{ layer: "A", index: 3, resin: "brand-new" }]);
  // Escape with the list open closes the list only, and is spent there.
  typed(resin, "hx");
  const escape = key(resin, "Escape");
  assert.ok(escape._stopped, "Escape reached past the open list");
  assert.ok(a4.querySelector(".slate-combobox__list").hasAttribute("hidden"));
  assert.equal(resin.value, "hx");
  const again = key(resin, "Escape");
  assert.ok(!again._stopped, "Escape with the list closed was spent by the field");
});

test("blanking a resin blanks the row's blend with it, so the diff clears the hopper; a blend that is not a number marks its field and the row", () => {
  const { view, row } = boot();
  const a2 = row("A2");
  typed(a2.querySelector(".slate-hopper__draft-resin"), "");
  assert.equal(a2.querySelector(".slate-hopper__draft-pct").value, "");
  assert.deepEqual(view.changes(), [{ layer: "A", index: 1, resin: "", pct: 0 }]);
  assert.equal(row("A1").querySelector(".slate-hopper__draft-h1").textContent, "90%");
  const b2 = row("B2");
  typed(b2.querySelector(".slate-hopper__draft-pct"), "lots");
  assert.equal(b2.querySelector(".slate-hopper__draft-pct").getAttribute("aria-invalid"), "true");
  assert.equal(b2.querySelector(".slate-hopper__note").textContent, draft.NOT_A_NUMBER);
  assert.ok(!b2.querySelector(".slate-hopper__note").hasAttribute("hidden"));
  assert.deepEqual(view.problems(), [{ key: "B:1", message: draft.NOT_A_NUMBER }]);
  assert.equal(row("B1").querySelector(".slate-hopper__draft-h1").textContent, "—");
  // An H1 without a resin previews nothing, whatever the others total.
  typed(row("C1").querySelector(".slate-hopper__draft-resin"), "");
  assert.equal(row("C1").querySelector(".slate-hopper__draft-h1").textContent, "—");
  typed(row("C1").querySelector(".slate-hopper__draft-resin"), "EVA340");
  assert.equal(row("C1").querySelector(".slate-hopper__draft-h1").textContent, "80%");
  typed(b2.querySelector(".slate-hopper__draft-pct"), "95");
  assert.equal(b2.querySelector(".slate-hopper__draft-pct").getAttribute("aria-invalid"), null);
  assert.ok(b2.querySelector(".slate-hopper__note").hasAttribute("hidden"));
  assert.ok(row("B1").querySelector(".slate-hopper__draft-h1").classList.contains("is-over"));
  assert.equal(view.totals().find(total => total.layer === "B").ok, false);
});

test("a rebase keeps the field's text, marks the row and moves the diff under it; the mark and note go with the form", () => {
  const { view, row, body } = boot();
  const a2 = row("A2");
  typed(a2.querySelector(".slate-hopper__draft-resin"), "LL318");
  view.rebase("A:1", { resinName: "LL318", pct: 30 });
  assert.equal(a2.querySelector(".slate-hopper__draft-resin").value, "LL318");
  assert.ok(a2.classList.contains("is-changed-underneath"));
  assert.match(a2.querySelector(".slate-hopper__note").textContent, /^A2 changed in the application/);
  assert.deepEqual(view.changes(), [], "a foreign change matching the draft still counted");
  view.rebase("A:1", { resinName: "HD622", pct: 30 });
  assert.deepEqual(view.changes(), [{ layer: "A", index: 1, resin: "LL318" }]);
  view.destroy();
  assert.ok(view.isDestroyed());
  assert.ok(!a2.classList.contains("is-changed-underneath"));
  assert.ok(!a2.classList.contains("is-drafting"));
  assert.ok(a2.querySelector(".slate-hopper__note").hasAttribute("hidden"));
  assert.equal(a2.querySelector(".slate-hopper__draft-resin"), null);
  assert.equal(a2.querySelector(".slate-hopper__draft-pct"), null);
  assert.equal(row("A1").querySelector(".slate-hopper__draft-h1"), null);
  assert.ok(!a2.querySelector(".slate-hopper__resin").hasAttribute("hidden"));
  assert.ok(!a2.querySelector(".slate-hopper__pct").hasAttribute("hidden"));
  assert.ok(!body.el.classList.contains("is-drafting"));
  assert.equal(view.fields().length, 0);
});

test("the selection: pick toggles a row, a Shift run fills the layer between the anchor and it, pickLayer takes or drops a whole layer, and a fill writes the picked rows' fields", () => {
  const { view, row, changes } = boot();
  const picks = [];
  view.pick("A:1");
  assert.deepEqual(view.picked(), ["A:1"]);
  assert.ok(row("A2").classList.contains("is-picked"));
  view.pick("A:4", { range: true });
  assert.deepEqual(view.picked().sort(), ["A:1", "A:2", "A:3", "A:4"]);
  view.pick("A:1");
  assert.deepEqual(view.picked().sort(), ["A:2", "A:3", "A:4"]);
  assert.ok(!row("A2").classList.contains("is-picked"));
  // A run across layers is a plain pick; a run with no anchor likewise.
  view.pick("B:1", { range: true });
  assert.ok(view.picked().includes("B:1"));
  view.pickLayer("C");
  assert.deepEqual(view.picked().filter(key => key[0] === "C").sort(), ["C:0", "C:1", "C:2", "C:3", "C:4", "C:5"]);
  view.pickLayer("C");
  assert.equal(view.picked().filter(key => key[0] === "C").length, 0);
  view.pick("Z:9");
  assert.equal(view.picked().length, 4);
  // The fill: fields and draft move together; the selection stays.
  const before = changes.length;
  assert.equal(view.fill({ resin: "HX204", pct: "" }), 4);
  assert.equal(row("A3").querySelector(".slate-hopper__draft-resin").value, "HX204");
  assert.equal(row("B2").querySelector(".slate-hopper__draft-resin").value, "HX204");
  assert.equal(row("A3").querySelector(".slate-hopper__draft-pct").value, "10");
  assert.equal(changes.length, before + 1, "a fill did not tell the section once");
  assert.equal(view.picked().length, 4);
  assert.equal(view.fill({ resin: "", pct: "5" }), 4);
  assert.equal(row("A5").querySelector(".slate-hopper__draft-pct").value, "5");
  assert.equal(row("A1").querySelector(".slate-hopper__draft-h1").textContent, "55%");
  assert.equal(view.fill({ resin: "", pct: "" }), 0);
  view.clearPicked();
  assert.deepEqual(view.picked(), []);
  assert.ok(!row("A3").classList.contains("is-picked"));
  view.pick("A:2");
  view.destroy();
  assert.ok(!row("A3").classList.contains("is-picked"));
  assert.deepEqual(view.picked(), []);
  view.pick("A:2");
  assert.deepEqual(view.picked(), [], "a destroyed form still picks");
});
