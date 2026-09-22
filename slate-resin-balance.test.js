"use strict";

/* slate-resin-balance.js: the tool draws the application's own Resin
 * Totals over the running recipe - rows by resin, a foot total, no
 * production/scrap figures of its own, no lots - and its close hands the
 * aside back. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click } = require("./tools/slate-test/fake-dom.js");
const totals = require("./resin-totals.js");
const source = require("./slate/slate-source.js");
const demo = require("./slate/slate-demo.js");
const balance = require("./slate/slate-resin-balance.js");

function resolvedFrom(mutate) {
  const snap = demo.snapshot(5000);
  snap.revision = 3;
  if (mutate) mutate(snap);
  return source.resolveSource({ snapshot: snap });
}

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const backs = [];
  const view = balance.create(doc, { totals: settings.totals === undefined ? totals : settings.totals, back: () => backs.push(true) });
  doc.body.appendChild(view.element);
  return { doc, view, backs };
}

function rows(view) {
  return view.element.querySelectorAll(".slate-balance__row").map(row => [
    row.getAttribute("data-resin"),
    row.querySelector(".slate-balance__lbs").textContent,
    row.querySelector(".slate-balance__share").textContent
  ]);
}

/* ----------------------------------------------------------------------
 *   The input: Slate's model, the running recipe only
 * -------------------------------------------------------------------- */

test("inputsFor reads the running recipe from Slate's model in line order, with the job's pounds as stored, and never the plan", () => {
  const resolved = resolvedFrom(snap => {
    snap.job.prodResinLb = "1,000";
    snap.job.scrapResinLb = 50;
    snap.nextRecipe = { layers: [{ name: "A", layerPct: 100, hoppers: [{ index: 0, pct: 100, resinName: "PLANNED" }] }] };
  });
  const inputs = balance.inputsFor(resolved);
  assert.equal(inputs.prodResinLb, "1,000");
  assert.equal(inputs.scrapResinLb, 50);
  assert.equal(inputs.layers.length, 3);
  assert.deepEqual(inputs.layers.map(layer => layer.layerPct), [25, 50, 25]);
  assert.deepEqual(inputs.layers[0].hoppers.slice(0, 3).map(h => [h.resinName, h.pct]), [["HX204", 60], ["LD105", 30], ["AB120", 10]]);
  assert.equal(inputs.layers[0].hoppers[3].resinName, "");
  assert.ok(!JSON.stringify(inputs).includes("PLANNED"), "the plan leaked into the balance");
  assert.equal(balance.inputsFor(null), null);
  assert.equal(balance.inputsFor({}), null);
});

test("the tool's rows are exactly the application's compute() over those inputs: same keys, same order, same pounds", () => {
  const { view } = boot();
  const resolved = resolvedFrom();
  const result = view.update(resolved);
  const expected = totals.compute(balance.inputsFor(resolved));
  assert.deepEqual(result.rows, expected.rows);
  assert.deepEqual(view.rows().map(row => row.key), expected.rows.map(row => row.key));
  assert.equal(view.element.getAttribute("data-count"), String(expected.rows.length));
  // The demo: 12,400 + 310 = 12,710 lb over three layers; AB120 sits in A and C.
  assert.equal(expected.total, 12710);
  const drawn = rows(view);
  assert.equal(drawn.length, expected.rows.length);
  assert.deepEqual(drawn[0], ["LL318", "4,448 lb", "35%"]);
  const ab120 = drawn.find(row => row[0] === "AB120");
  assert.equal(ab120[1], "953 lb", "AB120 is not gathered across layers, or is rounded up");
  assert.equal(view.element.querySelector(".slate-balance__foot-value").textContent, "12,710 lb");
  assert.ok(!view.element.querySelector(".slate-balance__foot").hasAttribute("hidden"));
  assert.ok(view.element.querySelector(".slate-balance__empty").hasAttribute("hidden"));
});

test("a scanned lot changes nothing here, and no production or scrap figure is drawn", () => {
  const { view } = boot();
  view.update(resolvedFrom(snap => { snap.lots = { LL318: "LOT-77" }; }));
  const textOf = view.element.textContent;
  assert.ok(!/LOT-77/.test(textOf));
  assert.ok(!/12,400|310 lb|Production|Scrap/.test(textOf), "the panel repeats the job's cards");
  assert.equal(view.element.querySelectorAll("input").length, 0, "the panel has a field");
});

/* ----------------------------------------------------------------------
 *   Empty states
 * -------------------------------------------------------------------- */

test("without pounds, without resins, without a line, and without the calculation, the panel says which and draws no rows", () => {
  const { view } = boot();
  const empty = () => view.element.querySelector(".slate-balance__empty");
  view.update(resolvedFrom(snap => { snap.job.prodResinLb = 0; snap.job.scrapResinLb = ""; }));
  assert.equal(empty().textContent, balance.NO_POUNDS);
  assert.ok(!empty().hasAttribute("hidden"));
  assert.equal(rows(view).length, 0);
  assert.ok(view.element.querySelector(".slate-balance__foot").hasAttribute("hidden"));

  view.update(resolvedFrom(snap => { for (const layer of snap.layers) for (const hopper of layer.hoppers) hopper.resinName = ""; }));
  assert.equal(empty().textContent, balance.NO_RESINS);
  assert.equal(view.element.getAttribute("data-count"), "0");

  view.update(null);
  assert.equal(empty().textContent, balance.NO_LINE);

  const { view: without } = boot({ totals: null });
  without.update(resolvedFrom());
  assert.equal(without.element.querySelector(".slate-balance__empty").textContent, balance.UNAVAILABLE);
  assert.equal(rows(without).length, 0);
});

test("a later update replaces the rows in place: a hopper emptied drops its resin and the foot follows", () => {
  const { view } = boot();
  view.update(resolvedFrom());
  const before = rows(view).length;
  view.update(resolvedFrom(snap => { snap.layers[1].hoppers[0].resinName = ""; snap.layers[1].hoppers[0].pct = 0; }));
  const after = rows(view);
  assert.equal(after.length, before - 1);
  assert.ok(!after.some(row => row[0] === "LL318"));
  assert.equal(view.element.querySelector(".slate-balance__foot-value").textContent, "12,710 lb", "the total is the pounds entered, not the rows' sum");
});

/* ----------------------------------------------------------------------
 *   The head
 * -------------------------------------------------------------------- */

test("the close hands the aside back; the panel carries the shared panel chrome and its title", () => {
  const { view, backs } = boot();
  assert.ok(view.element.classList.contains("slate-panel"));
  assert.equal(view.element.querySelector(".slate-panel__title").textContent, balance.TITLE);
  const close = view.element.querySelector("[data-slate-back]");
  assert.equal(close.getAttribute("aria-label"), balance.CLOSE_LABEL);
  click(close);
  assert.deepEqual(backs, [true]);
});

test("formatting: pounds are truncated and grouped, shares to one place, a dash for nothing", () => {
  assert.equal(balance.formatPounds(totals, 4448.9), "4,448 lb");
  assert.equal(balance.formatPounds(totals, 0), "0 lb");
  assert.equal(balance.formatPounds(totals, NaN), "—");
  assert.equal(balance.formatPounds(null, 5), "—");
  assert.equal(balance.formatShare(35, 100), "35%");
  assert.equal(balance.formatShare(1, 3), "33.3%");
  assert.equal(balance.formatShare(5, 0), "");
});
