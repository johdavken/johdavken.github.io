"use strict";

/* slate/slate-drawer-drag.js: the drawer pulled out by its handle and
 * pushed back, as pointer events. */

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument, pointer, click } = require("./tools/slate-test/fake-dom.js");
const dragModule = require("./slate/slate-drawer-drag.js");

const W = 360;

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const handle = doc.createElement("button");
  const drawer = doc.createElement("aside");
  const inside = doc.createElement("button");
  drawer.appendChild(inside);
  doc.body.appendChild(handle);
  doc.body.appendChild(drawer);
  let open = !!settings.open;
  let clock = 0;
  const follows = [];
  const settles = [];
  dragModule.create(doc, {
    handle, drawer,
    enabled: () => settings.enabled !== false,
    isOpen: () => open,
    width: () => W,
    follow: shift => follows.push(shift),
    settle: next => { settles.push(next); open = next; },
    now: () => clock
  });
  const at = (type, node, x, y, extra) => pointer(type, node, Object.assign({ clientX: x, clientY: y === undefined ? 500 : y, pointerType: "touch" }, extra || {}));
  return { doc, handle, drawer, inside, follows, settles, isOpen: () => open, tick: ms => { clock += ms; }, at };
}

test("where a release settles: 40% of the way, pulled or pushed, turns it; less leaves it; a flick either way wins", () => {
  assert.equal(dragModule.settleOpen(W * 0.59, W, 0, false), true, "pulled 41% out it stayed shut");
  assert.equal(dragModule.settleOpen(W * 0.61, W, 0, false), false);
  assert.equal(dragModule.settleOpen(W * 0.41, W, 0, true), false, "pushed 41% in it stayed open");
  assert.equal(dragModule.settleOpen(W * 0.39, W, 0, true), true);
  assert.equal(dragModule.settleOpen(W * 0.9, W, -dragModule.FLICK), true, "a flick left did not open");
  assert.equal(dragModule.settleOpen(0, W, dragModule.FLICK), false, "a flick right did not shut");
});

test("a tap on the handle opens the drawer, once - the click the tap makes is not a second toggle - and the keyboard's click alone toggles too", () => {
  const { handle, settles, at } = boot();
  at("pointerdown", handle, 700);
  at("pointerup", handle, 702);
  click(handle);
  assert.deepEqual(settles, [true]);
  click(handle);
  assert.deepEqual(settles, [true, false], "a keyboard click did not toggle");
});

test("pulled from the handle the drawer follows the finger, clamped to its width, and settles by how far it came", () => {
  const far = boot();
  far.at("pointerdown", far.handle, 700);
  far.tick(100); far.at("pointermove", far.handle, 600);
  far.tick(100); far.at("pointermove", far.handle, 450);
  far.tick(100); far.at("pointermove", far.handle, 440);
  far.tick(100); far.at("pointerup", far.handle, 440);
  assert.deepEqual(far.follows, [260, 110, 100, null]);
  assert.deepEqual(far.settles, [true], "pulled most of the way, it did not open");

  const short = boot();
  short.at("pointerdown", short.handle, 700);
  short.tick(100); short.at("pointermove", short.handle, 650);
  short.tick(100); short.at("pointermove", short.handle, 640);
  short.tick(100); short.at("pointerup", short.handle, 640);
  assert.deepEqual(short.settles, [false], "a short pull opened it");

  const flick = boot();
  flick.at("pointerdown", flick.handle, 700);
  flick.tick(10); flick.at("pointermove", flick.handle, 660);
  flick.tick(10); flick.at("pointermove", flick.handle, 620);
  flick.at("pointerup", flick.handle, 620);
  assert.deepEqual(flick.settles, [true], "a quick flick did not open it");

  const past = boot();
  past.at("pointerdown", past.handle, 700);
  past.tick(100); past.at("pointermove", past.handle, 100);
  assert.equal(past.follows[0], 0, "the drawer was dragged past open");
});

test("the open drawer is pushed back by a sideways swipe to the right; a vertical move or a leftward one is its own, and the click a push releases is spent", () => {
  const push = boot({ open: true });
  push.at("pointerdown", push.inside, 500, 400);
  push.tick(100); push.at("pointermove", push.drawer, 560, 404);
  push.tick(100); push.at("pointermove", push.drawer, 700, 406);
  push.tick(100); push.at("pointerup", push.drawer, 700, 406);
  assert.deepEqual(push.settles, [false]);
  // The drawer spends it in the capture phase, before it reaches the
  // control (the fake DOM has no capture phase, so its listener is called
  // as the browser would call it first).
  const fire = () => { const event = { type: "click", target: push.inside, _stopped: false, stopPropagation() { this._stopped = true; }, preventDefault() {} }; for (const fn of push.drawer.listeners.click || []) fn(event); return event; };
  assert.equal(fire()._stopped, true, "the click a push released would press what was under the finger");
  assert.equal(fire()._stopped, false, "a later click was spent too");

  const scroll = boot({ open: true });
  scroll.at("pointerdown", scroll.inside, 500, 400);
  scroll.at("pointermove", scroll.drawer, 505, 460);
  scroll.at("pointermove", scroll.drawer, 580, 470);
  scroll.at("pointerup", scroll.drawer, 580, 470);
  assert.deepEqual(scroll.settles, [], "a scroll of the drawer pushed it");
  assert.deepEqual(scroll.follows, []);
  const tap = { type: "click", target: scroll.inside, _stopped: false, stopPropagation() { this._stopped = true; }, preventDefault() {} };
  for (const fn of scroll.drawer.listeners.click || []) fn(tap);
  assert.equal(tap._stopped, false, "a tap inside the open drawer was eaten");

  const left = boot({ open: true });
  left.at("pointerdown", left.inside, 500, 400);
  left.at("pointermove", left.drawer, 440, 400);
  assert.deepEqual(left.follows, [], "a leftward swipe moved the open drawer");
});

test("with no drawer (a mouse, a wide screen) the handle and the drawer do nothing; a cancelled drag settles where it was", () => {
  const off = boot({ enabled: false });
  off.at("pointerdown", off.handle, 700);
  off.at("pointermove", off.handle, 400);
  off.at("pointerup", off.handle, 400);
  click(off.handle);
  assert.deepEqual(off.settles, []);
  assert.deepEqual(off.follows, []);

  const cancel = boot();
  cancel.at("pointerdown", cancel.handle, 700);
  cancel.at("pointermove", cancel.handle, 500);
  cancel.at("pointercancel", cancel.handle, 500);
  assert.deepEqual(cancel.settles, [false]);
  assert.equal(cancel.follows[cancel.follows.length - 1], null);
});
