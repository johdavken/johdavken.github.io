"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./hookup-sources.js");

/* ----------------------------------------------------------------------
 *   normalizeSource
 * -------------------------------------------------------------------- */

test("normalizeSource uppercases, trims, collapses whitespace", () => {
  assert.equal(H.normalizeSource("  s11 "), "S11");
  assert.equal(H.normalizeSource("b   3"), "B 3");
  assert.equal(H.normalizeSource("a"), "A");
});

test("normalizeSource keeps operator separators but drops other punctuation", () => {
  assert.equal(H.normalizeSource("S-11"), "S-11");
  assert.equal(H.normalizeSource("B/3"), "B/3");
  assert.equal(H.normalizeSource("S#11!"), "S11");
});

test("normalizeSource caps length without truncating short values", () => {
  assert.equal(H.normalizeSource("S11").length, 3);
  assert.equal(H.normalizeSource("X".repeat(80)).length, H.MAX_SOURCE_LENGTH);
});

test("normalizeSource returns '' for non-strings", () => {
  assert.equal(H.normalizeSource(null), "");
  assert.equal(H.normalizeSource(42), "");
  assert.equal(H.normalizeSource(undefined), "");
});

/* ----------------------------------------------------------------------
 *   normalizeStore - defensive shape sanitation
 * -------------------------------------------------------------------- */

test("normalizeStore always returns both recipe maps", () => {
  assert.deepEqual(H.normalizeStore(null), { current: {}, next: {} });
  assert.deepEqual(H.normalizeStore("nope"), { current: {}, next: {} });
  assert.deepEqual(H.normalizeStore([]), { current: {}, next: {} });
});

test("normalizeStore drops malformed keys and entries, keeps well-formed ones", () => {
  const out = H.normalizeStore({
    current: {
      "A:0": { resin: "A0700", source: "s11" },
      "A:1": { resin: "A0450", source: "" },        // empty source -> dropped
      "bad-key": { resin: "X", source: "Z" },        // no ":" -> dropped
      "A:2": "not an object",                        // -> dropped
      "A:3": { source: "  b3 " }                     // missing resin -> "" resin, kept
    },
    next: { "B:0": { resin: "A0711", source: "c" } },
    junk: { "C:0": { resin: "Y", source: "Q" } }     // unknown recipe key -> ignored
  });
  assert.deepEqual(out, {
    current: {
      "A:0": { resin: "A0700", source: "S11" },
      "A:3": { resin: "", source: "B3" }
    },
    next: { "B:0": { resin: "A0711", source: "C" } }
  });
});

/* ----------------------------------------------------------------------
 *   positionsFromLayers - active/non-zero only, both shapes
 * -------------------------------------------------------------------- */

test("positionsFromLayers reads the live layer shape and skips inactive slots", () => {
  const positions = H.positionsFromLayers([
    { name: "A", hoppers: [
      { resinName: "A0700", pct: 40 },
      { resinName: "", pct: 0 },          // inactive -> skipped
      { resinName: "", pct: 12 },         // pct only -> kept
      { resinName: " MS1200 ", pct: 0 }   // resin only -> kept, trimmed
    ] }
  ]);
  assert.deepEqual(positions, [
    { key: "A:0", layer: "A", index: 0, resin: "A0700", pct: 40 },
    { key: "A:2", layer: "A", index: 2, resin: "", pct: 12 },
    { key: "A:3", layer: "A", index: 3, resin: "MS1200", pct: 0 }
  ]);
});

test("positionsFromLayers reads the stored recipe payload shape (resin_name)", () => {
  const positions = H.positionsFromLayers([
    { name: "CORE", hoppers: [{ resin_name: "A0711", pct: 100 }, { resin_name: null, pct: 0 }] }
  ]);
  assert.deepEqual(positions, [
    { key: "CORE:0", layer: "CORE", index: 0, resin: "A0711", pct: 100 }
  ]);
});

