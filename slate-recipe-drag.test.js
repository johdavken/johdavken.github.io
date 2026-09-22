"use strict";

/* slate-recipe-drag.js: a badge lifted onto another row, as pointer events. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, pointer, click } = require("./tools/slate-test/fake-dom.js");
const drag = require("./slate/slate-recipe-drag.js");

function row(doc, layer, index, options) {
  const el = doc.createElement("div");
  el.setAttribute("class", "slate-hopper");
  el.setAttribute("data-layer", layer);
  el.setAttribute("data-index", String(index));
  el.setAttribute("data-hopper", `${layer}${index + 1}`);
  if (options && options.empty) el.classList.add("is-empty");
  el._rect = { left: 0, top: 40 * index, width: 400, height: 36 };
  const handle = doc.createElement("span");
  handle.setAttribute("data-slate-handle", "");
  handle.textContent = `${layer}${index + 1}`;
  el.appendChild(handle);
  const button = doc.createElement("button");
  button.setAttribute("class", "slate-hopper__resin");
  el.appendChild(button);
  return el;
}

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const mount = doc.createElement("div");
  const list = doc.createElement("div");
  list.setAttribute("class", "slate-recipe__layers");
  mount.appendChild(list);
  doc.body.appendChild(mount);
  const rows = [row(doc, "A", 0), row(doc, "A", 1), row(doc, "A", 2, { empty: true }), row(doc, "B", 0)];
  rows[3]._rect = { left: 0, top: 200, width: 400, height: 36 };
  for (const one of rows) list.appendChild(one);
  // What is under the pointer: rows by their y band.
  doc._elementAt = (x, y) => rows.find(one => y >= one._rect.top && y < one._rect.top + one._rect.height) || null;
  const drops = [];
  let able = settings.able !== false;
  const handle = drag.create(doc, {
    list, mount, view: doc,
    able: () => able,
    values: el => ({ id: el.getAttribute("data-hopper"), resin: "HX204", pct: "60%" }),
    onDrop: request => drops.push(request)
  });
  return { doc, mount, list, rows, drops, handle, setAble: value => { able = value; } };
}

const handleOf = el => el.querySelector("[data-slate-handle]");

test("a press and release below the threshold is no drag: nothing marked, nothing dropped, the click still lands", () => {
  const { rows, drops, handle, list } = boot();
  pointer("pointerdown", handleOf(rows[0]), { clientX: 10, clientY: 10 });
  pointer("pointermove", handleOf(rows[0]), { clientX: 12, clientY: 12 });
  assert.equal(handle.active(), false);
  assert.ok(!rows[0].classList.contains("is-dragging"));
  pointer("pointerup", handleOf(rows[0]), { clientX: 12, clientY: 12 });
  assert.deepEqual(drops, []);
  assert.equal(handle.consumeClick(), false, "a press without a drag swallowed the click");
  assert.ok(!list.classList.contains("is-moving"));
});

test("past the threshold a proxy of the lifted values follows the pointer, the origin dims, the row underneath is marked, and release drops once", () => {
  const { mount, rows, drops, handle, list } = boot();
  pointer("pointerdown", handleOf(rows[0]), { clientX: 10, clientY: 10 });
  pointer("pointermove", handleOf(rows[0]), { clientX: 10, clientY: 30 });
  assert.equal(handle.active(), true);
  assert.equal(handleOf(rows[0]).captured, 1, "the handle did not take pointer capture");
  const proxy = mount.querySelector(".slate-drag-proxy");
  assert.ok(proxy, "no proxy was mounted");
  assert.equal(proxy.querySelector(".slate-drag-proxy__id").textContent, "A1");
  assert.equal(proxy.querySelector(".slate-drag-proxy__resin").textContent, "HX204");
  assert.equal(proxy.style.width, "400px");
  assert.ok(rows[0].classList.contains("is-dragging"));
  assert.ok(list.classList.contains("is-moving"));
  // Over the origin itself: no target.
  assert.equal(handle.target(), null);
  pointer("pointermove", handleOf(rows[0]), { clientX: 10, clientY: 50 });
  assert.ok(rows[1].classList.contains("is-drop-target"));
  assert.ok(handle.target() === rows[1]);
  pointer("pointermove", handleOf(rows[0]), { clientX: 10, clientY: 210 });
  assert.ok(!rows[1].classList.contains("is-drop-target"), "the old target kept its mark");
  assert.ok(rows[3].classList.contains("is-drop-target"));
  pointer("pointerup", handleOf(rows[0]), { clientX: 10, clientY: 210 });
  assert.deepEqual(drops, [{ from: { layer: "A", index: 0, key: "A:0" }, to: { layer: "B", index: 0, key: "B:0" } }]);
  assert.equal(handle.active(), false);
  assert.equal(mount.querySelector(".slate-drag-proxy"), null, "the proxy was left behind");
  assert.ok(!rows[0].classList.contains("is-dragging"));
  assert.ok(!rows[3].classList.contains("is-drop-target"));
  assert.ok(!list.classList.contains("is-moving"));
  assert.equal(handleOf(rows[0]).captured, null);
  // The click the release produces is swallowed exactly once.
  assert.equal(handle.consumeClick(), true);
  assert.equal(handle.consumeClick(), false);
});

test("release off any row, on the origin, or after Escape drops nothing", () => {
  const off = boot();
  pointer("pointerdown", handleOf(off.rows[0]), { clientX: 10, clientY: 10 });
  pointer("pointermove", handleOf(off.rows[0]), { clientX: 10, clientY: 30 });
  pointer("pointermove", handleOf(off.rows[0]), { clientX: 10, clientY: 900 });
  pointer("pointerup", handleOf(off.rows[0]), { clientX: 10, clientY: 900 });
  assert.deepEqual(off.drops, []);
  assert.equal(off.handle.consumeClick(), true, "a drag that dropped nowhere let the click through");

  const origin = boot();
  pointer("pointerdown", handleOf(origin.rows[1]), { clientX: 10, clientY: 50 });
  pointer("pointermove", handleOf(origin.rows[1]), { clientX: 10, clientY: 70 });
  pointer("pointermove", handleOf(origin.rows[1]), { clientX: 10, clientY: 45 });
  pointer("pointerup", handleOf(origin.rows[1]), { clientX: 10, clientY: 45 });
  assert.deepEqual(origin.drops, []);

  const escaped = boot();
  pointer("pointerdown", handleOf(escaped.rows[0]), { clientX: 10, clientY: 10 });
  pointer("pointermove", handleOf(escaped.rows[0]), { clientX: 10, clientY: 50 });
  assert.equal((escaped.doc.listeners.keydown || []).length, 1, "no Escape listener while dragging");
  const event = { type: "keydown", key: "Escape", _stopped: false, stopPropagation() { this._stopped = true; } };
  escaped.doc.listeners.keydown[0](event);
  assert.equal(event._stopped, true);
  assert.equal(escaped.handle.active(), false);
  assert.equal((escaped.doc.listeners.keydown || []).length, 0, "the Escape listener outlived the drag");
  pointer("pointerup", handleOf(escaped.rows[0]), { clientX: 10, clientY: 50 });
  assert.deepEqual(escaped.drops, []);
});

test("no press from the right button, a touch, an empty row, an unable state, a second pointer, or a control inside the row", () => {
  const { rows, handle, setAble } = boot();
  pointer("pointerdown", handleOf(rows[0]), { clientX: 10, clientY: 10, button: 2 });
  pointer("pointermove", handleOf(rows[0]), { clientX: 10, clientY: 50 });
  assert.equal(handle.active(), false, "the right button lifted");
  pointer("pointerup", handleOf(rows[0]), { clientX: 10, clientY: 50, button: 2 });

  pointer("pointerdown", handleOf(rows[0]), { clientX: 10, clientY: 10, pointerType: "touch" });
  pointer("pointermove", handleOf(rows[0]), { clientX: 10, clientY: 50, pointerType: "touch" });
  assert.equal(handle.active(), false, "a touch lifted");
  pointer("pointerup", handleOf(rows[0]), { clientX: 10, clientY: 50, pointerType: "touch" });

  pointer("pointerdown", handleOf(rows[2]), { clientX: 10, clientY: 90 });
  pointer("pointermove", handleOf(rows[2]), { clientX: 10, clientY: 130 });
  assert.equal(handle.active(), false, "an empty row lifted");
  pointer("pointerup", handleOf(rows[2]), { clientX: 10, clientY: 130 });

  setAble(false);
  pointer("pointerdown", handleOf(rows[0]), { clientX: 10, clientY: 10 });
  pointer("pointermove", handleOf(rows[0]), { clientX: 10, clientY: 50 });
  assert.equal(handle.active(), false, "an unable state lifted");
  pointer("pointerup", handleOf(rows[0]), { clientX: 10, clientY: 50 });
  setAble(true);

  pointer("pointerdown", rows[0].querySelector(".slate-hopper__resin"), { clientX: 10, clientY: 10 });
  pointer("pointermove", rows[0].querySelector(".slate-hopper__resin"), { clientX: 10, clientY: 50 });
  assert.equal(handle.active(), false, "a press on the resin cell lifted");
  pointer("pointerup", rows[0].querySelector(".slate-hopper__resin"), { clientX: 10, clientY: 50 });

  pointer("pointerdown", handleOf(rows[0]), { clientX: 10, clientY: 10, pointerId: 1 });
  pointer("pointermove", handleOf(rows[0]), { clientX: 10, clientY: 50, pointerId: 2 });
  assert.equal(handle.active(), false, "another pointer moved the drag");
  pointer("pointerup", handleOf(rows[0]), { clientX: 10, clientY: 10, pointerId: 1 });
  assert.equal(handle.consumeClick(), false);
});

test("cancel() from outside and a lost capture on a replaced row both end the drag cleanly", () => {
  const first = boot();
  pointer("pointerdown", handleOf(first.rows[0]), { clientX: 10, clientY: 10 });
  pointer("pointermove", handleOf(first.rows[0]), { clientX: 10, clientY: 50 });
  first.handle.cancel();
  assert.equal(first.handle.active(), false);
  assert.equal(first.mount.querySelector(".slate-drag-proxy"), null);
  assert.ok(!first.rows[1].classList.contains("is-drop-target"));
  pointer("pointerup", handleOf(first.rows[0]), { clientX: 10, clientY: 50 });
  assert.deepEqual(first.drops, []);

  const second = boot();
  pointer("pointerdown", handleOf(second.rows[0]), { clientX: 10, clientY: 10 });
  pointer("pointermove", handleOf(second.rows[0]), { clientX: 10, clientY: 50 });
  // A structural render replaced the rows.
  second.list.removeChild(second.rows[0]);
  second.list.dispatchEvent({ type: "lostpointercapture", pointerId: 1 });
  assert.equal(second.handle.active(), false);
  assert.equal(second.mount.querySelector(".slate-drag-proxy"), null);
});

test("the click after a drag is the section's to swallow: a plain click is not", () => {
  const { rows, handle } = boot();
  click(rows[0].querySelector(".slate-hopper__resin"));
  assert.equal(handle.consumeClick(), false);
  pointer("pointerdown", handleOf(rows[0]), { clientX: 10, clientY: 10 });
  pointer("pointermove", handleOf(rows[0]), { clientX: 10, clientY: 50 });
  pointer("pointerup", handleOf(rows[0]), { clientX: 10, clientY: 50 });
  assert.equal(handle.consumeClick(), true);
  // A swallow nobody consumed does not outlive the next press.
  pointer("pointerdown", handleOf(rows[0]), { clientX: 10, clientY: 10 });
  pointer("pointermove", handleOf(rows[0]), { clientX: 10, clientY: 50 });
  pointer("pointerup", handleOf(rows[0]), { clientX: 10, clientY: 50 });
  pointer("pointerdown", handleOf(rows[1]), { clientX: 10, clientY: 50 });
  pointer("pointerup", handleOf(rows[1]), { clientX: 10, clientY: 50 });
  assert.equal(handle.consumeClick(), false, "a stale swallow ate the next click");
  assert.deepEqual(drag.positionOf(rows[3]), { layer: "B", index: 0, key: "B:0" });
  assert.equal(drag.THRESHOLD, 6);
});
