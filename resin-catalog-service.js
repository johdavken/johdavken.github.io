(function (root, factory) {
  const fallbackCatalog = typeof module === "object" && module.exports
    ? require("./resin-data.js")
    : root.RESIN_LOOKUP_DATA;
  const api = factory(fallbackCatalog || []);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynResinCatalog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (fallbackCatalog) {
  "use strict";

  const CACHE_KEY = "polyn.resinCatalog.v1";
  const CACHE_SCHEMA_VERSION = 1;
  const REMOTE_FIELDS = "id,resin_code,density_g_cm3,bulk_density_lb_ft3,is_active,updated_at";

  function normalizeCode(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function nullableText(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
  }

  function nullableDensity(value) {
    const density = typeof value === "number" ? value : Number.NaN;
    return Number.isFinite(density) && density > 0 ? density : null;
  }

  // Bulk density (lb/ft³) - a directly-measured trait of the resin,
  // distinct from density_g_cm3 (polymer density). Smart Hoppers requires
  // this to be set on a resin before it will compute that hopper's weight;
  // it never estimates bulk density from polymer density and a packing
  // factor (see smartHopperComputation in app.js).
  function nullableBulkDensity(value) {
    const bulkDensity = typeof value === "number" ? value : Number.NaN;
    return Number.isFinite(bulkDensity) && bulkDensity > 0 ? bulkDensity : null;
  }

  function normalizeResin(row, { fallback = false } = {}) {
    const resinCode = normalizeCode(fallback ? row?.code : row?.resin_code);
    if (!resinCode) return null;
    return {
      id: fallback ? null : nullableText(row?.id),
      resin_code: resinCode,
      density_g_cm3: nullableDensity(fallback ? row?.density : row?.density_g_cm3),
      bulk_density_lb_ft3: nullableBulkDensity(fallback ? row?.bulk_density : row?.bulk_density_lb_ft3),
      is_active: fallback ? true : (typeof row?.is_active === "boolean" ? row.is_active : null),
      updated_at: fallback ? null : nullableText(row?.updated_at)
    };
  }

  function sortResins(resins) {
    return resins.slice().sort((left, right) =>
      left.resin_code.localeCompare(right.resin_code, undefined, { sensitivity: "base" })
    );
  }

  function cloneResins(resins) {
    return resins.map(resin => ({ ...resin }));
  }

  function validCatalog(rows, { remote = false } = {}) {
    if (!Array.isArray(rows) || !rows.length) return null;
    const normalized = rows.map(row => normalizeResin(row, { fallback: !remote }));
    if (normalized.some(row => !row)) return null;
    if (remote && normalized.some(row => row.is_active !== true)) return null;
    const codes = new Set();
    for (const resin of normalized) {
      const key = resin.resin_code.toLocaleLowerCase();
      if (codes.has(key)) return null;
      codes.add(key);
    }
    return sortResins(normalized);
  }

  const normalizedFallback = validCatalog(fallbackCatalog) || [];

  function create(options = {}) {
    const storage = Object.prototype.hasOwnProperty.call(options, "storage")
      ? options.storage
      : (typeof localStorage !== "undefined" ? localStorage : null);
    const config = options.config || (() => globalThis.POLYN_SUPABASE_CONFIG || {})();
    const sdk = Object.prototype.hasOwnProperty.call(options, "supabaseLibrary")
      ? options.supabaseLibrary
      : globalThis.supabase;
    const fallback = validCatalog(options.fallbackCatalog || normalizedFallback, { remote: false }) || normalizedFallback;
    const listeners = new Set();
    let cachedCatalog;
    let cacheRead = false;
    let refreshInFlight = null;
    let client = options.client || null;

    function readCache() {
      if (cacheRead) return cachedCatalog;
      cacheRead = true;
      if (!storage?.getItem) return cachedCatalog;
      try {
        const raw = storage.getItem(CACHE_KEY);
        if (!raw) return cachedCatalog;
        const parsed = JSON.parse(raw);
        if (parsed?.version !== CACHE_SCHEMA_VERSION || !Number.isFinite(parsed.cachedAt) || parsed.cachedAt <= 0) return cachedCatalog;
        const catalog = validCatalog(parsed.resins, { remote: true });
        if (catalog) cachedCatalog = catalog;
      } catch (error) {}
      return cachedCatalog;
    }

    function writeCache(catalog) {
      if (!storage?.setItem) return false;
      try {
        storage.setItem(CACHE_KEY, JSON.stringify({
          version: CACHE_SCHEMA_VERSION,
          cachedAt: Date.now(),
          resins: catalog
        }));
        return true;
      } catch (error) {
        return false;
      }
    }

    function currentCatalog() {
      return readCache() || fallback;
    }

    function notify(result) {
      const snapshot = cloneResins(currentCatalog());
      listeners.forEach(listener => {
        try { listener(snapshot, result); } catch (error) {}
      });
    }

    function getClient() {
      if (client) return client;
      if (!config.enabled || !config.url || !config.publishableKey || !sdk?.createClient) return null;
      client = sdk.createClient(config.url, config.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
      return client;
    }

    function getResins() {
      const catalog = currentCatalog();
      void refreshResins();
      return cloneResins(catalog);
    }

    function getCachedResins() {
      const catalog = readCache();
      return catalog ? cloneResins(catalog) : null;
    }

    function getResinByCode(code) {
      const query = normalizeCode(code).toLocaleLowerCase();
      if (!query) return null;
      return getResins().find(resin => resin.resin_code.toLocaleLowerCase() === query) || null;
    }

    async function refreshResins() {
      if (refreshInFlight) return refreshInFlight;
      refreshInFlight = (async () => {
        try {
          const catalogClient = getClient();
          if (!catalogClient) return { loaded: false, resins: cloneResins(currentCatalog()), reason: "unavailable" };
          const response = await catalogClient
            .from("resins")
            .select(REMOTE_FIELDS)
            .eq("is_active", true)
            .order("resin_code", { ascending: true });
          if (response?.error) throw response.error;
          const catalog = validCatalog(response?.data, { remote: true });
          if (!catalog) return { loaded: false, resins: cloneResins(currentCatalog()), reason: "invalid-response" };
          cachedCatalog = catalog;
          cacheRead = true;
          writeCache(catalog);
          const result = { loaded: true, resins: cloneResins(catalog) };
          notify(result);
          return result;
        } catch (error) {
          return { loaded: false, resins: cloneResins(currentCatalog()), reason: "request-failed" };
        }
      })();
      try {
        return await refreshInFlight;
      } finally {
        refreshInFlight = null;
      }
    }

    function acceptConfirmedResin(row){
      const resin = normalizeResin(row, { fallback:false });
      if (!resin?.id || resin.is_active !== true) return false;
      const key = resin.resin_code.toLocaleLowerCase();
      const next = currentCatalog().filter(item => item.id !== resin.id
        && item.resin_code.toLocaleLowerCase() !== key);
      next.push(resin);
      cachedCatalog = sortResins(next);
      cacheRead = true;
      writeCache(cachedCatalog);
      notify({ loaded:true, reason:"confirmed-admin-update", resins:cloneResins(cachedCatalog) });
      return true;
    }

    function clearResinCache() {
      cachedCatalog = undefined;
      cacheRead = true;
      try { storage?.removeItem?.(CACHE_KEY); } catch (error) {}
    }

    function subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    return { getResins, getResinByCode, refreshResins, acceptConfirmedResin, getCachedResins, clearResinCache, subscribe };
  }

  const shared = create();
  return {
    CACHE_KEY,
    CACHE_SCHEMA_VERSION,
    REMOTE_FIELDS,
    normalizeResin,
    create,
    getResins: shared.getResins,
    getResinByCode: shared.getResinByCode,
    refreshResins: shared.refreshResins,
    acceptConfirmedResin: shared.acceptConfirmedResin,
    getCachedResins: shared.getCachedResins,
    clearResinCache: shared.clearResinCache,
    subscribe: shared.subscribe
  };
});
