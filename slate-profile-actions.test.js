"use strict";

/* slate-profile-actions.js: the Weights section's seam to the
 * weight-profiles bridge. Every request's name and args are pinned, and
 * the abilities table. */

const test = require("node:test");
const assert = require("node:assert/strict");

const actions = require("./slate/slate-profile-actions.js");
const bridge = require("./station-weight-profiles-bridge.js");

function profile(id, name, extra) {
  return Object.assign({ id, name, updatedAt: "2026-09-21T10:00:00Z", lineType: 3, hopperNamingMode: "standard", hasGeometry: false, layers: [] }, extra || {});
}

function bookOf(overrides) {
  return Object.assign({
    assigned: true,
    workspace: { id: "ws-1", displayName: "Line 5" },
    cachedAt: 1, refreshing: false,
    profiles: [profile("p1", "Standard 48in"), profile("p2", "Heavy rolls", { hasGeometry: true })],
    count: 2
  }, overrides || {});
}

/* A fake weight-profiles bridge: records requests, answers as told. */
function makeProfiles(book, options) {
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
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/slate-profile-actions.js"), "utf8");
  for (const action of actions.ACTIONS) assert.ok(source.includes(`"${action}"`), `${action} is never requested`);
  assert.equal((source.match(/\.request\(/g) || []).length, 2, "the transport is not the one place the bridge is asked");
  // The confirmation words are the floor UI's, as Station carries them.
  const station = require("node:fs").readFileSync(require("node:path").join(__dirname, "station/station-weights.js"), "utf8");
  assert.ok(station.includes(`"${actions.LOAD_TEXT}"`), "LOAD_TEXT drifted from Station's");
  assert.ok(station.includes(`"${actions.GEOMETRY_TEXT}"`), "GEOMETRY_TEXT drifted from Station's");
});

test("each function sends exactly its request, with names cleaned as the bridge cleans them", async () => {
  const profiles = makeProfiles(bookOf());
  await actions.save(profiles, "  Standard   60in ");
  await actions.replace(profiles, "p1");
  await actions.load(profiles, "p1");
  await actions.rename(profiles, "p1", " Renamed ");
  await actions.duplicate(profiles, "p1", "Standard copy");
  await actions.remove(profiles, "p2");
  await actions.refreshBook(profiles);
  assert.deepEqual(profiles.requests, [
    { action: "saveCurrentWeights", args: { name: "Standard 60in" } },
    { action: "replaceWeightProfile", args: { id: "p1" } },
    { action: "loadWeightProfile", args: { id: "p1" } },
    { action: "renameWeightProfile", args: { id: "p1", name: "Renamed" } },
    { action: "duplicateWeightProfile", args: { id: "p1", name: "Standard copy" } },
    { action: "deleteWeightProfile", args: { id: "p2" } },
    { action: "refresh" }
  ]);
  // The bridge's own normaliser accepts each as sent.
  for (const one of profiles.requests) {
    const normalized = bridge.normalizeArguments(one.action, one.args || {});
    assert.ok(!normalized.error, `${one.action}: ${normalized.error && normalized.error.message}`);
  }
});

test("no bridge answers unavailable, a rejecting bridge answers failed, an empty answer is said so - never a throw", async () => {
  assert.equal((await actions.save(null, "x")).code, "unavailable");
  assert.equal((await actions.save(null, "x")).message, actions.NO_BRIDGE);
  assert.equal((await actions.refreshBook(undefined)).code, "unavailable");
  const rejecting = { request: async () => { throw new Error("boom"); }, isConnected: () => true, getBook: () => bookOf(), capabilities: () => [] };
  const failed = await actions.remove(rejecting, "p1");
  assert.equal(failed.code, "failed");
  assert.equal(failed.message, "boom");
  const silent = { request: async () => null, isConnected: () => true, getBook: () => bookOf(), capabilities: () => [] };
  assert.equal((await actions.load(silent, "p1")).message, actions.WORDING.noAnswer);
});

test("a save that collides names the profile it collided with", async () => {
  const collide = { ok: false, code: "duplicate_name", message: "A profile with that name already exists.", field: "name" };
  const profiles = makeProfiles(bookOf(), { answer: action => (action === "saveCurrentWeights" ? collide : undefined) });
  const result = await actions.save(profiles, "standard  48IN");
  assert.equal(result.ok, false);
  assert.equal(result.code, "duplicate_name");
  assert.deepEqual(result.existing, { id: "p1", name: "Standard 48in" });
  assert.equal(result.field, "name");
  const missing = await actions.save(profiles, "Nothing like this");
  assert.equal(missing.existing, null);
  assert.equal(actions.findByName(bookOf(), " heavy   ROLLS ").id, "p2");
  assert.equal(actions.findByName(bookOf(), ""), null);
  assert.equal(actions.findById(bookOf(), "p2").name, "Heavy rolls");
  assert.equal(actions.findById(null, "p2"), null);
  assert.equal(actions.normalizedName("  A  B "), "a b");
});

test("abilities: read-only keeps only Refresh; no application, no line and a refresh in flight withhold what they must", () => {
  const live = makeProfiles(bookOf());
  const all = actions.can(live);
  assert.ok(Object.values(all).every(value => value === true), JSON.stringify(all));
  assert.deepEqual(Object.keys(all).sort(), ["duplicate", "load", "refresh", "remove", "rename", "replace", "save", "update"]);

  const readOnly = actions.can(live, { readOnly: true });
  assert.equal(readOnly.refresh, true);
  assert.ok(Object.keys(readOnly).filter(key => key !== "refresh").every(key => readOnly[key] === false));
  assert.equal(actions.reason(live, "load", { readOnly: true }), actions.READ_ONLY_REASON);
  assert.equal(actions.reason(live, "refresh", { readOnly: true }), "");

  assert.ok(Object.values(actions.can(null)).every(value => value === false));
  assert.match(actions.reason(null, "load"), /no application is connected/);
  const off = makeProfiles(bookOf(), { connected: false });
  assert.ok(Object.values(actions.can(off)).every(value => value === false));

  const unassigned = makeProfiles(bookOf({ assigned: false, workspace: null, profiles: [], count: 0 }));
  assert.ok(Object.values(actions.can(unassigned)).every(value => value === false));
  assert.match(actions.reason(unassigned, "save"), /not on a production line/);

  const busy = makeProfiles(bookOf({ refreshing: true }));
  assert.equal(actions.can(busy).refresh, false);
  assert.equal(actions.can(busy).load, true);
  assert.match(actions.reason(busy, "refresh"), /being read/);

  const partial = makeProfiles(bookOf(), { capabilities: ["loadWeightProfile", "refresh"] });
  assert.equal(actions.can(partial).load, true);
  assert.equal(actions.can(partial).save, false);
  assert.match(actions.reason(partial, "save"), /does not offer saveCurrentWeights/);
});
