const test = require("node:test");
const assert = require("node:assert/strict");

const attention = require("./attention-center.js");

const NOW = Date.parse("2026-08-11T12:00:00.000Z");

function facts(overrides = {}){
  return {
    setup: { lineRateSet: true, hopperWeightsUnset: false, missingTrackedWeightCount: 0, ...(overrides.setup || {}) },
    recipe: { layerTotalPct: 100, layerTotalValid: true, invalidLayerNames: [], ...(overrides.recipe || {}) },
    timeline: { trackedCount: 2, ...(overrides.timeline || {}) },
    sync: { enabled: true, connected: true, status: "Synced", pendingCount: 0, message: "", oldestPendingAt: "", ...(overrides.sync || {}) },
    storage: overrides.storage || []
  };
}

const derive = (overrides, options) => attention.derive(facts(overrides), { now: NOW, ...(options || {}) });
const ids = summary => summary.items.map(item => item.id);

/* ----------------------------------------------------------------------
 *   Empty state
 * -------------------------------------------------------------------- */

test("a fully healthy line produces no notifications", () => {
  const summary = derive();
  assert.deepEqual(summary.items, []);
  assert.equal(summary.count, 0);
  assert.equal(summary.errorCount, 0);
  assert.equal(summary.warningCount, 0);
  assert.equal(summary.severity, "none");
  assert.equal(attention.badgeLabel(summary), "Notifications, no items");
});

test("derive tolerates missing fact groups without inventing conditions", () => {
  const summary = attention.derive({}, { now: NOW });
  // Only the facts that genuinely default to "unset" appear - nothing is
  // fabricated from an absent group.
  assert.deepEqual(ids(summary), ["timeline.no-tracked"]);
});

/* ----------------------------------------------------------------------
 *   Severity, badge counts, accessible label
 * -------------------------------------------------------------------- */

test("one warning yields an amber-severity summary of one", () => {
  const summary = derive({ setup: { lineRateSet: false } });
  assert.deepEqual(ids(summary), ["setup.line-rate"]);
  assert.equal(summary.severity, "warning");
  assert.equal(summary.count, 1);
  assert.equal(summary.warningCount, 1);
  assert.equal(summary.errorCount, 0);
  assert.equal(summary.items[0].severityLabel, "Attention");
  assert.equal(attention.badgeLabel(summary), "Notifications, 1 item");
});

test("one blocking error yields a red-severity summary of one", () => {
  const summary = derive({ sync: { status: "Error", message: "This device no longer has access to this line." } });
  assert.deepEqual(ids(summary), ["sync.error"]);
  assert.equal(summary.severity, "error");
  assert.equal(summary.errorCount, 1);
  assert.equal(summary.warningCount, 0);
  assert.equal(summary.items[0].severityLabel, "Error");
  assert.equal(summary.items[0].message, "This device no longer has access to this line.");
});

test("mixed states count both severities and list errors first", () => {
  const summary = derive({
    setup: { lineRateSet: false, hopperWeightsUnset: true },
    recipe: { layerTotalValid: false, layerTotalPct: 92.5 },
    sync: { status: "Conflict" }
  });
  assert.equal(summary.severity, "error");
  assert.equal(summary.errorCount, 1);
  assert.equal(summary.warningCount, 3);
  assert.equal(summary.count, 4);
  assert.equal(summary.items[0].severity, "error");
  assert.ok(summary.items.slice(1).every(item => item.severity === "warning"));
  assert.equal(attention.badgeLabel(summary), "Notifications, 4 items");
});

test("severity is carried by a word, not only a color", () => {
  const summary = derive({ setup: { lineRateSet: false }, sync: { status: "Error" } });
  assert.deepEqual(
    summary.items.map(item => item.severityLabel).sort(),
    ["Attention", "Error"]
  );
});

/* ----------------------------------------------------------------------
 *   Stable ids, deduplication, automatic resolution
 * -------------------------------------------------------------------- */

test("ids are stable across renders while the wording changes", () => {
  const first = derive({ setup: { missingTrackedWeightCount: 1 } });
  const second = derive({ setup: { missingTrackedWeightCount: 3 } });
  assert.deepEqual(ids(first), ["setup.tracked-weights-missing"]);
  assert.deepEqual(ids(second), ["setup.tracked-weights-missing"]);
  assert.equal(first.items[0].title, "1 tracked hopper is missing weight");
  assert.equal(second.items[0].title, "3 tracked hoppers are missing weight");
});

test("re-deriving the same facts never accumulates duplicates", () => {
  const input = facts({ recipe: { layerTotalValid: false, layerTotalPct: 88 }, sync: { status: "Error" } });
  const first = attention.derive(input, { now: NOW });
  const second = attention.derive(input, { now: NOW + 1000 });
  const third = attention.derive(input, { now: NOW + 60000 });
  assert.deepEqual(ids(first), ids(second));
  assert.deepEqual(ids(second), ids(third));
  assert.equal(third.count, 2);
});

