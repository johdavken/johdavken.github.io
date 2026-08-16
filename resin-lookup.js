(function (root, factory) {
  const catalog = typeof module === "object" && module.exports
    ? require("./resin-catalog-service.js")
    : root.PolynResinCatalog;
  const api = factory(catalog);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynLookup = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (catalog) {
  "use strict";

  function normalizeSearch(value) {
    return String(value ?? "").trim().toLocaleUpperCase();
  }

  function currentResins(resins) {
    return Array.isArray(resins) ? resins : (catalog?.getResins?.() || []);
  }

  function findExactResin(value, resins) {
    const query = normalizeSearch(value);
    if (!query) return null;
    return currentResins(resins).find(resin => normalizeSearch(resin.resin_code) === query) || null;
  }

  function getResinNames(resins) {
    const seen = new Set();
    return currentResins(resins).reduce((names, resin) => {
      const code = String(resin?.resin_code ?? "").trim();
      const normalized = normalizeSearch(code);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        names.push(code);
      }
      return names;
    }, []);
  }

  function findResinSuggestions(value, limit = 20, resins) {
    const query = normalizeSearch(value);
    if (!query) return [];
    const exact = [];
    const codeStarts = [];
    const other = [];

    currentResins(resins).forEach(resin => {
      const code = normalizeSearch(resin.resin_code);
      if (code === query) exact.push(resin);
      else if (code.startsWith(query)) codeStarts.push(resin);
      else if (code.includes(query)) other.push(resin);
    });

    return [...exact, ...codeStarts, ...other].slice(0, Math.max(0, limit));
  }

  function formatResinResult(resin) {
    return {
      density: Number.isFinite(resin?.density_g_cm3) && resin.density_g_cm3 > 0
        ? `${resin.density_g_cm3.toFixed(3)} g/cm³`
        : "Unknown",
      bulkDensity: Number.isFinite(resin?.bulk_density_lb_ft3) && resin.bulk_density_lb_ft3 > 0
        ? `${resin.bulk_density_lb_ft3.toFixed(1)} lb/ft³`
        : "Unknown"
    };
  }

  return {
    normalizeSearch,
    getResinNames,
    findExactResin,
    findResinSuggestions,
    formatResinResult
  };
});
