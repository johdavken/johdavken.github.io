"use strict";

/* slate/slate-phone-drawer.js: a phone's grip at the foot, and the sheet it
 * slides up and a swipe pushes back down, as pointer events. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeDocument, pointer, click } = require("./tools/slate-test/fake-dom.js");
const drawerModule = require("./slate/slate-phone-drawer.js");

const H = 400;

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const sheet = doc.createElement("nav");
  const inside = doc.createElement("button");
  sheet.appendChild(inside);
  doc.body.appendChild(sheet);
  let open = !!settings.open;
  let clock = 0;
  const follows = [];
  const settles = [];
  const drawer = drawerModule.create(doc, {
    sheet,
    enabled: () => settings.enabled !== false,
    isOpen: () => open,
    height: () => H,
    follow: shift => follows.push(shift),
    settle: next => { settles.push(next); open = next; },
    now: () => clock
  });
  doc.body.appendChild(drawer.element);
  const at = (type, node, y, x, extra) => pointer(type, node, Object.assign({ clientX: x === undefined ? 200 : x, clientY: y, pointerType: "touch" }, extra || {}));
  return { doc, grip: drawer.element, drawer, sheet, inside, follows, settles, isOpen: () => open, tick: ms => { clock += ms; }, at };
}

test("the grip is one labelled button - a grab line, the word Menu and a hidden dot - that says its sheet is shut", () => {
  const { grip } = boot();
  assert.equal(grip.tagName, "BUTTON");
  assert.equal(grip.getAttribute("type"), "button");
  assert.equal(grip.getAttribute("aria-label"), "Menu");
  assert.equal(grip.getAttribute("aria-haspopup"), "dialog");
  assert.equal(grip.getAttribute("aria-expanded"), "false");
  assert.ok(grip.querySelector(".slate-grip__bar"));
  assert.equal(grip.querySelector(".slate-grip__label").textContent, "Menu");
  assert.ok(grip.querySelector(".slate-grip__dot").hasAttribute("hidden"));
});

test("where a release settles: 30% of the way, raised or pushed, turns it; less leaves it; a flick either way wins", () => {
  assert.equal(drawerModule.settleOpen(H * 0.69, H, 0, false), true, "raised 31% it stayed shut");
  assert.equal(drawerModule.settleOpen(H * 0.71, H, 0, false), false);
  assert.equal(drawerModule.settleOpen(H * 0.31, H, 0, true), false, "pushed 31% down it stayed open");
  assert.equal(drawerModule.settleOpen(H * 0.29, H, 0, true), true);
  assert.equal(drawerModule.settleOpen(H * 0.9, H, -drawerModule.FLICK, false), true, "a flick up did not open");
  assert.equal(drawerModule.settleOpen(0, H, drawerModule.FLICK, true), false, "a flick down did not shut");
});

test("a tap on the grip opens the sheet, once - the click the tap makes is not a second toggle - and the keyboard's click alone toggles too", () => {
  const { grip, settles, at } = boot();
  at("pointerdown", grip, 700);
  at("pointerup", grip, 701);
  click(grip);
  assert.deepEqual(settles, [true]);
  click(grip);
  assert.deepEqual(settles, [true, false], "a keyboard click did not toggle");
});

test("swiped up from the grip the sheet follows the finger, clamped to its height, and settles by how far it came", () => {
  const far = boot();
  far.at("pointerdown", far.grip, 700);
  far.tick(100); far.at("pointermove", far.grip, 600);
  far.tick(100); far.at("pointermove", far.grip, 450);
  far.tick(100); far.at("pointermove", far.grip, 440);
  far.tick(100); far.at("pointerup", far.grip, 440);
  assert.deepEqual(far.follows, [300, 150, 140, null]);
  assert.deepEqual(far.settles, [true], "raised most of the way, it did not open");

  const short = boot();
  short.at("pointerdown", short.grip, 700);
  short.tick(100); short.at("pointermove", short.grip, 650);
  short.tick(100); short.at("pointermove", short.grip, 640);
  short.tick(100); short.at("pointerup", short.grip, 640);
  assert.deepEqual(short.settles, [false], "a short swipe opened it");

  const flick = boot();
  flick.at("pointerdown", flick.grip, 700);
  flick.tick(10); flick.at("pointermove", flick.grip, 670);
  flick.tick(10); flick.at("pointermove", flick.grip, 640);
  flick.at("pointerup", flick.grip, 640);
  assert.deepEqual(flick.settles, [true], "a quick flick up did not open it");

  const past = boot();
  past.at("pointerdown", past.grip, 700);
  past.tick(100); past.at("pointermove", past.grip, 100);
  assert.equal(past.follows[0], 0, "the sheet was dragged past open");
});

test("the open sheet is pushed down by a swipe from the top of its list; a sideways move, an upward one or a scrolled list is its own, and the click a push releases is spent", () => {
  const push = boot({ open: true });
  assert.ok(push.sheet.classList.contains("is-at-top"), "the browser would take a downward swipe as a scroll");
  push.at("pointerdown", push.inside, 300);
  push.tick(100); push.at("pointermove", push.sheet, 360);
  push.tick(100); push.at("pointermove", push.sheet, 500);
  push.tick(100); push.at("pointerup", push.sheet, 500);
  assert.deepEqual(push.follows, [60, 200, null]);
  assert.deepEqual(push.settles, [false]);
  // The sheet spends it in the capture phase, before it reaches the
  // control (the fake DOM has no capture phase, so its listener is called
  // as the browser would call it first).
  const fire = () => { const event = { type: "click", target: push.inside, _stopped: false, stopPropagation() { this._stopped = true; }, preventDefault() {} }; for (const fn of push.sheet.listeners.click || []) fn(event); return event; };
  assert.equal(fire()._stopped, true, "the click a push released would press what was under the finger");
  assert.equal(fire()._stopped, false, "a later click was spent too");

  const sideways = boot({ open: true });
  sideways.at("pointerdown", sideways.inside, 300, 200);
  sideways.at("pointermove", sideways.sheet, 310, 280);
  sideways.at("pointermove", sideways.sheet, 360, 300);
  assert.deepEqual(sideways.follows, [], "a sideways move pushed the sheet");

  const up = boot({ open: true });
  up.at("pointerdown", up.inside, 300);
  up.at("pointermove", up.sheet, 240);
  assert.deepEqual(up.follows, [], "an upward swipe moved the open sheet");

  const scrolled = boot({ open: true });
  scrolled.sheet.scrollTop = 80;
  for (const fn of scrolled.sheet.listeners.scroll || []) fn({ type: "scroll" });
  assert.ok(!scrolled.sheet.classList.contains("is-at-top"), "a scrolled list left the browser no way to scroll it back");
  scrolled.at("pointerdown", scrolled.inside, 300);
  scrolled.at("pointermove", scrolled.sheet, 380);
  assert.deepEqual(scrolled.follows, [], "a scroll back up the list pushed the sheet");
  const tap = { type: "click", target: scrolled.inside, _stopped: false, stopPropagation() { this._stopped = true; }, preventDefault() {} };
  for (const fn of scrolled.sheet.listeners.click || []) fn(tap);
  assert.equal(tap._stopped, false, "a tap inside the open sheet was eaten");
});

test("with no drawer (a mouse, a wider screen) the grip and the sheet do nothing; a cancelled drag settles where it was", () => {
  const off = boot({ enabled: false });
  off.at("pointerdown", off.grip, 700);
  off.at("pointermove", off.grip, 400);
  off.at("pointerup", off.grip, 400);
  click(off.grip);
  assert.deepEqual(off.settles, []);
  assert.deepEqual(off.follows, []);

  const cancel = boot();
  cancel.at("pointerdown", cancel.grip, 700);
  cancel.at("pointermove", cancel.grip, 400);
  cancel.at("pointercancel", cancel.grip, 400);
  assert.deepEqual(cancel.follows, [100, null]);
  assert.deepEqual(cancel.settles, [false]);
});

test("the dot and the expanded state follow the boot", () => {
  const { drawer, grip } = boot();
  drawer.setDot(true);
  assert.ok(!grip.querySelector(".slate-grip__dot").hasAttribute("hidden"));
  assert.ok(grip.classList.contains("has-dot"));
  drawer.setDot(false);
  assert.ok(grip.querySelector(".slate-grip__dot").hasAttribute("hidden"));
  drawer.setExpanded(true);
  assert.equal(grip.getAttribute("aria-expanded"), "true");
});

test("the drawer reads no state, dispatches nothing and keeps no timer", () => {
  const source = fs.readFileSync(path.join(__dirname, "slate", "slate-phone-drawer.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /dispatch|request\(|setTimeout|Bridge/);
});