test("the same underlying storage failure reported repeatedly collapses to one item", () => {
  const summary = derive({
    storage: [
      { message: "Session could not be saved.", at: NOW - 1000 },
      { message: "Session could not be saved.", at: NOW - 500 },
      { message: "Session could not be saved.", at: NOW }
    ]
  });
  const storageItems = summary.items.filter(item => item.id.startsWith("storage."));
  assert.equal(storageItems.length, 1);
  assert.equal(storageItems[0].severity, "error");
});

test("distinct storage failures collapse into one entry that names the rest", () => {
  // "This browser cannot save local data" is one condition however many
  // individual writes hit it - two rows with the same title read as a bug.
  const summary = derive({
    storage: [
      { message: "Session could not be saved.", at: NOW - 2000 },
      { message: "RT Sync settings could not be saved locally.", at: NOW }
    ]
  });
  const storageItems = summary.items.filter(item => item.id.startsWith("storage."));
  assert.equal(storageItems.length, 1);
  assert.equal(storageItems[0].id, "storage.write-failed");
  assert.equal(
    storageItems[0].message,
    "RT Sync settings could not be saved locally. 1 other local write also failed."
  );
});

test("a single storage failure reports its own detail verbatim", () => {
  const summary = derive({ storage: [{ message: "Session could not be saved.", at: NOW }] });
  assert.equal(summary.items[0].message, "Session could not be saved.");
});

test("resolving a condition removes exactly its item", () => {
  const broken = derive({ setup: { lineRateSet: false }, recipe: { layerTotalValid: false, layerTotalPct: 80 } });
  assert.deepEqual(ids(broken).sort(), ["recipe.layer-total", "setup.line-rate"]);
  const halfFixed = derive({ recipe: { layerTotalValid: false, layerTotalPct: 80 } });
  assert.deepEqual(ids(halfFixed), ["recipe.layer-total"]);
  assert.deepEqual(ids(derive()), []);
});

/* ----------------------------------------------------------------------
 *   Layer totals, weights, recipe percentages
 * -------------------------------------------------------------------- */

test("invalid layer totals report the real total, then clear when corrected", () => {
  const invalid = derive({ recipe: { layerTotalValid: false, layerTotalPct: 92.5 } });
  assert.equal(invalid.items[0].title, "Layer percentages total 92.5%");
  assert.equal(invalid.items[0].section, "Recipe");
  assert.deepEqual(invalid.items[0].action, { id: "open-recipe", label: "Open Recipe" });
  assert.equal(derive({ recipe: { layerTotalValid: true, layerTotalPct: 100 } }).count, 0);
});

test("invalid hopper percentages name their layers, then clear when corrected", () => {
  const invalid = derive({ recipe: { invalidLayerNames: ["A", "C"] } });
  assert.equal(invalid.items[0].id, "recipe.hopper-totals");
  assert.equal(invalid.items[0].title, "Hopper percentages are off in layers A, C");
  assert.equal(derive({ recipe: { invalidLayerNames: ["B"] } }).items[0].title, "Hopper percentages are off in layer B");
  assert.equal(derive({ recipe: { invalidLayerNames: [] } }).count, 0);
});

test("missing receiver weights report once, then clear when entered", () => {
  const unset = derive({ setup: { hopperWeightsUnset: true } });
  assert.deepEqual(ids(unset), ["setup.weights-unset"]);
  assert.deepEqual(unset.items[0].action, { id: "open-weights", label: "Open Weights" });
  assert.equal(unset.items[0].section, "Setup");
  assert.equal(derive({ setup: { hopperWeightsUnset: false } }).count, 0);
});

test("the blanket weights-unset item suppresses the per-hopper one", () => {
  // Reporting both would be two names for a single condition.
  const summary = derive({ setup: { hopperWeightsUnset: true, missingTrackedWeightCount: 4 } });
  assert.deepEqual(ids(summary), ["setup.weights-unset"]);
});

test("no tracked hoppers is a Timeline condition that clears when one is tracked", () => {
  const none = derive({ timeline: { trackedCount: 0 } });
  assert.deepEqual(ids(none), ["timeline.no-tracked"]);
  assert.equal(none.items[0].section, "Timeline");
  assert.equal(derive({ timeline: { trackedCount: 1 } }).count, 0);
});

/* ----------------------------------------------------------------------
 *   RT Sync - pending versus failed
 * -------------------------------------------------------------------- */

test("ordinary connected pending upload is not an attention item", () => {
  const summary = derive({
    sync: { status: "Pending", pendingCount: 1, oldestPendingAt: new Date(NOW - 2000).toISOString() }
  });
  assert.equal(summary.count, 0);
});