/* ----------------------------------------------------------------------
 *   reconcile - stale pruning
 * -------------------------------------------------------------------- */

const CURRENT_POSITIONS = [
  { key: "A:0", layer: "A", index: 0, resin: "A0700", pct: 40 },
  { key: "A:1", layer: "A", index: 1, resin: "A0450", pct: 60 }
];

test("reconcile keeps entries whose position and resin still match", () => {
  const store = { current: { "A:0": { resin: "A0700", source: "S11" } }, next: {} };
  const { store: out, changed } = H.reconcile(store, { current: CURRENT_POSITIONS, next: [] });
  assert.equal(changed, false);
  assert.deepEqual(out.current, { "A:0": { resin: "A0700", source: "S11" } });
});

test("reconcile drops an entry whose position no longer exists", () => {
  const store = { current: { "A:5": { resin: "A0700", source: "S11" } }, next: {} };
  const { store: out, changed } = H.reconcile(store, { current: CURRENT_POSITIONS, next: [] });
  assert.equal(changed, true);
  assert.deepEqual(out.current, {});
});

test("reconcile drops an entry when the slot's resin changed - no inheritance onto new material", () => {
  const store = { current: { "A:0": { resin: "A0700", source: "S11" } }, next: {} };
  const nextPositions = [{ key: "A:0", layer: "A", index: 0, resin: "A0999", pct: 40 }];
  const { store: out, changed } = H.reconcile(store, { current: nextPositions, next: [] });
  assert.equal(changed, true);
  assert.deepEqual(out.current, {});
});

test("reconcile drops an entry when the slot lost its resin entirely", () => {
  const store = { current: { "A:0": { resin: "A0700", source: "S11" } }, next: {} };
  const nextPositions = [{ key: "A:0", layer: "A", index: 0, resin: "", pct: 40 }];
  const { changed, store: out } = H.reconcile(store, { current: nextPositions, next: [] });
  assert.equal(changed, true);
  assert.deepEqual(out.current, {});
});

test("reconcile backfills a blank stored resin from the live position", () => {
  const store = { current: { "A:0": { resin: "", source: "S11" } }, next: {} };
  const { store: out, changed } = H.reconcile(store, { current: CURRENT_POSITIONS, next: [] });
  assert.equal(changed, true);
  assert.deepEqual(out.current, { "A:0": { resin: "A0700", source: "S11" } });
});

test("reconcile reports changed when normalizeStore had to discard malformed data", () => {
  const store = { current: { "A:0": { resin: "A0700", source: "S11" }, "A:1": { resin: "A0450", source: "" } }, next: {} };
  const { changed } = H.reconcile(store, { current: CURRENT_POSITIONS, next: [] });
  assert.equal(changed, true);
});

test("reconcile treats current and next independently", () => {
  const store = {
    current: { "A:0": { resin: "A0700", source: "S11" } },
    next: { "A:0": { resin: "OLD", source: "C" } }
  };
  const { store: out, changed } = H.reconcile(store, {
    current: CURRENT_POSITIONS,
    next: [{ key: "A:0", layer: "A", index: 0, resin: "A0711", pct: 100 }]
  });
  assert.equal(changed, true);
  assert.deepEqual(out.current, { "A:0": { resin: "A0700", source: "S11" } });
  assert.deepEqual(out.next, {});
});

/* ----------------------------------------------------------------------
 *   groupByResin - duplicate handling + mixed detection
 * -------------------------------------------------------------------- */

test("groupByResin collapses duplicate resin codes into one row, in first-seen order", () => {
  const positions = [
    { key: "A:0", resin: "A0450", pct: 30 },
    { key: "A:1", resin: "MS1200", pct: 20 },
    { key: "B:0", resin: "A0450", pct: 50 }
  ];
  const groups = H.groupByResin(positions, {});
  assert.deepEqual(groups.map(g => g.resin), ["A0450", "MS1200"]);
  assert.deepEqual(groups[0].keys, ["A:0", "B:0"]);
});

