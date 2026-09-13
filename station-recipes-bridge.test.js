"use strict";

/* The recipes bridge (station-recipes-bridge.js): the workspace's saved
 * recipes as Station may see them, and the three things it may ask of
 * them. The projection is an allow-list over the configurations service's
 * cached envelope; the letterbox carries a closed vocabulary of actions,
 * each an application closure, and answers with a value, never a throw.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const bridgeModule = require("./station-recipes-bridge.js");
const payloads = require("./workspace-configuration-payloads.js");

/* A cached envelope as workspace-configurations-service.js shapes it, for
 * a three-layer line with two recipes - one favourite - and one weight
 * profile that must not cross. */
function recipePayload(overrides) {
  return Object.assign({
    schema_version: 1, line_type: 3, hopper_naming_mode: "standard",
    layers: ["A", "B", "C"].map((name, i) => ({
      name, layer_pct: i === 1 ? 40 : 30,
      hoppers: Array.from({ length: 6 }, (_, index) => ({
        resin_name: index === 0 ? `HX${i}` : index === 1 ? `LD${i}` : "",
        pct: index === 0 ? 60 : index === 1 ? 40 : 0
      }))
    }))
  }, overrides || {});
}

function envelope(workspaceId) {
  return {
    ok: true, workspaceId, cachedAt: 1700000000000,
    items: {
      receiver_weight_profile: [{ id: "p1", workspaceId, type: "receiver_weight_profile", name: "Weights", normalizedName: "weights", payload: {}, favorite: false, createdBy: "u1", updatedBy: "u1", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" }],
      recipe: [
        { id: "r-fav", workspaceId, type: "recipe", name: "Clear film", normalizedName: "clear film", schemaVersion: 1, payload: recipePayload(), favorite: true, createdBy: "user-a", updatedBy: "user-b", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-10T12:00:00Z" },
        { id: "r-2", workspaceId, type: "recipe", name: "Heavy gauge", normalizedName: "heavy gauge", schemaVersion: 1, payload: recipePayload({ hopper_naming_mode: "main" }), favorite: false, createdBy: "user-a", updatedBy: "user-a", createdAt: "2026-09-02T00:00:00Z", updatedAt: "2026-09-03T00:00:00Z" }
      ]
    }
  };
}

test("the payload shape the projection reads is the one createRecipePayload writes", () => {
  const state = { lineType: 3, hopperNamingLine9: "standard", layers: ["A", "B", "C"].map(name => ({ name, layerPct: 33, hoppers: Array.from({ length: 6 }, () => ({ pct: 0, resinName: "" })) })) };
  const payload = payloads.createRecipePayload(state);
  assert.ok("line_type" in payload && "hopper_naming_mode" in payload && Array.isArray(payload.layers));
  assert.ok("layer_pct" in payload.layers[0] && "resin_name" in payload.layers[0].hoppers[0] && "pct" in payload.layers[0].hoppers[0]);
});

/* ----------------------------------------------------------------------
 *   Projection
 * -------------------------------------------------------------------- */

test("project keeps the recipes as blends and drops everything Station has no business with", () => {
  const book = bridgeModule.project(envelope("ws-9"), { workspaceId: "ws-9", displayName: "Line 9" });
  assert.equal(book.assigned, true);
  assert.deepEqual(book.workspace, { id: "ws-9", displayName: "Line 9" });
  assert.equal(book.count, 2);
  assert.equal(book.cachedAt, 1700000000000);
  assert.equal(book.refreshing, false);
  const [fav, other] = book.recipes;
  assert.deepEqual(Object.keys(fav).sort(), ["favorite", "hopperNamingMode", "id", "layers", "lineType", "name", "updatedAt"]);
  assert.equal(fav.id, "r-fav");
  assert.equal(fav.name, "Clear film");
  assert.equal(fav.favorite, true);
  assert.equal(fav.lineType, 3);
  assert.equal(fav.hopperNamingMode, "standard");
  assert.equal(other.hopperNamingMode, "main");
  // The blend, in the state bridge's own planned-recipe shape.
  assert.deepEqual(fav.layers[1], {
    name: "B", layerPct: 40,
    hoppers: [
      { index: 0, pct: 60, resinName: "HX1" }, { index: 1, pct: 40, resinName: "LD1" },
      { index: 2, pct: 0, resinName: "" }, { index: 3, pct: 0, resinName: "" },
      { index: 4, pct: 0, resinName: "" }, { index: 5, pct: 0, resinName: "" }
    ]
  });
  // Nothing else crosses: no author ids, no normalized name, no profile.
  const text = JSON.stringify(book);
  for (const leak of ["user-a", "user-b", "normalizedName", "clear film", "Weights", "receiver_weight_profile", "schemaVersion", "createdAt"]) {
    assert.ok(!text.includes(leak), `${leak} crossed the bridge`);
  }
});

test("project reads as no recipes for no workspace, another workspace's envelope, or a malformed one - never as someone else's", () => {
  const none = bridgeModule.project(envelope("ws-9"), { workspaceId: "" });
  assert.equal(none.assigned, false);
  assert.equal(none.workspace, null);
  assert.deepEqual(none.recipes, []);
  const other = bridgeModule.project(envelope("ws-9"), { workspaceId: "ws-10", displayName: "Line 10" });
  assert.equal(other.assigned, true);
  assert.deepEqual(other.recipes, [], "another workspace's cache was shown as this one's");
  assert.equal(other.cachedAt, 0);
  assert.deepEqual(bridgeModule.project(null, { workspaceId: "ws-9" }).recipes, []);
  assert.deepEqual(bridgeModule.project({ workspaceId: "ws-9", items: { recipe: [null, {}, { id: "x", type: "receiver_weight_profile" }] } }, { workspaceId: "ws-9" }).recipes, []);
  assert.equal(bridgeModule.project(envelope("ws-9"), { workspaceId: "ws-9" }).workspace.displayName, "Connected line");
  assert.equal(bridgeModule.project(envelope("ws-9"), { workspaceId: "ws-9", refreshing: true }).refreshing, true);
});

/* ----------------------------------------------------------------------
 *   The letterbox
 * -------------------------------------------------------------------- */

function producer(actions, cache) {
  const bridge = bridgeModule.create({ scheduler: run => run() });
  const env = { calls: [], cache: cache || envelope("ws-9") };
  env.handle = bridge.connect({
    read: () => bridgeModule.project(env.cache, { workspaceId: "ws-9", displayName: "Line 9" }),
    actions: Object.assign({
      saveCurrentRecipe: async args => { env.calls.push(["saveCurrentRecipe", args]); return { ok: true, item: { id: "r-new", createdBy: "user-a", name: args.name } }; },
      replaceRecipe: async args => { env.calls.push(["replaceRecipe", args]); return { ok: true, item: { id: args.id } }; },
      loadRecipe: async args => { env.calls.push(["loadRecipe", args]); return { ok: true }; },
      renameRecipe: async args => { env.calls.push(["renameRecipe", args]); return { ok: true, item: { id: args.id, name: args.name, createdBy: "leak" } }; },
      duplicateRecipe: async args => { env.calls.push(["duplicateRecipe", args]); return { ok: true, item: { id: "r-copy" } }; },
      deleteRecipe: async args => { env.calls.push(["deleteRecipe", args]); return { ok: true }; },
      refresh: async args => { env.calls.push(["refresh", args]); return true; }
    }, actions || {})
  });
  env.bridge = bridge;
  return env;
}

test("the vocabulary is closed, and an unknown action is refused at connect time and at request time", async () => {
  assert.deepEqual([...bridgeModule.ACTIONS], ["saveCurrentRecipe", "replaceRecipe", "loadRecipe", "renameRecipe", "duplicateRecipe", "deleteRecipe", "refresh"]);
  assert.ok(Object.isFrozen(bridgeModule.ACTIONS));
  assert.deepEqual([...bridgeModule.DESTINATIONS], ["current", "next"]);
  const bridge = bridgeModule.create();
  assert.throws(() => bridge.connect({ read: () => ({}), actions: { setFavorite: async () => ({ ok: true }) } }), /unknown action "setFavorite"/);
  const env = producer();
  const result = await env.bridge.request("setFavorite", { id: "r-2" });
  assert.deepEqual(result, { ok: false, code: "unknown_action", message: '"setFavorite" is not a saved-recipe action.' });
  assert.deepEqual(env.calls, []);
});

test("with no producer every request is unavailable, and the book is null", async () => {
  const bridge = bridgeModule.create();
  assert.equal(bridge.isConnected(), false);
  assert.equal(bridge.getBook(), null);
  assert.deepEqual([...bridge.capabilities()], []);
  const result = await bridge.request("saveCurrentRecipe", { name: "X" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unavailable");
  assert.ok(Object.isFrozen(result));
});

test("a save carries the name, normalized, and answers with the saved id and nothing else of the item", async () => {
  const env = producer();
  const result = await env.bridge.request("saveCurrentRecipe", { name: "  Clear   film  v2 ", extra: "dropped" });
  assert.deepEqual(env.calls, [["saveCurrentRecipe", { name: "Clear film v2" }]]);
  assert.ok(Object.isFrozen(env.calls[0][1]));
  assert.deepEqual(result, { ok: true, id: "r-new" });
  assert.ok(Object.isFrozen(result));
});

test("a missing or blank name, or a missing id, is refused before the application is asked", async () => {
  const env = producer();
  for (const args of [undefined, {}, { name: "" }, { name: "   " }, { name: 42 }]) {
    const result = await env.bridge.request("saveCurrentRecipe", args);
    assert.deepEqual(result, { ok: false, code: "bad_argument", message: "A recipe name is required.", field: "name" });
  }
  const replace = await env.bridge.request("replaceRecipe", { id: "" });
  assert.equal(replace.code, "bad_argument");
  assert.equal(replace.field, "id");
  assert.deepEqual(env.calls, []);
});

test("a replace names the recipe by id; a refresh carries nothing", async () => {
  const env = producer();
  assert.deepEqual(await env.bridge.request("replaceRecipe", { id: "r-2", name: "ignored" }), { ok: true, id: "r-2" });
  assert.deepEqual(await env.bridge.request("refresh", { anything: true }), { ok: true });
  assert.deepEqual(env.calls, [["replaceRecipe", { id: "r-2" }], ["refresh", {}]]);
});

test("a load names the recipe and one of the two destinations; rename and duplicate carry a normalized name; delete names the id - and each answers with no more than an id", async () => {
  const env = producer();
  assert.deepEqual(await env.bridge.request("loadRecipe", { id: "r-2", destination: "current" }), { ok: true });
  assert.deepEqual(await env.bridge.request("loadRecipe", { id: "r-2", destination: "next", extra: 1 }), { ok: true });
  for (const destination of [undefined, "", "both", "Current", 1]) {
    const refused = await env.bridge.request("loadRecipe", { id: "r-2", destination });
    assert.deepEqual(refused, { ok: false, code: "bad_argument", message: 'The destination must be "current" or "next".', field: "destination" });
  }
  assert.deepEqual(await env.bridge.request("renameRecipe", { id: "r-2", name: "  Clear  film " }), { ok: true, id: "r-2" });
  assert.deepEqual(await env.bridge.request("duplicateRecipe", { id: "r-2", name: "Clear film copy" }), { ok: true, id: "r-copy" });
  assert.equal((await env.bridge.request("renameRecipe", { id: "r-2", name: " " })).field, "name");
  assert.equal((await env.bridge.request("duplicateRecipe", { name: "x" })).field, "id");
  assert.deepEqual(await env.bridge.request("deleteRecipe", { id: "r-2", destination: "next" }), { ok: true });
  assert.deepEqual(env.calls, [
    ["loadRecipe", { id: "r-2", destination: "current" }],
    ["loadRecipe", { id: "r-2", destination: "next" }],
    ["renameRecipe", { id: "r-2", name: "Clear film" }],
    ["duplicateRecipe", { id: "r-2", name: "Clear film copy" }],
    ["deleteRecipe", { id: "r-2" }]
  ]);
  // The load's two failures of its own cross by code.
  const gone = producer({ loadRecipe: async () => ({ ok: false, code: "not_found", message: "That saved recipe is no longer in this workspace." }) });
  assert.deepEqual(await gone.bridge.request("loadRecipe", { id: "r-9", destination: "current" }), { ok: false, code: "not_found", message: "That saved recipe is no longer in this workspace." });
  const wrong = producer({ loadRecipe: async () => ({ ok: false, code: "incompatible", message: "This recipe is set up for 5 layers, but this line runs 3. Nothing was changed." }) });
  assert.equal((await wrong.bridge.request("loadRecipe", { id: "r-9", destination: "current" })).code, "incompatible");
});

test("the application's own failure - a duplicate name - crosses with its code and message, and a throw becomes a value", async () => {
  const env = producer({
    saveCurrentRecipe: async () => ({ ok: false, code: "duplicate_name", message: "A configuration with that name already exists.", item: { createdBy: "leak" } }),
    replaceRecipe: async () => { throw new Error("Workspace configurations could not reach Supabase."); },
    refresh: async () => false
  });
  const duplicate = await env.bridge.request("saveCurrentRecipe", { name: "Clear film" });
  assert.deepEqual(duplicate, { ok: false, code: "duplicate_name", message: "A configuration with that name already exists." });
  const thrown = await env.bridge.request("replaceRecipe", { id: "r-2" });
  assert.deepEqual(thrown, { ok: false, code: "failed", message: "Workspace configurations could not reach Supabase." });
  const failed = await env.bridge.request("refresh");
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "failed");
  // A code outside the vocabulary is not invented into a new one.
  const env2 = producer({ refresh: async () => ({ ok: false, code: "made_up", message: "?" }) });
  assert.equal((await env2.bridge.request("refresh")).code, "failed");
});

test("the window is the state bridge's own: a frozen book, one notification per publish, and the producer holds the only publish", async () => {
  const env = producer();
  const seen = [];
  env.bridge.subscribe(book => seen.push(book));
  const first = env.bridge.getBook();
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.recipes[0]) && Object.isFrozen(first.recipes[0].layers[0]));
  assert.equal(env.bridge.getBook(), first, "the same revision is the same object");
  env.cache = envelope("ws-9");
  env.cache.items.recipe.pop();
  env.handle.publish();
  assert.equal(seen.length >= 1, true);
  assert.equal(env.bridge.getBook().count, 1);
  assert.notEqual(env.bridge.getBook(), first);
  assert.equal(env.bridge.publish, undefined, "publish is on the producer's handle only");
  assert.deepEqual([...env.bridge.capabilities()].sort(), ["deleteRecipe", "duplicateRecipe", "loadRecipe", "refresh", "renameRecipe", "replaceRecipe", "saveCurrentRecipe"]);
  assert.throws(() => env.bridge.connect({ read: () => ({}) }), /already connected/);
  assert.equal(env.handle.disconnect(), true);
  assert.equal(env.bridge.isConnected(), false);
  assert.equal((await env.bridge.request("refresh")).code, "unavailable");
});

test("the module surface is frozen and exposes no writer", () => {
  assert.ok(Object.isFrozen(bridgeModule));
  for (const forbidden of ["publish", "disconnect", "setBook", "state"]) assert.equal(bridgeModule[forbidden], undefined);
  assert.equal(typeof bridgeModule.getBook, "function");
  assert.equal(typeof bridgeModule.request, "function");
  assert.equal(typeof bridgeModule.create, "function");
});
