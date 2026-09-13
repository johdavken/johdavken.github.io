"use strict";

/* The recipe edit history's page addressing (app.js).
 *
 * The history functions used to resolve Current vs Next from the Recipe
 * editor's own tab. They now take an optional page - "current" | "next" -
 * so a caller that is not the grid (the Station console) can address one
 * recipe explicitly, whatever tab the hidden grid happens to be on. The
 * grid's own callers pass nothing and behave exactly as before.
 *
 * app.js does not run outside a browser, so the history block is lifted
 * out of the source and run under stubs: the tests below exercise the real
 * functions, not a description of them. The source-level checks pin that
 * the block's callers were left alone.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

const BLOCK_START = "    const RECIPE_HISTORY_LIMIT = 40;";
const BLOCK_END = "    /* The plan's own percentage totals";

function historyBlock() {
  const start = app.indexOf(BLOCK_START);
  const end = app.indexOf(BLOCK_END);
  assert.ok(start > 0 && end > start, "the history block moved; update the anchors");
  return app.slice(start, end);
}

function layersNamed(names, resin) {
  return names.map(name => ({
    name, layerPct: 100 / names.length,
    hoppers: Array.from({ length: 6 }, (_, index) => ({
      pct: index === 0 ? 100 : 0, weight: 100 + index, resinName: index === 0 ? `${resin}-${name}` : "",
      track: index === 0, pumpOff: false, usableHeight: 0, circumference: 0, usableGallons: 0
    }))
  }));
}

/* The block, run with the application's surroundings stubbed: a state
 * object, the grid's page, the working plan, and the three tail calls. */
function load(options) {
  const settings = options || {};
  const factory = new Function("env", `
    let uiPage = env.uiPage;
    let nextRecipeWorking = env.nextRecipeWorking || null;
    const state = env.state;
    const clampNum = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
    const normName = s => String(s || "").trim().replace(/\\s+/g, " ");
    function isNextRecipePage(){ return uiPage === "next"; }
    function ensureNextRecipeWorking(){
      if (!nextRecipeWorking) nextRecipeWorking = env.freshWorking();
      return nextRecipeWorking;
    }
    function recipeLayers(){ return isNextRecipePage() ? ensureNextRecipeWorking() : state.layers; }
    const calls = [];
    function renderSplitsArea(){ calls.push("render"); }
    function validateAndCompute(o){ calls.push("validate:" + JSON.stringify(o)); }
    function saveSession(){ calls.push("save"); }
    const document = { querySelectorAll(){ return []; } };
    ${historyBlock()}
    return {
      snapshotRecipeEdit, recordRecipeEdit, applyRecipeEditSnapshot, undoRecipeEdit, redoRecipeEdit,
      discardRecipeEditHistory, recipeHistoryAvailability, recipeEditHistory, recipeHistoryPage,
      beginRecipeEditInput, finishRecipeEditInput,
      setPage(page){ uiPage = page; }, working(){ return nextRecipeWorking; }, state, calls
    };
  `);
  return factory({
    uiPage: settings.uiPage || "current",
    state: settings.state || { layers: layersNamed(["A", "B", "C"], "LIVE"), resinLots: { "LIVE-A": "L1" }, nextRecipeLots: {} },
    nextRecipeWorking: settings.nextRecipeWorking,
    freshWorking: () => layersNamed(["A", "B", "C"], "PLAN")
  });
}

const resinAt = (layers, name) => layers.find(layer => layer.name === name).hoppers[0].resinName;

/* ----------------------------------------------------------------------
 *   No-argument callers keep today's behaviour
 * -------------------------------------------------------------------- */

test("with no page named, every function resolves the grid's own page, as before", () => {
  const h = load({ uiPage: "current" });
  assert.equal(h.recipeHistoryPage(), "current");
  assert.equal(h.recipeHistoryPage(undefined), "current");
  h.setPage("next");
  assert.equal(h.recipeHistoryPage(), "next");
  // The undo/redo buttons pass their click Event as the first argument:
  // that is "no page named", not a page.
  assert.equal(h.recipeHistoryPage({ type: "click" }), "next");
  assert.equal(h.recipeHistoryPage("weights"), "next", "only current/next are page names");
  assert.equal(h.recipeHistoryPage(null), "next");
});

test("a no-argument edit on Current records into Current and undoes Current", () => {
  const h = load({ uiPage: "current" });
  const before = h.snapshotRecipeEdit();
  h.state.layers[0].hoppers[0].resinName = "LIVE-A-EDITED";
  h.recordRecipeEdit(before);
  assert.equal(h.recipeEditHistory.current.undo.length, 1);
  assert.equal(h.recipeEditHistory.next.undo.length, 0);
  h.undoRecipeEdit();
  assert.equal(resinAt(h.state.layers, "A"), "LIVE-A");
  assert.equal(h.recipeEditHistory.current.redo.length, 1);
  assert.deepEqual(h.calls, ["render", 'validate:{"sync":true,"immediate":true,"kind":"edit"}', "save"],
    "the undo tail is unchanged: render, validate with sync, save");
  h.redoRecipeEdit();
  assert.equal(resinAt(h.state.layers, "A"), "LIVE-A-EDITED");
});

