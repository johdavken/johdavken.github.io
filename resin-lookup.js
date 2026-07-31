(function (root, factory) {
  const data = typeof module === "object" && module.exports
    ? require("./resin-data.js")
    : root.RESIN_LOOKUP_DATA;
  const api = factory(data || []);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ResinIQLookup = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (resins) {
  "use strict";

  function normalizeSearch(value) {
    return String(value ?? "").trim().toLocaleUpperCase();
  }

  function findExactResin(value) {
    const query = normalizeSearch(value);
    if (!query) return null;
    return resins.find(resin => normalizeSearch(resin.code) === query) || null;
  }

  function findResinSuggestions(value, limit = 20) {
    const query = normalizeSearch(value);
    if (!query) return [];
    const exact = [];
    const codeStarts = [];
    const other = [];

    resins.forEach(resin => {
      const code = normalizeSearch(resin.code);
      const description = normalizeSearch(resin.description);
      if (code === query) exact.push(resin);
      else if (code.startsWith(query)) codeStarts.push(resin);
      else if (code.includes(query) || description.includes(query)) other.push(resin);
    });

    return [...exact, ...codeStarts, ...other].slice(0, Math.max(0, limit));
  }

  function formatResinResult(resin) {
    return {
      description: resin?.description || "Unknown",
      density: Number.isFinite(resin?.density) && resin.density > 0
        ? `${resin.density.toFixed(3)} g/cm³`
        : "Unknown"
    };
  }

  return { normalizeSearch, findExactResin, findResinSuggestions, formatResinResult };
});
