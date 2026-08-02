const test = require("node:test");
const assert = require("node:assert/strict");
const service = require("./resin-catalog-service.js");

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

const fallback = Object.freeze([
  { code: "FALLBACK-A", description: "Fallback", density: 0.918 },
  { code: "FALLBACK-B", description: null, density: null }
]);

function cachedEnvelope(resins, version = service.CACHE_SCHEMA_VERSION) {
  return JSON.stringify({ version, cachedAt: Date.now(), resins });
}

const cachedResin = {
  id: "cached-id",
  resin_code: "CACHED-A",
  display_description: null,
  density_g_cm3: 0.925,
  information_description: null,
  is_active: true,
  updated_at: null
};

function remoteClient({ data = [], error = null, onQuery } = {}) {
  return {
    from(table) {
      assert.equal(table, "resins");
      return {
        select(fields) {
          onQuery?.("select", fields);
          return this;
        },
        eq(field, value) {
          onQuery?.("eq", [field, value]);
          return this;
        },
        async order(field, options) {
          onQuery?.("order", [field, options]);
          return { data, error };
        }
      };
    }
  };
}

test("loads a valid versioned cache before using the fallback", () => {
  const storage = createStorage({ [service.CACHE_KEY]: cachedEnvelope([cachedResin]) });
  const catalog = service.create({ storage, fallbackCatalog: fallback, config: { enabled: false } });
  assert.deepEqual(catalog.getCachedResins(), [cachedResin]);
  assert.equal(catalog.getResins()[0].resin_code, "CACHED-A");
});

test("malformed cache and incompatible versions fall back safely", () => {
  for (const value of ["{not json", cachedEnvelope([cachedResin], 999)]) {
    const storage = createStorage({ [service.CACHE_KEY]: value });
    const catalog = service.create({ storage, fallbackCatalog: fallback, config: { enabled: false } });
    assert.equal(catalog.getCachedResins(), null);
    assert.deepEqual(catalog.getResins().map(resin => resin.resin_code), ["FALLBACK-A", "FALLBACK-B"]);
  }
});

test("refreshes active Supabase rows, normalizes them, and updates the cache", async () => {
  const storage = createStorage();
  const events = [];
  const remote = [
    { id: "2", resin_code: "z-code", display_description: null, density_g_cm3: null, information_description: null, is_active: true, updated_at: null },
    { id: "1", resin_code: "A-code", display_description: "Remote", density_g_cm3: 0.912, information_description: "Details", is_active: true, updated_at: "2026-08-02T00:00:00Z" }
  ];
  const catalog = service.create({ storage, fallbackCatalog: fallback, config: { enabled: true }, client: remoteClient({ data: remote, onQuery: (...event) => events.push(event) }) });
  let notification;
  catalog.subscribe((resins, result) => { notification = { resins, result }; });

  const result = await catalog.refreshResins();
  assert.equal(result.loaded, true);
  assert.deepEqual(result.resins.map(resin => resin.resin_code), ["A-code", "z-code"]);
  assert.equal(catalog.getCachedResins()[0].information_description, "Details");
  assert.equal(notification.result.loaded, true);
  assert.deepEqual(events, [
    ["select", service.REMOTE_FIELDS],
    ["eq", ["is_active", true]],
    ["order", ["resin_code", { ascending: true }]]
  ]);
});

test("a failed refresh preserves the last valid cache", async () => {
  const storage = createStorage({ [service.CACHE_KEY]: cachedEnvelope([cachedResin]) });
  const catalog = service.create({
    storage,
    fallbackCatalog: fallback,
    config: { enabled: true },
    client: remoteClient({ error: new Error("offline") })
  });
  const result = await catalog.refreshResins();
  assert.equal(result.loaded, false);
  assert.equal(result.reason, "request-failed");
  assert.deepEqual(catalog.getCachedResins(), [cachedResin]);
});

test("a malformed refresh response preserves the last valid cache", async () => {
  const storage = createStorage({ [service.CACHE_KEY]: cachedEnvelope([cachedResin]) });
  const catalog = service.create({
    storage,
    fallbackCatalog: fallback,
    config: { enabled: true },
    client: remoteClient({ data: [{ resin_code: "missing-active-status" }] })
  });
  const result = await catalog.refreshResins();
  assert.equal(result.loaded, false);
  assert.equal(result.reason, "invalid-response");
  assert.deepEqual(catalog.getCachedResins(), [cachedResin]);
});

test("looks up resin codes without regard to case or surrounding whitespace", () => {
  const catalog = service.create({ storage: createStorage(), fallbackCatalog: fallback, config: { enabled: false } });
  assert.equal(catalog.getResinByCode("  fallback-a ").resin_code, "FALLBACK-A");
  assert.equal(catalog.getResinByCode("missing"), null);
});

test("normalization retains unknown values as null", () => {
  assert.deepEqual(service.normalizeResin({ resin_code: "UNKNOWN", density_g_cm3: 0, is_active: "yes" }), {
    id: null,
    resin_code: "UNKNOWN",
    display_description: null,
    density_g_cm3: null,
    information_description: null,
    is_active: null,
    updated_at: null
  });
});

test("the fallback retains existing rule-derived material information", () => {
  const catalog = service.create({ storage: null, config: { enabled: false } });
  assert.match(catalog.getResinByCode("MS0440").information_description, /hexene as the comonomer/i);
});

test("works with unavailable Supabase and localStorage", async () => {
  const catalog = service.create({ storage: null, fallbackCatalog: fallback, config: { enabled: true }, supabaseLibrary: null });
  assert.deepEqual(catalog.getResins().map(resin => resin.resin_code), ["FALLBACK-A", "FALLBACK-B"]);
  const result = await catalog.refreshResins();
  assert.equal(result.loaded, false);
  assert.equal(result.reason, "unavailable");
});
