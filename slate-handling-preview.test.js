"use strict";

/* slate-handling-preview.js: the chosen drag style, played in Settings -
 * the drag's own proxy and card carried onto a Grid cell and home, on a
 * loop that runs only while Settings shows and starts over on a new
 * choice. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { makeDocument, makeTimers, click } = require("./tools/slate-test/fake-dom.js");
const preview = require("./slate/slate-handling-preview.js");
const settings = require("./slate/slate-settings.js");
const display = require("./slate-display.js");

function node() {
  return { attributes: {}, setAttribute(key, value) { this.attributes[key] = String(value); }, getAttribute(key) { return this.attributes[key] ?? null; } };
}

function storage() {
  const store = {};
  return { getItem: key => store[key] ?? null, setItem(key, value) { store[key] = String(value); } };
}

test("the stage is the drag's own parts: a proxy holding a card laid out as the drag's, and a Grid cell with no hopper id", () => {
  const doc = makeDocument();
  const view = preview.create(doc, { timers: makeTimers() });
  const stage = view.element;
  assert.equal(stage.getAttribute("aria-hidden"), "true");
  const carry = stage.querySelector(".slate-drag-proxy");
  assert.ok(carry && carry.classList.contains("slate-handling-preview__carry"));
  const card = carry.querySelector(".slate-drag-proxy__card");
  assert.ok(card === view.card());
  assert.deepEqual(card.children.map(one => one.getAttribute("class")), ["slate-drag-proxy__id", "slate-drag-proxy__pct", "slate-drag-proxy__resin"]);
  const cell = stage.querySelector(".slate-hopper");
  assert.equal(cell.getAttribute("data-recipe"), "preview", "the cell is not a Grid cell the drag's sheet can mark");
  assert.equal(cell.getAttribute("data-hopper"), null, "the preview's cell would be found as a hopper");
  assert.equal(view.running(), false);
});

test("a pass: carried onto the cell leaning the way it goes, resting there over it, carried home leaning back, then lifted anew", () => {
  const doc = makeDocument();
  const timers = makeTimers();
  const view = preview.create(doc, { timers });
  const carry = view.element.querySelector(".slate-drag-proxy");
  const sway = () => view.card().style.getPropertyValue("--slate-drag-sway");
  view.start();
  const first = view.card();
  assert.equal(carry.style.transform, "translate(0px, 0)");
  timers.advance(700);
  assert.equal(carry.style.transform, `translate(${preview.DISTANCE}px, 0)`);
  assert.equal(sway(), `${preview.SWAY}deg`, "carried right, it did not lean right");
  timers.advance(500);
  assert.equal(sway(), "0deg");
  timers.advance(100);
  assert.ok(view.card().classList.contains("is-over"));
  assert.ok(view.cell().classList.contains("is-drop-target"));
  timers.advance(1300);
  assert.equal(carry.style.transform, "translate(0px, 0)");
  assert.equal(sway(), `-${preview.SWAY}deg`, "carried home, it did not lean back");
  assert.ok(!view.cell().classList.contains("is-drop-target"));
  timers.advance(1000);
  assert.ok(view.card() !== first, "the next pass did not lift a new card, so its entrance would not play");
  assert.equal(first.parentNode, null, "the old card was left on the stage");
  view.stop();
  assert.equal(timers.pending(), 0, "stop left the loop's timers behind");
});

test("stop settles the stage; replay starts a running pass from the lift, and a stopped one only lifts a new card", () => {
  const timers = makeTimers();
  const view = preview.create(makeDocument(), { timers });
  view.start();
  timers.advance(1400);
  view.stop();
  assert.equal(view.running(), false);
  assert.ok(!view.cell().classList.contains("is-drop-target"));
  assert.equal(view.element.querySelector(".slate-drag-proxy").style.transform, "translate(0px, 0)");
  const stopped = view.card();
  view.replay();
  assert.ok(view.card() !== stopped);
  assert.equal(timers.pending(), 0, "a replay while stopped started the loop");
  view.start();
  timers.advance(900);
  const mid = view.card();
  view.replay();
  assert.ok(view.card() !== mid);
  assert.equal(view.element.querySelector(".slate-drag-proxy").style.transform, "translate(0px, 0)", "a replay did not start from home");
  view.stop();
});

test("in Settings it stands under the Handling choices, plays while Settings shows, stops when it is left, and a new choice replays it", () => {
  const doc = makeDocument();
  const timers = makeTimers();
  const controller = display.create(node(), storage());
  const view = settings.create(doc, { theme: null, themes: [], display: controller, timers });
  const group = view.element.querySelector(".slate-settings__group[aria-label='Handling']");
  const stage = group.querySelector(".slate-handling-preview");
  assert.ok(stage, "no preview in the Handling group");
  assert.ok(view.preview().element === stage);
  assert.equal(view.preview().running(), false, "the preview runs before Settings shows");
  view.onShow();
  assert.equal(view.preview().running(), true);
  const before = view.preview().card();
  click(view.handling("neon"));
  assert.ok(view.preview().card() !== before, "a new choice did not replay the preview");
  const again = view.preview().card();
  controller.setTrackingMode("manual");
  assert.ok(view.preview().card() === again, "another preference replayed the preview");
  view.onHide();
  assert.equal(view.preview().running(), false);
  assert.equal(timers.pending(), 0, "leaving Settings left the loop running");
});

test("the stage's sheet: the proxy stands on the stage, is carried by a transition that reduced motion drops, and the card and cell are the drag's sheet's", () => {
  const css = fs.readFileSync(path.join(__dirname, "slate", "styles", "components", "settings.css"), "utf8");
  const rule = selector => { const at = css.indexOf(`${selector} {`); assert.ok(at > -1, `no rule for ${selector}`); return css.slice(at, css.indexOf("}", at)); };
  assert.match(rule(".slate-root .slate-handling-preview__carry"), /position: absolute;[\s\S]*transition: transform/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.slate-root \.slate-handling-preview__carry \{\s*transition: none;/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /slate-handling-preview[^{]*drag-motion/, "the stage names a handling: the drag's sheet should style it");
});
