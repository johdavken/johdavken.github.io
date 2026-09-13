"use strict";

/* The weight-profiles bridge (station-weight-profiles-bridge.js): the
 * workspace's Receiver Weight Profiles as Station may see them, and the
 * things it may ask of them. The projection is an allow-list over the
 * configurations service's cached envelope; the letterbox carries a closed
 * vocabulary of actions, each an application closure, and answers with a
 * value, never a throw. The same shape as the recipes bridge, pinned on
 * its own so the two cannot drift into each other's records.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const bridgeModule = require("./station-weight-profiles-bridge.js");
const payloads = require("./workspace-configuration-payloads.js");

/* A cached envelope as workspace-configurations-service.js shapes it, for
 * a three-layer line with two weight profiles - one with geometry - and
 * one recipe that must not cross. */
function profilePayload(overrides) {
  return Object.assign({
    schema_version: 1, line_type: 3, hopper_naming_mode: "standard", hoppers_per_layer: 6,
    layers: ["A", "B", "C"].map((name, i) => ({
      name,
      receiver_weights_lb: Array.from({ length: 6 }, (_, index) => index < 2 ? 1000 + i * 100 + index * 10 : 0)
    }))
  }, overrides || {});
}

function geometryPayload() {
  const payload = profilePayload({ hopper_circumference_in: 0 });
  payload.layers = payload.layers.map(layer => Object.assign({}, layer, {
    usable_heights_in: [30, 30, 0, 0, 0, 0],
    circumferences_in: [0, 0, 0, 0, 0, 0],
    usable_gallons: [0, 0, 0, 0, 0, 0]
  }));
  return payload;
}

