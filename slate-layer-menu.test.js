"use strict";

/* slate-layer-menu.js and slate-print.js: the layer head's menu, and the
 * print sheet's request from a resolved source. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click, key, makeTimers } = require("./tools/slate-test/fake-dom.js");
const menuModule = require("./slate/slate-layer-menu.js");
const printModule = require("./slate/slate-print.js");
const source = require("./slate/slate-source.js");
const demo = require("./slate/slate-demo.js");

function bootMenu(options) {
  const settings = options || {};
  const doc = makeDocument();
  const timers = makeTimers();
  const copies = [];
  let clears = 0;
  const said = [];
  const menu = menuModule.create(doc, {
    layer: "A", others: ["A", "B", "C"], timers, say: message => said.push(message),
    able: () => settings.able || { copy: true, clear: true },
    reason: action => `${action} is off`,
    onCopyTo: id => copies.push(id),
    onClear: () => { clears += 1; }
  });
  doc.body.appendChild(menu.element);
  return { doc, timers, menu, copies, clears: () => clears, said };
}

test("the menu lists a copy per other layer and the clear; it opens on its button and closes on Escape or an outside press", () => {
  const { doc, menu } = bootMenu();
  assert.equal(menu.button.getAttribute("aria-haspopup"), "menu");
  assert.deepEqual(menu.list.querySelectorAll("[role='menuitem']").map(item => item.textContent), ["Copy to layer B", "Copy to layer C", menuModule.CLEAR_LABEL]);
  assert.ok(menu.list.hasAttribute("hidden"));
  click(menu.button);
  assert.equal(menu.isOpen(), true);
  assert.equal(menu.button.getAttribute("aria-expanded"), "true");
  assert.equal((doc.listeners.pointerdown || []).length, 1);
  const escape = key(menu.list, "Escape");
  assert.equal(escape._stopped, true);
  assert.equal(menu.isOpen(), false);
  assert.equal((doc.listeners.pointerdown || []).length, 0);
  click(menu.button);
  const elsewhere = doc.createElement("div");
  doc.body.appendChild(elsewhere);
  doc.listeners.pointerdown[0]({ target: elsewhere });
  assert.equal(menu.isOpen(), false);
});

test("copy chooses and closes; clear arms, times out, and clears on the second choice", () => {
  const { menu, timers, copies, clears } = bootMenu();
  click(menu.button);
  click(menu.list.querySelector("[data-menu-copy='C']"));
  assert.deepEqual(copies, ["C"]);
  assert.equal(menu.isOpen(), false);

  click(menu.button);
  const clear = menu.list.querySelector("[data-menu-clear]");
  click(clear);
  assert.equal(menu.isArmed(), true);
  assert.equal(clear.textContent, menuModule.CLEAR_ARMED_LABEL);
  assert.equal(clears(), 0);
  timers.advance(menuModule.ARM_MS);
  assert.equal(menu.isArmed(), false);
  assert.equal(clear.textContent, menuModule.CLEAR_LABEL);

  click(clear);
  click(clear);
  assert.equal(clears(), 1);
  assert.equal(menu.isOpen(), false);
  assert.equal(timers.pending(), 0, "an arm timer was left running");

  // Closing while armed disarms.
  click(menu.button);
  click(clear);
  menu.close();
  assert.equal(menu.isArmed(), false);
});

test("an unable item is marked, explains on a choice, and does nothing", () => {
  const { menu, copies, clears, said } = bootMenu({ able: { copy: false, clear: false } });
  click(menu.button);
  const items = menu.list.querySelectorAll("[role='menuitem']");
  assert.ok(items.every(item => item.getAttribute("aria-disabled") === "true"));
  assert.match(items[0].getAttribute("title"), /copy is off/);
  click(items[0]);
  click(items[2]);
  assert.deepEqual(copies, []);
  assert.equal(clears(), 0);
  assert.equal(said.length, 2);
  assert.match(said[1], /Clear layer is unavailable: clear is off/);
  assert.equal(menu.isOpen(), true);
});

/* ----------------------------------------------------------------------
 *   Print
 * -------------------------------------------------------------------- */

function resolvedWith(mutate) {
  const snap = demo.snapshot(5000);
  snap.revision = 3;
  if (mutate) mutate(snap);
  return source.resolveSource({ snapshot: snap });
}

function planned() {
  return resolvedWith(snap => {
    snap.nextRecipe = { layers: snap.layers.map(layer => ({ name: layer.name, layerPct: layer.layerPct, hoppers: layer.hoppers.map(h => ({ index: h.index, pct: h.pct, resinName: h.resinName })) })) };
    snap.nextRecipe.layers[0].hoppers[0].resinName = "ZZ1";
  });
}