test("groupByResin surfaces a single shared value across duplicate positions", () => {
  const positions = [
    { key: "A:0", resin: "A0450", pct: 30 },
    { key: "B:0", resin: "A0450", pct: 50 }
  ];
  const map = { "A:0": { resin: "A0450", source: "B3" }, "B:0": { resin: "A0450", source: "B3" } };
  const [group] = H.groupByResin(positions, map);
  assert.equal(group.value, "B3");
  assert.equal(group.mixed, false);
});

test("groupByResin flags mixed when duplicate positions disagree, without losing either value", () => {
  const positions = [
    { key: "A:0", resin: "A0450", pct: 30 },
    { key: "B:0", resin: "A0450", pct: 50 }
  ];
  const map = { "A:0": { resin: "A0450", source: "B3" }, "B:0": { resin: "A0450", source: "S4" } };
  const [group] = H.groupByResin(positions, map);
  assert.equal(group.mixed, true);
  assert.equal(group.value, "");
  assert.deepEqual(group.sources, ["B3", "S4"]);
});

test("groupByResin ignores positions with no resin code (resin code is the visible identity)", () => {
  const groups = H.groupByResin([{ key: "A:2", resin: "", pct: 12 }], {});
  assert.deepEqual(groups, []);
});

/* ----------------------------------------------------------------------
 *   applyGroup - one entry applied to every matching slot
 * -------------------------------------------------------------------- */

test("applyGroup writes the label to every position key in the group", () => {
  const out = H.applyGroup({ current: {}, next: {} }, "current", ["A:0", "B:0"], "A0450", "b3");
  assert.deepEqual(out.current, {
    "A:0": { resin: "A0450", source: "B3" },
    "B:0": { resin: "A0450", source: "B3" }
  });
});

test("applyGroup with an empty label clears every position in the group", () => {
  const store = { current: { "A:0": { resin: "A0450", source: "B3" }, "B:0": { resin: "A0450", source: "B3" } }, next: {} };
  const out = H.applyGroup(store, "current", ["A:0", "B:0"], "A0450", "  ");
  assert.deepEqual(out.current, {});
});

test("applyGroup leaves the other recipe map and unrelated keys untouched", () => {
  const store = {
    current: { "A:9": { resin: "KEEP", source: "Z9" } },
    next: { "A:0": { resin: "N", source: "N1" } }
  };
  const out = H.applyGroup(store, "current", ["A:0"], "A0450", "b3");
  assert.deepEqual(out.current["A:9"], { resin: "KEEP", source: "Z9" });
  assert.deepEqual(out.next, { "A:0": { resin: "N", source: "N1" } });
});

test("applyGroup ignores unknown recipe keys and non-array keys", () => {
  const store = { current: {}, next: {} };
  assert.deepEqual(H.applyGroup(store, "bogus", ["A:0"], "X", "Y"), { current: {}, next: {} });
  assert.deepEqual(H.applyGroup(store, "current", "A:0", "X", "Y"), { current: {}, next: {} });
});

/* ----------------------------------------------------------------------
 *   sourceForPosition - resin-guarded lookup for Timeline rows
 * -------------------------------------------------------------------- */

test("sourceForPosition returns the label only when the resin still matches", () => {
  const map = { "A:0": { resin: "A0700", source: "S11" } };
  assert.equal(H.sourceForPosition(map, "A:0", "A0700"), "S11");
  assert.equal(H.sourceForPosition(map, "A:0", "A0999"), "");
  assert.equal(H.sourceForPosition(map, "A:1", "A0700"), "");
});

test("sourceForPosition tolerates a blank stored resin", () => {
  const map = { "A:0": { resin: "", source: "S11" } };
  assert.equal(H.sourceForPosition(map, "A:0", "A0700"), "S11");
});
