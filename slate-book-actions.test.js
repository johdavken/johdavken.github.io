"use strict";

/* slate-book-actions.js: the Recipe Book's seam to the recipes bridge.
 * Every request's name and args are pinned, and the abilities table. */

const test = require("node:test");
const assert = require("node:assert/strict");

const actions = require("./slate/slate-book-actions.js");
const bridge = require("./station-recipes-bridge.js");

function recipe(id, name, extra) {
  return Object.assign({ id, name, favorite: false, updatedAt: "2026-09-21T10:00:00Z", lineType: 3, hopperNamingMode: "standard", layers: [] }, extra || {});
}

function bookOf(overrides) {
  return Object.assign({
    assigned: true,
    workspace: { id: "ws-1", displayName: "Line 5" },
    cachedAt: 1, refreshing: false,
    recipes: [recipe("r1", "Blue film"), recipe("r2", "Clear 40", { favorite: true })],
    count: 2
  }, overrides || {});
}

/* A fake recipes bridge: records requests, answers as told. */
function makeRecipes(book, options) {
  const settings = options || {};
  const requests = [];
  const listeners = new Set();
  let current = book;
  return {
    requests,
    isConnected: () => settings.connected !== false,
    capabilities: () => settings.capabilities || [...actions.ACTIONS],
    getBook: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async request(action, args) {
      requests.push(args === undefined ? { action } : { action, args });
      if (typeof settings.answer === "function") {
        const answered = settings.answer(action, args);
        if (answered !== undefined) return answered;
      }
      return { ok: true };
    },
    set(next) { current = next; for (const listener of listeners) listener(next); }
  };
}