test("a no-argument edit while the grid shows Next records into Next and leaves Current alone", () => {
  const h = load({ uiPage: "next" });
  const before = h.snapshotRecipeEdit();
  h.working()[1].hoppers[0].resinName = "PLAN-B-EDITED";
  h.recordRecipeEdit(before);
  assert.equal(h.recipeEditHistory.next.undo.length, 1);
  assert.equal(h.recipeEditHistory.current.undo.length, 0);
  h.undoRecipeEdit();
  assert.equal(resinAt(h.working(), "B"), "PLAN-B");
  assert.equal(resinAt(h.state.layers, "B"), "LIVE-B", "Current was not touched by a Next undo");
});

test("a snapshot with nothing changed records nothing, on either page", () => {
  const h = load({ uiPage: "current" });
  h.recordRecipeEdit(h.snapshotRecipeEdit());
  h.recordRecipeEdit(h.snapshotRecipeEdit("next"), "next");
  assert.equal(h.recipeEditHistory.current.undo.length, 0);
  assert.equal(h.recipeEditHistory.next.undo.length, 0);
  h.undoRecipeEdit();
  assert.deepEqual(h.calls, [], "an empty undo must not run the tail");
});

/* ----------------------------------------------------------------------
 *   Explicit addressing ignores the grid's page
 * -------------------------------------------------------------------- */

test("an explicit Next edit while the grid shows Current lands in Next's history and document", () => {
  const h = load({ uiPage: "current" });
  const before = h.snapshotRecipeEdit("next");
  assert.equal(resinAt(before.layers, "A"), "PLAN-A", "the snapshot must be of the plan, not the live recipe");
  h.working()[0].hoppers[0].resinName = "PLAN-A-EDITED";
  h.recordRecipeEdit(before, "next");
  assert.equal(h.recipeEditHistory.next.undo.length, 1);
  assert.equal(h.recipeEditHistory.current.undo.length, 0);

  h.undoRecipeEdit("next");
  assert.equal(resinAt(h.working(), "A"), "PLAN-A", "Next was undone");
  assert.equal(resinAt(h.state.layers, "A"), "LIVE-A", "Current was not");
  assert.equal(h.recipeEditHistory.next.redo.length, 1);
  assert.equal(h.recipeEditHistory.current.redo.length, 0);

  h.redoRecipeEdit("next");
  assert.equal(resinAt(h.working(), "A"), "PLAN-A-EDITED");
  // And the grid's own page was never consulted: it still says Current.
  assert.equal(h.recipeHistoryPage(), "current");
});

test("an explicit Current edit while the grid shows Next lands in Current's history and document", () => {
  const h = load({ uiPage: "next" });
  const before = h.snapshotRecipeEdit("current");
  assert.equal(resinAt(before.layers, "A"), "LIVE-A");
  h.state.layers[2].hoppers[0].resinName = "LIVE-C-EDITED";
  h.recordRecipeEdit(before, "current");
  assert.equal(h.recipeEditHistory.current.undo.length, 1);
  assert.equal(h.recipeEditHistory.next.undo.length, 0);
  h.undoRecipeEdit("current");
  assert.equal(resinAt(h.state.layers, "C"), "LIVE-C");
  assert.equal(h.working(), null, "addressing Current never creates or touches the plan's working copy");
});

test("the two stacks stay separate under interleaved explicit and implicit edits", () => {
  const h = load({ uiPage: "current" });
  const c1 = h.snapshotRecipeEdit();
  h.state.layers[0].hoppers[0].resinName = "C-1";
  h.recordRecipeEdit(c1);
  const n1 = h.snapshotRecipeEdit("next");
  h.working()[0].hoppers[0].resinName = "N-1";
  h.recordRecipeEdit(n1, "next");
  const c2 = h.snapshotRecipeEdit("current");
  h.state.layers[0].hoppers[0].resinName = "C-2";
  h.recordRecipeEdit(c2, "current");

  assert.deepEqual(h.recipeHistoryAvailability(), {
    current: { canUndo: true, canRedo: false },
    next: { canUndo: true, canRedo: false }
  });
  h.undoRecipeEdit("current");
  assert.equal(resinAt(h.state.layers, "A"), "C-1");
  assert.equal(resinAt(h.working(), "A"), "N-1");
  h.undoRecipeEdit("next");
  assert.equal(resinAt(h.working(), "A"), "PLAN-A");
  assert.equal(resinAt(h.state.layers, "A"), "C-1");
  h.undoRecipeEdit();               // the grid is on Current
  assert.equal(resinAt(h.state.layers, "A"), "LIVE-A");
  assert.deepEqual(h.recipeHistoryAvailability(), {
    current: { canUndo: false, canRedo: true },
    next: { canUndo: false, canRedo: true }
  });
});