function envelope(workspaceId) {
  return {
    ok: true, workspaceId, cachedAt: 1700000000000,
    items: {
      receiver_weight_profile: [
        { id: "p-1", workspaceId, type: "receiver_weight_profile", name: "Standard weights", normalizedName: "standard weights", schemaVersion: 1, payload: profilePayload(), favorite: false, createdBy: "user-a", updatedBy: "user-b", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-10T12:00:00Z" },
        { id: "p-2", workspaceId, type: "receiver_weight_profile", name: "Measured", normalizedName: "measured", schemaVersion: 1, payload: geometryPayload(), favorite: false, createdBy: "user-a", updatedBy: "user-a", createdAt: "2026-09-02T00:00:00Z", updatedAt: "2026-09-03T00:00:00Z" }
      ],
      recipe: [{ id: "r-1", workspaceId, type: "recipe", name: "Clear film", normalizedName: "clear film", payload: {}, favorite: true, createdBy: "u1", updatedBy: "u1", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" }]
    }
  };
}

test("the payload shape the projection reads is the one createReceiverWeightProfile writes", () => {
  const state = { lineType: 3, hopperNamingLine9: "standard", hopperCircumference: 0, layers: ["A", "B", "C"].map(name => ({ name, hoppers: Array.from({ length: 6 }, () => ({ weight: 5, usableHeight: 0, circumference: 0, usableGallons: 0 })) })) };
  const payload = payloads.createReceiverWeightProfile(state);
  assert.ok("line_type" in payload && "hopper_naming_mode" in payload && Array.isArray(payload.layers));
  assert.ok("receiver_weights_lb" in payload.layers[0] && "usable_heights_in" in payload.layers[0]);
  const projected = bridgeModule.project({ workspaceId: "w", items: { receiver_weight_profile: [{ id: "x", type: "receiver_weight_profile", name: "n", payload }] } }, { workspaceId: "w" });
  assert.deepEqual(projected.profiles[0].layers[0].weights, [5, 5, 5, 5, 5, 5]);
});

/* ----------------------------------------------------------------------
 *   Projection
 * -------------------------------------------------------------------- */

test("project keeps the profiles as weights by position and drops everything Station has no business with", () => {
  const book = bridgeModule.project(envelope("ws-9"), { workspaceId: "ws-9", displayName: "Line 9" });
  assert.equal(book.assigned, true);
  assert.deepEqual(book.workspace, { id: "ws-9", displayName: "Line 9" });
  assert.equal(book.count, 2);
  assert.equal(book.cachedAt, 1700000000000);
  assert.equal(book.refreshing, false);
  const [plain, measured] = book.profiles;
  assert.deepEqual(Object.keys(plain).sort(), ["hasGeometry", "hopperNamingMode", "id", "layers", "lineType", "name", "updatedAt"]);
  assert.equal(plain.id, "p-1");
  assert.equal(plain.name, "Standard weights");
  assert.equal(plain.updatedAt, "2026-09-10T12:00:00Z");
  assert.equal(plain.lineType, 3);
  assert.equal(plain.hopperNamingMode, "standard");
  assert.equal(plain.hasGeometry, false);
  assert.deepEqual(plain.layers, [
    { name: "A", weights: [1000, 1010, 0, 0, 0, 0] },
    { name: "B", weights: [1100, 1110, 0, 0, 0, 0] },
    { name: "C", weights: [1200, 1210, 0, 0, 0, 0] }
  ]);
  // Geometry is announced, never carried: the load changes the drawn
  // hopper's shape, so the operator is told; Station does not edit it.
  assert.equal(measured.hasGeometry, true);
  assert.deepEqual(Object.keys(measured.layers[0]), ["name", "weights"]);
  // Nothing else crosses: no author ids, no normalized name, no recipe,
  // no geometry values.
  const text = JSON.stringify(book);
  for (const leak of ["user-a", "user-b", "normalizedName", "standard weights", "Clear film", "r-1", "\"recipe\"", "schemaVersion", "createdAt", "usable_heights_in", "favorite"]) {
    assert.ok(!text.includes(leak), `${leak} crossed the bridge`);
  }
});

test("geometry is a matter of presence, as the application's apply treats it: an all-zero heights array still counts, a shared circumference too", () => {
  function projectOne(payload) {
    return bridgeModule.project({ workspaceId: "w", items: { receiver_weight_profile: [{ id: "x", type: "receiver_weight_profile", name: "n", payload }] } }, { workspaceId: "w" }).profiles[0];
  }
  assert.equal(projectOne(profilePayload()).hasGeometry, false);
  const zeros = profilePayload();
  zeros.layers[0].usable_heights_in = [0, 0, 0, 0, 0, 0];
  assert.equal(projectOne(zeros).hasGeometry, true, "an all-zero array is written by the apply, resetting heights");
  const gallons = profilePayload();
  gallons.layers[2].usable_gallons = [1, 0, 0, 0, 0, 0];
  assert.equal(projectOne(gallons).hasGeometry, true);
  assert.equal(projectOne(profilePayload({ hopper_circumference_in: 48 })).hasGeometry, true);
  assert.equal(projectOne(profilePayload({ hopper_circumference_in: 0 })).hasGeometry, false, "a zero shared circumference is left alone by the apply");
});

test("project reads as no profiles for no workspace, another workspace's envelope, or a malformed one - never as someone else's", () => {
  const none = bridgeModule.project(envelope("ws-9"), { workspaceId: "" });
  assert.equal(none.assigned, false);
  assert.equal(none.workspace, null);
  assert.deepEqual(none.profiles, []);
  const other = bridgeModule.project(envelope("ws-9"), { workspaceId: "ws-10", displayName: "Line 10" });
  assert.equal(other.assigned, true);
  assert.deepEqual(other.profiles, [], "another workspace's cache was shown as this one's");
  assert.equal(other.cachedAt, 0);
  assert.deepEqual(bridgeModule.project(null, { workspaceId: "ws-9" }).profiles, []);
  assert.deepEqual(bridgeModule.project({ workspaceId: "ws-9", items: { receiver_weight_profile: [null, {}, { id: "x", type: "recipe" }] } }, { workspaceId: "ws-9" }).profiles, []);
  // A short or missing weights array reads as zeros, never as a crash.
  const short = bridgeModule.project({ workspaceId: "ws-9", items: { receiver_weight_profile: [{ id: "x", type: "receiver_weight_profile", name: "n", payload: { line_type: 1, layers: [{ name: "A", receiver_weights_lb: [7] }, { name: "B" }] } }] } }, { workspaceId: "ws-9" });
  assert.deepEqual(short.profiles[0].layers, [{ name: "A", weights: [7, 0, 0, 0, 0, 0] }, { name: "B", weights: [0, 0, 0, 0, 0, 0] }]);
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
      saveCurrentWeights: async args => { env.calls.push(["saveCurrentWeights", args]); return { ok: true, item: { id: "p-new", createdBy: "user-a", name: args.name } }; },
      replaceWeightProfile: async args => { env.calls.push(["replaceWeightProfile", args]); return { ok: true, item: { id: args.id } }; },
      loadWeightProfile: async args => { env.calls.push(["loadWeightProfile", args]); return { ok: true }; },
      renameWeightProfile: async args => { env.calls.push(["renameWeightProfile", args]); return { ok: true, item: { id: args.id } }; },
      duplicateWeightProfile: async args => { env.calls.push(["duplicateWeightProfile", args]); return { ok: true, item: { id: "p-copy" } }; },
      deleteWeightProfile: async args => { env.calls.push(["deleteWeightProfile", args]); return { ok: true }; },
      refresh: async args => { env.calls.push(["refresh", args]); return true; }
    }, actions || {})
  });
  env.bridge = bridge;
  return env;
}