test("the seam's vocabulary is the bridge's, and every action is spelt in the source once as a request", () => {
  assert.deepEqual([...actions.ACTIONS].sort(), [...bridge.ACTIONS].sort());
  assert.deepEqual([...actions.DESTINATIONS], [...bridge.DESTINATIONS]);
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/slate-book-actions.js"), "utf8");
  for (const action of actions.ACTIONS) assert.ok(source.includes(`"${action}"`), `${action} is never requested`);
  assert.equal((source.match(/\.request\(/g) || []).length, 2, "the transport is not the one place the bridge is asked");
});

test("each function sends exactly its request, with names cleaned as the bridge cleans them", async () => {
  const recipes = makeRecipes(bookOf());
  await actions.save(recipes, "current", "  Blue   film 2 ");
  await actions.save(recipes, "next", "Plan A");
  await actions.replace(recipes, "r1");
  await actions.load(recipes, "r1", "next");
  await actions.load(recipes, "r1", "nonsense");
  await actions.rename(recipes, "r1", " Renamed ");
  await actions.duplicate(recipes, "r1", "Blue film copy");
  await actions.remove(recipes, "r2");
  await actions.refreshBook(recipes);
  assert.deepEqual(recipes.requests, [
    { action: "saveCurrentRecipe", args: { name: "Blue film 2" } },
    { action: "saveNextRecipe", args: { name: "Plan A" } },
    { action: "replaceRecipe", args: { id: "r1" } },
    { action: "loadRecipe", args: { id: "r1", destination: "next" } },
    { action: "loadRecipe", args: { id: "r1", destination: "current" } },
    { action: "renameRecipe", args: { id: "r1", name: "Renamed" } },
    { action: "duplicateRecipe", args: { id: "r1", name: "Blue film copy" } },
    { action: "deleteRecipe", args: { id: "r2" } },
    { action: "refresh" }
  ]);
  // The bridge's own normaliser accepts each as sent.
  for (const one of recipes.requests) {
    const normalized = bridge.normalizeArguments(one.action, one.args || {});
    assert.ok(!normalized.error, `${one.action}: ${normalized.error && normalized.error.message}`);
  }
});

test("no bridge answers unavailable, a rejecting bridge answers failed, an empty answer is said so - never a throw", async () => {
  assert.equal((await actions.save(null, "current", "x")).code, "unavailable");
  assert.equal((await actions.refreshBook(undefined)).code, "unavailable");
  const rejecting = { request: async () => { throw new Error("boom"); }, isConnected: () => true, getBook: () => bookOf(), capabilities: () => [] };
  const failed = await actions.remove(rejecting, "r1");
  assert.equal(failed.code, "failed");
  assert.equal(failed.message, "boom");
  const silent = { request: async () => null, isConnected: () => true, getBook: () => bookOf(), capabilities: () => [] };
  assert.equal((await actions.load(silent, "r1", "current")).message, actions.WORDING.noAnswer);
});

test("a save of the running recipe that collides names the recipe it collided with; a plan's does not", async () => {
  const collide = { ok: false, code: "duplicate_name", message: "A recipe with that name already exists.", field: "name" };
  const recipes = makeRecipes(bookOf(), { answer: action => (action.startsWith("save") ? collide : undefined) });
  const current = await actions.save(recipes, "current", "blue  FILM");
  assert.equal(current.ok, false);
  assert.equal(current.code, "duplicate_name");
  assert.deepEqual(current.existing, { id: "r1", name: "Blue film" });
  assert.equal(current.field, "name");
  const next = await actions.save(recipes, "next", "Blue film");
  assert.equal(next.code, "duplicate_name");
  assert.equal(next.existing, null);
  const missing = await actions.save(recipes, "current", "Nothing like this");
  assert.equal(missing.existing, null);
  assert.equal(actions.findByName(bookOf(), " clear   40 ").id, "r2");
  assert.equal(actions.findByName(bookOf(), ""), null);
  assert.equal(actions.findById(bookOf(), "r2").name, "Clear 40");
  assert.equal(actions.normalizedName("  A  B "), "a b");
});

test("abilities: read-only keeps only Refresh; no application, no line, no plan and a refresh in flight withhold what they must", () => {
  const live = makeRecipes(bookOf());
  const all = actions.can(live, { planned: true });
  assert.ok(Object.values(all).every(value => value === true), JSON.stringify(all));
  assert.deepEqual(Object.keys(all).sort(), ["duplicate", "load", "refresh", "remove", "rename", "replace", "saveCurrent", "saveNext", "update"]);

  const readOnly = actions.can(live, { readOnly: true, planned: true });
  assert.equal(readOnly.refresh, true);
  assert.ok(Object.keys(readOnly).filter(key => key !== "refresh").every(key => readOnly[key] === false));
  assert.equal(actions.reason(live, "load", { readOnly: true }), actions.READ_ONLY_REASON);
  assert.equal(actions.reason(live, "refresh", { readOnly: true }), "");

  assert.ok(Object.values(actions.can(null)).every(value => value === false));
  assert.match(actions.reason(null, "load"), /no application is connected/);
  const off = makeRecipes(bookOf(), { connected: false });
  assert.ok(Object.values(actions.can(off)).every(value => value === false));

  const unassigned = makeRecipes(bookOf({ assigned: false, workspace: null, recipes: [], count: 0 }));
  assert.ok(Object.values(actions.can(unassigned)).every(value => value === false));
  assert.match(actions.reason(unassigned, "saveCurrent"), /not on a production line/);

  const unplanned = actions.can(live, { planned: false });
  assert.equal(unplanned.saveNext, false);
  assert.equal(unplanned.saveCurrent, true);
  assert.equal(actions.reason(live, "saveNext", { planned: false }), "nothing is planned.");

  const refreshing = makeRecipes(bookOf({ refreshing: true }));
  assert.equal(actions.can(refreshing).refresh, false);
  assert.equal(actions.can(refreshing).load, true);
  assert.match(actions.reason(refreshing, "refresh"), /being read/);

  const partial = makeRecipes(bookOf(), { capabilities: ["loadRecipe", "refresh"] });
  assert.equal(actions.can(partial).load, true);
  assert.equal(actions.can(partial).remove, false);
  assert.match(actions.reason(partial, "remove"), /does not offer deleteRecipe/);
});
