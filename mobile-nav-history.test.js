"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createNavHistory } = require("./mobile-nav-history.js");

// A structural comparison like the one app.js supplies for its descriptors.
const equals = (a, b) => a && b && a.k === b.k;

test("a fresh history has nothing to go back or forward to", () => {
  const h = createNavHistory({ equals });
  assert.equal(h.canGoBack(), false);
  assert.equal(h.canGoForward(), false);
  assert.equal(h.current(), null);
  assert.equal(h.back(), null);
  assert.equal(h.forward(), null);
});

test("record appends and moves the pointer to the newest entry", () => {
  const h = createNavHistory({ equals });
  assert.equal(h.record({ k: "home" }), true);
  assert.equal(h.canGoBack(), false, "one entry: still nowhere back");
  assert.equal(h.record({ k: "recipe" }), true);
  assert.equal(h.canGoBack(), true);
  assert.equal(h.canGoForward(), false);
  assert.deepEqual(h.current(), { k: "recipe" });
  assert.equal(h.length, 2);
});

test("record is a no-op when the new entry equals the current one", () => {
  const h = createNavHistory({ equals });
  h.record({ k: "home" });
  assert.equal(h.record({ k: "home" }), false);
  assert.equal(h.record(null), false);
  assert.equal(h.record(undefined), false);
  assert.equal(h.length, 1);
});

test("back and forward walk the stack without mutating it", () => {
  const h = createNavHistory({ equals });
  h.record({ k: "home" });
  h.record({ k: "recipe" });
  h.record({ k: "timeline" });

  assert.deepEqual(h.back(), { k: "recipe" });
  assert.deepEqual(h.back(), { k: "home" });
  assert.equal(h.canGoBack(), false);
  assert.deepEqual(h.forward(), { k: "recipe" });
  assert.deepEqual(h.forward(), { k: "timeline" });
  assert.equal(h.canGoForward(), false);
  assert.equal(h.length, 3, "walking never drops entries");
});

test("recording after going back truncates the forward stack", () => {
  const h = createNavHistory({ equals });
  h.record({ k: "home" });
  h.record({ k: "recipe" });
  h.record({ k: "timeline" });
  h.back(); // -> recipe

  assert.equal(h.record({ k: "tools" }), true);
  assert.equal(h.canGoForward(), false, "timeline is gone");
  assert.deepEqual(h.current(), { k: "tools" });
  assert.equal(h.length, 3);
  assert.deepEqual(h.back(), { k: "recipe" });
});

test("re-recording the entry a back() just landed on is a no-op (re-entrant apply)", () => {
  const h = createNavHistory({ equals });
  h.record({ k: "home" });
  h.record({ k: "recipe" });
  const landed = h.back(); // -> home, forward stack intact

  assert.equal(h.record(landed), false);
  assert.equal(h.canGoForward(), true, "forward to recipe survived the re-record");
});

test("the stack is capped from the front, and the pointer shifts with it", () => {
  const h = createNavHistory({ equals, limit: 3 });
  h.record({ k: "a" });
  h.record({ k: "b" });
  h.record({ k: "c" });
  h.record({ k: "d" }); // drops "a"

  assert.equal(h.length, 3);
  assert.deepEqual(h.current(), { k: "d" });
  assert.deepEqual(h.back(), { k: "c" });
  assert.deepEqual(h.back(), { k: "b" });
  assert.equal(h.canGoBack(), false, "\"a\" was evicted");
});

test("reset clears entries and the pointer", () => {
  const h = createNavHistory({ equals });
  h.record({ k: "home" });
  h.record({ k: "recipe" });
  h.reset();
  assert.equal(h.length, 0);
  assert.equal(h.index, -1);
  assert.equal(h.canGoBack(), false);
  assert.equal(h.current(), null);
});

test("default equality is identity when no comparator is supplied", () => {
  const h = createNavHistory();
  const entry = { k: "home" };
  assert.equal(h.record(entry), true);
  assert.equal(h.record(entry), false, "same reference dedupes");
  assert.equal(h.record({ k: "home" }), true, "a different object does not");
});

test("an invalid limit falls back to the default rather than trapping", () => {
  for (const bad of [0, 1, -5, 2.5, "10", null]) {
    const h = createNavHistory({ equals, limit: bad });
    for (let i = 0; i < 60; i += 1) h.record({ k: `v${i}` });
    assert.equal(h.length, 50, `limit ${JSON.stringify(bad)} -> default 50`);
  }
});