test("the vocabulary is closed, and an unknown action is refused at connect time and at request time", async () => {
  assert.deepEqual([...bridgeModule.ACTIONS], ["saveCurrentWeights", "replaceWeightProfile", "loadWeightProfile", "renameWeightProfile", "duplicateWeightProfile", "deleteWeightProfile", "refresh"]);
  assert.ok(Object.isFrozen(bridgeModule.ACTIONS));
  assert.deepEqual([...bridgeModule.ERROR_CODES], ["unknown_action", "unavailable", "bad_argument", "duplicate_name", "invalid_name", "not_found", "incompatible", "access_denied", "not_authenticated", "network_error", "failed"]);
  const bridge = bridgeModule.create();
  assert.throws(() => bridge.connect({ read: () => ({}), actions: { saveCurrentRecipe: async () => ({ ok: true }) } }), /unknown action "saveCurrentRecipe"/);
  const env = producer();
  const result = await env.bridge.request("saveCurrentRecipe", { name: "X" });
  assert.deepEqual(result, { ok: false, code: "unknown_action", message: '"saveCurrentRecipe" is not a weight-profile action.' });
  assert.deepEqual(env.calls, []);
});

test("with no producer every request is unavailable, and the book is null", async () => {
  const bridge = bridgeModule.create();
  assert.equal(bridge.isConnected(), false);
  assert.equal(bridge.getBook(), null);
  assert.deepEqual([...bridge.capabilities()], []);
  const result = await bridge.request("loadWeightProfile", { id: "p-1" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unavailable");
  assert.ok(Object.isFrozen(result));
});

test("a save carries the name, normalized, and answers with the saved id and nothing else of the item", async () => {
  const env = producer();
  const result = await env.bridge.request("saveCurrentWeights", { name: "  Standard   weights  v2 ", extra: "dropped" });
  assert.deepEqual(env.calls, [["saveCurrentWeights", { name: "Standard weights v2" }]]);
  assert.ok(Object.isFrozen(env.calls[0][1]));
  assert.deepEqual(result, { ok: true, id: "p-new" });
  assert.ok(Object.isFrozen(result));
});

test("a missing or blank name, or a missing id, is refused before the application is asked", async () => {
  const env = producer();
  for (const args of [undefined, {}, { name: "" }, { name: "   " }, { name: 42 }]) {
    const result = await env.bridge.request("saveCurrentWeights", args);
    assert.deepEqual(result, { ok: false, code: "bad_argument", message: "A profile name is required.", field: "name" });
  }
  for (const action of ["replaceWeightProfile", "loadWeightProfile", "deleteWeightProfile"]) {
    const result = await env.bridge.request(action, { id: "" });
    assert.equal(result.code, "bad_argument", action);
    assert.equal(result.field, "id");
  }
  const rename = await env.bridge.request("renameWeightProfile", { id: "p-1", name: " " });
  assert.equal(rename.code, "bad_argument");
  assert.equal(rename.field, "name");
  const duplicate = await env.bridge.request("duplicateWeightProfile", { name: "Copy" });
  assert.equal(duplicate.code, "bad_argument");
  assert.equal(duplicate.field, "id");
  assert.deepEqual(env.calls, []);
});

test("each action names the profile by id and, where a name is taken, the name; a refresh carries nothing", async () => {
  const env = producer();
  assert.deepEqual(await env.bridge.request("replaceWeightProfile", { id: "p-2", name: "ignored" }), { ok: true, id: "p-2" });
  assert.deepEqual(await env.bridge.request("loadWeightProfile", { id: " p-1 " }), { ok: true });
  assert.deepEqual(await env.bridge.request("renameWeightProfile", { id: "p-1", name: " Line  9  standard " }), { ok: true, id: "p-1" });
  assert.deepEqual(await env.bridge.request("duplicateWeightProfile", { id: "p-1", name: "Copy of standard" }), { ok: true, id: "p-copy" });
  assert.deepEqual(await env.bridge.request("deleteWeightProfile", { id: "p-2" }), { ok: true });
  assert.deepEqual(await env.bridge.request("refresh", { anything: true }), { ok: true });
  assert.deepEqual(env.calls, [
    ["replaceWeightProfile", { id: "p-2" }],
    ["loadWeightProfile", { id: "p-1" }],
    ["renameWeightProfile", { id: "p-1", name: "Line 9 standard" }],
    ["duplicateWeightProfile", { id: "p-1", name: "Copy of standard" }],
    ["deleteWeightProfile", { id: "p-2" }],
    ["refresh", {}]
  ]);
});

test("the application's own failures - a duplicate name, a profile gone, an incompatible one - cross with their code and message, and a throw becomes a value", async () => {
  const env = producer({
    saveCurrentWeights: async () => ({ ok: false, code: "duplicate_name", message: "A configuration with that name already exists.", item: { createdBy: "leak" } }),
    loadWeightProfile: async () => ({ ok: false, code: "incompatible", message: "Receiver Weight Profile is incompatible with the current line type or physical layer layout." }),
    deleteWeightProfile: async () => ({ ok: false, code: "not_found", message: "That weight profile is no longer in this workspace." }),
    replaceWeightProfile: async () => { throw new Error("Workspace configurations could not reach Supabase."); },
    refresh: async () => false
  });
  const duplicate = await env.bridge.request("saveCurrentWeights", { name: "Standard weights" });
  assert.deepEqual(duplicate, { ok: false, code: "duplicate_name", message: "A configuration with that name already exists." });
  const incompatible = await env.bridge.request("loadWeightProfile", { id: "p-1" });
  assert.equal(incompatible.code, "incompatible");
  assert.match(incompatible.message, /line type or physical layer layout/);
  const gone = await env.bridge.request("deleteWeightProfile", { id: "p-9" });
  assert.equal(gone.code, "not_found");
  const thrown = await env.bridge.request("replaceWeightProfile", { id: "p-2" });
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
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.profiles[0]) && Object.isFrozen(first.profiles[0].layers[0]) && Object.isFrozen(first.profiles[0].layers[0].weights));
  assert.equal(env.bridge.getBook(), first, "the same revision is the same object");
  env.cache = envelope("ws-9");
  env.cache.items.receiver_weight_profile.pop();
  env.handle.publish();
  assert.equal(seen.length >= 1, true);
  assert.equal(env.bridge.getBook().count, 1);
  assert.notEqual(env.bridge.getBook(), first);
  assert.equal(env.bridge.publish, undefined, "publish is on the producer's handle only");
  assert.deepEqual([...env.bridge.capabilities()].sort(), ["deleteWeightProfile", "duplicateWeightProfile", "loadWeightProfile", "refresh", "renameWeightProfile", "replaceWeightProfile", "saveCurrentWeights"]);
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

test("the bridge source names no DOM, no service, no payload helper and no RT Sync internal: a window and a letterbox only", () => {
  const source = fs.readFileSync(path.join(__dirname, "station-weight-profiles-bridge.js"), "utf8");
  for (const forbidden of [/\bdocument\b/, /window\./, /addEventListener/, /createReceiverWeightProfile/, /applyReceiverWeightProfile/, /PolynWorkspaceConfigurations\b/, /polyn\.workspaceConfigurations/, /localStorage/, /supabase/i, /\.rpc\s*\(/, /fetch\s*\(/, /outbox/i, /active_jobs/, /workspace_configurations/]) {
    assert.doesNotMatch(source, forbidden, `the bridge reaches past its window (${forbidden})`);
  }
});