test("layersFor gives the sheet the rows as shown - the line's hoppers, shares and blends, nothing runtime - and null for an absent plan", () => {
  const current = printModule.layersFor(resolvedWith(), "current");
  assert.deepEqual(current.map(layer => [layer.name, layer.layerPct, layer.hoppers.length]), [["A", 25, 6], ["B", 50, 4], ["C", 25, 6]]);
  assert.deepEqual(current[0].hoppers[0], { resinName: "HX204", pct: 60 });
  assert.deepEqual(Object.keys(current[0].hoppers[0]), ["resinName", "pct"]);
  assert.equal(printModule.layersFor(resolvedWith(), "next"), null);
  assert.equal(printModule.layersFor(planned(), "next")[0].hoppers[0].resinName, "ZZ1");
  assert.deepEqual(printModule.lineFor(resolvedWith()), { displayName: "Line 5 (demo)", layerCount: 3, hopperNamingMode: "standard" });
  assert.equal(printModule.available("current", resolvedWith()), true);
  assert.equal(printModule.available("next", resolvedWith()), false);
  assert.equal(printModule.available("both", resolvedWith()), true);
  assert.equal(printModule.available("next", planned()), true);
  assert.equal(printModule.available("current", resolvedWith(snap => { for (const layer of snap.layers) for (const h of layer.hoppers) h.resinName = ""; })), false);
  assert.equal(printModule.available("current", null), false);
});

test("print builds the floor UI's sheet into a Slate-classed frame under the mount, replaced per print, and refuses a plan that is not there", () => {
  const doc = makeDocument();
  const mount = doc.createElement("div");
  doc.body.appendChild(mount);
  const requests = [];
  const printer = printModule.create(doc, { mount });
  assert.ok(printer, "no printer without a sheet module");

  const nothing = printer.print("next", resolvedWith());
  assert.equal(nothing.ok, false);
  assert.equal(nothing.code, "nothing_planned");
  assert.equal(mount.querySelector("iframe"), null, "a refused print opened a frame");

  const one = printer.print("current", resolvedWith());
  assert.equal(one.ok, true);
  assert.deepEqual(one.pages, ["current"]);
  const frame = mount.querySelector("iframe");
  assert.ok(frame && frame.classList.contains("slate-print__frame"), "the frame is not Slate's");
  assert.equal(frame.getAttribute("aria-hidden"), "true");
  assert.equal(frame.contentWindow.prints, 1, "the frame was not printed");
  assert.ok(frame.contentDocument.body.querySelector("[data-role='print-sheet']"), "the sheet was not built into the frame");

  const both = printer.print("both", planned());
  assert.deepEqual(both.pages, ["current", "next"]);
  assert.equal(mount.querySelectorAll("iframe").length, 1, "the previous frame was not replaced");
  assert.ok(mount.querySelector("iframe") !== frame);
  assert.equal(printer.print("nonsense", planned()).code, "invalid");
  printer.dispose();
  assert.equal(mount.querySelector("iframe"), null);
  void requests;
});

test("a sheet module handed in is the one used, with the request shape the sheet takes", () => {
  const doc = makeDocument();
  const mount = doc.createElement("div");
  const seen = [];
  const sheet = { create: () => ({ print(request) { seen.push(request); return { ok: true, which: request.which, pages: [request.which] }; }, frame: () => null, dispose() {} }) };
  const printer = printModule.create(doc, { mount, sheet });
  printer.print("next", planned());
  assert.equal(seen.length, 1);
  assert.deepEqual(Object.keys(seen[0]).sort(), ["current", "line", "next", "which"]);
  assert.equal(seen[0].which, "next");
  assert.equal(seen[0].next[0].hoppers[0].resinName, "ZZ1");
  assert.equal(seen[0].line.layerCount, 3);
  assert.equal(printModule.create(doc, { mount, sheet: null }) === null, false, "the shared module is the default");
  assert.equal(printModule.create(doc, {}), null);
});

test("the layer card never clips its menu: the Left layout's card is not overflow-hidden, and its head rounds its own corners", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "slate/styles/components/recipe.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const card = css.match(/\n\.slate-layer \{([^}]*)\}/);
  assert.ok(card, "the .slate-layer rule is missing");
  assert.doesNotMatch(card[1], /overflow:\s*hidden/, "an overflow-hidden card clips the ⋯ menu in the Left layout");
  const head = css.match(/\n\.slate-layer__head \{([^}]*)\}/);
  assert.match(head[1], /border-top-left-radius: var\(--slate-radius-lg\)/);
  assert.match(head[1], /border-bottom-left-radius: var\(--slate-radius-lg\)/);
  assert.match(css, /\.slate-root\[data-layers="top"\] \.slate-layer__head \{[^}]*border-bottom-left-radius: 0;/, "the Top head must square its bottom-left corner: it sits above the rows, not beside them");
});