test("syncing, connecting, synced and local-only never raise an item", () => {
  ["Syncing", "Connecting", "Synced", "Local only"].forEach(status => {
    assert.equal(derive({ sync: { status } }).count, 0, `${status} should stay quiet`);
  });
});

test("offline-pending changes raise a warning that names the count", () => {
  const summary = derive({ sync: { status: "Offline", connected: false, pendingCount: 2 } });
  assert.deepEqual(ids(summary), ["sync.offline-pending"]);
  assert.equal(summary.items[0].severity, "warning");
  assert.equal(summary.items[0].title, "2 changes are waiting to sync");
  assert.deepEqual(summary.items[0].action, { id: "retry-sync", label: "Retry Sync" });
});

test("pending changes on a disconnected device are offline-pending even without the Offline status", () => {
  const summary = derive({ sync: { status: "Pending", connected: false, pendingCount: 1 } });
  assert.deepEqual(ids(summary), ["sync.offline-pending"]);
  assert.equal(summary.items[0].title, "1 change is waiting to sync");
});

test("a pending upload that outlives the stall threshold becomes an attention item", () => {
  const fresh = derive({
    sync: { status: "Pending", pendingCount: 1, oldestPendingAt: new Date(NOW - 30000).toISOString() }
  });
  assert.equal(fresh.count, 0);
  const stalled = derive({
    sync: { status: "Pending", pendingCount: 1, oldestPendingAt: new Date(NOW - 120000).toISOString() }
  });
  assert.deepEqual(ids(stalled), ["sync.stalled"]);
  assert.equal(stalled.items[0].severity, "warning");
});

test("sync failure and conflict are blocking errors", () => {
  assert.equal(derive({ sync: { status: "Error" } }).items[0].severity, "error");
  assert.equal(derive({ sync: { status: "Conflict" } }).items[0].severity, "error");
  assert.equal(derive({ sync: { status: "Conflict" } }).items[0].section, "RT Sync");
});

test("successful synchronization clears every sync item automatically", () => {
  const failed = derive({ sync: { status: "Error", pendingCount: 1 } });
  assert.equal(failed.count, 1);
  const recovered = derive({ sync: { status: "Synced", pendingCount: 0 } });
  assert.equal(recovered.items.filter(item => item.id.startsWith("sync.")).length, 0);
});

test("only one RT Sync item is ever raised at a time", () => {
  const summary = derive({
    sync: { status: "Error", connected: false, pendingCount: 3, oldestPendingAt: new Date(NOW - 600000).toISOString() }
  });
  assert.equal(summary.items.filter(item => item.id.startsWith("sync.")).length, 1);
  assert.equal(summary.items[0].id, "sync.error");
});

/* ----------------------------------------------------------------------
 *   Transient lifecycle
 * -------------------------------------------------------------------- */

test("a transient storage failure ages out instead of being retained indefinitely", () => {
  const report = [{ message: "Session could not be saved.", at: NOW - 10000 }];
  assert.equal(derive({ storage: report }).count, 1);
  const later = attention.derive(facts({ storage: report }), { now: NOW + attention.DEFAULT_TRANSIENT_TTL_MS });
  assert.equal(later.count, 0);
});

test("thresholds are configurable so callers never re-implement them", () => {
  const input = facts({ sync: { status: "Pending", pendingCount: 1, oldestPendingAt: new Date(NOW - 10000).toISOString() } });
  assert.equal(attention.derive(input, { now: NOW, pendingStallMs: 5000 }).count, 1);
  assert.equal(attention.derive(input, { now: NOW, pendingStallMs: 60000 }).count, 0);
});

/* ----------------------------------------------------------------------
 *   Entry shape
 * -------------------------------------------------------------------- */

test("every entry carries a stable id, severity, title, section and known action", () => {
  const summary = derive({
    setup: { lineRateSet: false, hopperWeightsUnset: true },
    recipe: { layerTotalValid: false, layerTotalPct: 70, invalidLayerNames: ["A"] },
    timeline: { trackedCount: 0 },
    sync: { status: "Error" },
    storage: [{ message: "Session could not be saved.", at: NOW }]
  });
  const sections = new Set(Object.values(attention.SECTION));
  const actions = new Set(["review-setup", "open-weights", "open-recipe", "retry-sync"]);
  assert.ok(summary.count >= 6);
  summary.items.forEach(item => {
    assert.ok(item.id, "id must be present");
    assert.ok(["error", "warning"].includes(item.severity));
    assert.ok(item.title.length > 0);
    assert.ok(sections.has(item.section), `${item.section} must be a known section`);
    if (item.action) assert.ok(actions.has(item.action.id), `${item.action.id} must be a known action`);
  });
  assert.equal(new Set(ids(summary)).size, summary.count, "ids must be unique");
});