test("an explicit undo with nothing to undo does nothing and runs no tail", () => {
  const h = load({ uiPage: "current" });
  h.undoRecipeEdit("next");
  h.redoRecipeEdit("current");
  assert.deepEqual(h.calls, []);
});

test("applying a snapshot to an explicit page replaces that page's document only", () => {
  const h = load({ uiPage: "current" });
  const plan = h.snapshotRecipeEdit("next");
  plan.layers[0].hoppers[0].resinName = "APPLIED-TO-PLAN";
  h.applyRecipeEditSnapshot(plan, "next");
  assert.equal(resinAt(h.working(), "A"), "APPLIED-TO-PLAN");
  assert.equal(resinAt(h.state.layers, "A"), "LIVE-A");
  // Snapshots are applied as copies: editing the snapshot afterwards does
  // not reach the document.
  plan.layers[0].hoppers[0].resinName = "LATER";
  assert.equal(resinAt(h.working(), "A"), "APPLIED-TO-PLAN");
});

test("the inherited snapshot semantics are unchanged: physical and runtime fields still ride along", () => {
  /* Documented quirk, deliberately NOT fixed by the addressing refactor: a
   * recipe undo also restores weight and tracking captured with it. This
   * pins that the refactor did not quietly change what a snapshot holds. */
  const h = load({ uiPage: "current" });
  const before = h.snapshotRecipeEdit();
  assert.deepEqual(Object.keys(before.layers[0].hoppers[0]).sort(),
    ["circumference", "pct", "pumpOff", "resinName", "track", "usableGallons", "usableHeight", "weight"]);
  assert.deepEqual(Object.keys(before).sort(), ["layers", "lots"]);
  assert.deepEqual(before.lots, { "LIVE-A": "L1" });
});

/* ----------------------------------------------------------------------
 *   The grid's callers were left alone
 * -------------------------------------------------------------------- */

test("no existing caller outside the history block names a page", () => {
  const start = app.indexOf(BLOCK_START);
  const end = app.indexOf(BLOCK_END);
  const outside = app.slice(0, start) + app.slice(end);
  for (const fn of ["snapshotRecipeEdit", "recordRecipeEdit", "applyRecipeEditSnapshot", "undoRecipeEdit", "redoRecipeEdit"]) {
    const calls = [...outside.matchAll(new RegExp(`\\b${fn}\\(([^)]*)\\)`, "g"))].map(match => match[1]);
    // applyRecipeEditSnapshot is internal to the block, and undo/redo are
    // bound as listeners rather than called; the other two have grid callers.
    if (fn === "snapshotRecipeEdit" || fn === "recordRecipeEdit") assert.ok(calls.length > 0, `${fn} has no callers outside the block`);
    for (const args of calls) {
      assert.doesNotMatch(args, /"(current|next)"/, `${fn}(${args}) names a page - the grid must keep resolving its own`);
    }
  }
  // The toolbar binds the functions directly, so their first argument is
  // the click Event, which the resolver treats as "no page named".
  assert.match(app, /undoButton\?\.addEventListener\("click",undoRecipeEdit\)/);
  assert.match(app, /redoButton\?\.addEventListener\("click",redoRecipeEdit\)/);
  assert.equal((app.match(/function recipeHistoryPage\(page\)/g) || []).length, 1);
});

test("the history block resolves pages through one function, and explicit paths never read the grid's tab", () => {
  const block = historyBlock();
  for (const fn of ["snapshotRecipeEdit", "recordRecipeEdit", "undoRecipeEdit", "redoRecipeEdit"]) {
    const at = block.indexOf(`function ${fn}(`);
    const body = block.slice(at, block.indexOf("\n    function ", at + 1));
    assert.doesNotMatch(body, /isNextRecipePage\(\)/, `${fn} still reads the grid's page directly`);
    assert.doesNotMatch(body, /recipeLayers\(\)/, `${fn} still reads the grid's layers directly`);
    assert.match(body, /recipeHistoryPage\(page\)/, `${fn} does not resolve its page`);
  }
  const apply = block.slice(block.indexOf("function applyRecipeEditSnapshot("));
  assert.match(apply.slice(0, apply.indexOf("\n    function ")), /recipeHistoryPage\(page\) === "next"/);
  // The resolver is the only place the grid's tab is consulted for history.
  assert.match(block, /function recipeHistoryPage\(page\)\{\n\s+return page === "next" \|\| page === "current" \? page : recipeEditHistoryKey\(\);/);
});
