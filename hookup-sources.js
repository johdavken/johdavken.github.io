(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynHookupSources = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Hookup source labels: where each resin is physically connected for the
  // Current recipe, and where it will be connected for the Next one. An
  // operator writes short free-form silo/box-line labels ("S11", "B3", "A")
  // that differ by line, so nothing here is validated against a fixed list.
  //
  // The store is position-keyed, never resin-keyed:
  //
  //   { current: { "<layer>:<index>": { resin, source }, ... },
  //     next:    { "<layer>:<index>": { resin, source }, ... } }
  //
  //   - "<layer>:<index>" is the physical hopper slot, the exact key the
  //     Timeline already uses (see nextResinByPosition / flat rows in app.js),
  //     so a Timeline row looks its label up directly.
  //   - `resin` records the code the label was entered against. When the live
  //     recipe puts a different resin in that slot the entry is dropped, so a
  //     changed resin never inherits the previous material's hookup.
  //   - The Hookups view groups positions by resin code for convenient entry
  //     and can apply one label to every matching slot, but the data stays
  //     per-position, so later per-hopper overrides remain possible.

  const RECIPE_KEYS = Object.freeze(["current", "next"]);
  const MAX_SOURCE_LENGTH = 24;

  function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function positionKey(layerName, index) {
    return `${layerName}:${index}`;
  }

  /**
   * Normalize an entered label: collapse whitespace, trim, uppercase, keep
   * only the characters operators actually write for a silo/box-line name
   * (alphanumerics plus a few separators), and cap the length. Stored
   * untruncated up to the cap - the input only shows a handful of characters.
   */
  function normalizeSource(value) {
    if (typeof value !== "string") return "";
    return value
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9 _.\-/]/g, "")
      .slice(0, MAX_SOURCE_LENGTH);
  }

  /**
   * Shape-sanitize a stored store. Mirrors rekeyLotMap in app.js: silently
   * drop anything malformed rather than reject the whole payload. An entry is
   * only kept when it has a non-empty normalized source.
   */
  function normalizeStore(raw) {
    const store = { current: {}, next: {} };
    if (!isPlainObject(raw)) return store;
    RECIPE_KEYS.forEach(recipeKey => {
      const map = raw[recipeKey];
      if (!isPlainObject(map)) return;
      Object.keys(map).forEach(key => {
        if (typeof key !== "string" || !key.includes(":")) return;
        const entry = map[key];
        if (!isPlainObject(entry)) return;
        const source = normalizeSource(entry.source);
        if (!source) return;
        const resin = typeof entry.resin === "string" ? entry.resin.trim() : "";
        store[recipeKey][key] = { resin, source };
      });
    });
    return store;
  }

  function readResin(hopper) {
    if (!isPlainObject(hopper)) return "";
    const raw = typeof hopper.resinName === "string"
      ? hopper.resinName
      : (typeof hopper.resin_name === "string" ? hopper.resin_name : "");
    return raw.trim();
  }

  function readPct(hopper) {
    const number = Number(isPlainObject(hopper) ? hopper.pct : 0);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  /**
   * The active positions of a recipe, as [{ key, layer, index, resin, pct }].
   * Accepts both the live layer shape (`resinName`) and the stored recipe
   * payload shape (`resin_name`). A slot is active when it carries a resin
   * code or a non-zero blend percentage - derived empty slots are skipped,
   * matching "only active/non-zero recipe entries".
   */
  function positionsFromLayers(layers) {
    const out = [];
    if (!Array.isArray(layers)) return out;
    layers.forEach(layer => {
      if (!isPlainObject(layer) || typeof layer.name !== "string") return;
      const hoppers = Array.isArray(layer.hoppers) ? layer.hoppers : [];
      hoppers.forEach((hopper, index) => {
        const resin = readResin(hopper);
        const pct = readPct(hopper);
        if (!resin && pct <= 0) return;
        out.push({ key: positionKey(layer.name, index), layer: layer.name, index, resin, pct });
      });
    });
    return out;
  }

  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      const out = {};
      Object.keys(value).sort().forEach(key => { out[key] = canonical(value[key]); });
      return out;
    }
    return value;
  }

  /**
   * Prune a store against the recipes as they stand now:
   *   - a position that no longer exists (or went inactive) loses its label
   *   - a position whose resin no longer matches the code the label was
   *     entered against loses its label
   * A blank stored resin (older data) is backfilled from the live position.
   * Returns { store, changed } - `changed` is true when anything was dropped,
   * backfilled, normalized, or discarded as malformed, so the caller knows
   * whether to persist and sync.
   */
  function reconcile(rawStore, positionsByRecipe) {
    const before = isPlainObject(rawStore)
      ? { current: isPlainObject(rawStore.current) ? rawStore.current : {}, next: isPlainObject(rawStore.next) ? rawStore.next : {} }
      : { current: {}, next: {} };
    const store = normalizeStore(rawStore);
    let changed = false;
    RECIPE_KEYS.forEach(recipeKey => {
      const positions = Array.isArray(positionsByRecipe && positionsByRecipe[recipeKey])
        ? positionsByRecipe[recipeKey]
        : [];
      const byKey = new Map(positions.map(position => [position.key, position]));
      Object.keys(store[recipeKey]).forEach(key => {
        const entry = store[recipeKey][key];
        const position = byKey.get(key);
        const stale = !position
          || (entry.resin && position.resin && entry.resin !== position.resin)
          || (entry.resin && !position.resin);
        if (stale) {
          delete store[recipeKey][key];
          changed = true;
          return;
        }
        if (!entry.resin && position.resin) {
          store[recipeKey][key] = { resin: position.resin, source: entry.source };
          changed = true;
        }
      });
    });
    if (!changed && JSON.stringify(canonical(store)) !== JSON.stringify(canonical(before))) {
      changed = true;
    }
    return { store, changed };
  }

  /**
   * Group active positions by visible resin code for the Hookups view.
   * Duplicate codes collapse to one row. `value` is the shared label when
   * every matching position agrees (or only one is set); `mixed` is true when
   * positions hold two or more different non-empty labels, which the UI must
   * surface rather than silently collapse.
   */
  function groupByResin(positions, map) {
    const safeMap = isPlainObject(map) ? map : {};
    const order = [];
    const groups = new Map();
    (Array.isArray(positions) ? positions : []).forEach(position => {
      const code = position.resin || "";
      if (!code) return;
      if (!groups.has(code)) {
        groups.set(code, { keys: [], sources: [] });
        order.push(code);
      }
      const group = groups.get(code);
      group.keys.push(position.key);
      const entry = safeMap[position.key];
      group.sources.push(entry && typeof entry.source === "string" ? entry.source : "");
    });
    return order.map(code => {
      const group = groups.get(code);
      const distinct = [...new Set(group.sources.filter(Boolean))];
      return {
        resin: code,
        keys: group.keys.slice(),
        sources: group.sources.slice(),
        value: distinct.length === 1 ? distinct[0] : "",
        mixed: distinct.length > 1
      };
    });
  }

  /**
   * Write one entered label to every hopper position in a grouped resin row.
   * An empty label clears those positions. Per-position structure is
   * preserved, so a later per-hopper override remains possible.
   */
  function applyGroup(rawStore, recipeKey, keys, resin, rawSource) {
    const store = normalizeStore(rawStore);
    if (!RECIPE_KEYS.includes(recipeKey) || !Array.isArray(keys)) return store;
    const source = normalizeSource(rawSource);
    const code = typeof resin === "string" ? resin.trim() : "";
    keys.forEach(key => {
      if (typeof key !== "string" || !key.includes(":")) return;
      if (source) store[recipeKey][key] = { resin: code, source };
      else delete store[recipeKey][key];
    });
    return store;
  }

  /** The label stored for one position, or "" - resin-guarded. */
  function sourceForPosition(map, key, resin) {
    if (!isPlainObject(map)) return "";
    const entry = map[key];
    if (!isPlainObject(entry)) return "";
    const code = typeof resin === "string" ? resin.trim() : "";
    if (entry.resin && code && entry.resin !== code) return "";
    return typeof entry.source === "string" ? entry.source : "";
  }

  function emptyStore() {
    return { current: {}, next: {} };
  }

  return {
    RECIPE_KEYS,
    MAX_SOURCE_LENGTH,
    emptyStore,
    positionKey,
    normalizeSource,
    normalizeStore,
    positionsFromLayers,
    reconcile,
    groupByResin,
    applyGroup,
    sourceForPosition
  };
});
