"use strict";

/* slate/slate-dismiss.js: the shared rule for a press outside an open
 * popover, and the one stack the Android Back key closes from. */

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument, pointer } = require("./tools/slate-test/fake-dom.js");
const dismiss = require("./slate/slate-dismiss.js");

function setup() {
  const doc = makeDocument();
  const box = doc.createElement("div");
  const elsewhere = doc.createElement("div");
  doc.body.appendChild(box);
  doc.body.appendChild(elsewhere);
  let closed = 0;
  const closer = dismiss.outside(doc, box, () => { closed += 1; closer.stop(); });
  return { doc, box, elsewhere, closer, closed: () => closed };
}

test("a mouse closes on the press outside, as Slate always has; a press inside never closes", () => {
  const { box, elsewhere, closer, closed } = setup();
  closer.start();
  pointer("pointerdown", box);
  assert.equal(closed(), 0);
  pointer("pointerdown", elsewhere);
  assert.equal(closed(), 1);
  assert.equal(closer.isOn(), false);
});

test("a finger closes only on a still release outside: a tap closes, a scroll that starts outside does not", () => {
  const { elsewhere, closer, closed } = setup();
  closer.start();
  pointer("pointerdown", elsewhere, { pointerType: "touch", clientX: 10, clientY: 10 });
  assert.equal(closed(), 0, "a finger's press closed before it was a tap");
  pointer("pointerup", elsewhere, { pointerType: "touch", clientX: 10, clientY: 200 });
  assert.equal(closed(), 0, "a scroll closed the popover");
  pointer("pointerdown", elsewhere, { pointerType: "touch", clientX: 10, clientY: 10 });
  pointer("pointercancel", elsewhere, { pointerType: "touch" });
  pointer("pointerup", elsewhere, { pointerType: "touch", clientX: 10, clientY: 10 });
  assert.equal(closed(), 0, "a cancelled gesture closed the popover");
  pointer("pointerdown", elsewhere, { pointerType: "pen", clientX: 10, clientY: 10 });
  pointer("pointerup", elsewhere, { pointerType: "pen", clientX: 13, clientY: 12 });
  assert.equal(closed(), 1, "a tap outside left the popover open");
});

test("while listening a popover is on the stack; Back closes the most recent first and says when nothing is open", () => {
  const order = [];
  const doc = makeDocument();
  const a = dismiss.outside(doc, () => false, () => { order.push("a"); a.stop(); });
  const b = dismiss.outside(doc, () => false, () => { order.push("b"); b.stop(); });
  const before = dismiss.depth();
  a.start();
  b.start();
  assert.equal(dismiss.depth(), before + 2);
  assert.equal(dismiss.dismissTop(), true);
  assert.deepEqual(order, ["b"]);
  a.stop();
  assert.equal(dismiss.depth(), before, "a popover closed another way stayed on the stack");
  const off = dismiss.register(() => order.push("drawer"));
  off();
  assert.equal(dismiss.depth(), before);
  if (before === 0) assert.equal(dismiss.dismissTop(), false);
});
