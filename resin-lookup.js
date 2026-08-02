(function (root, factory) {
  const catalog = typeof module === "object" && module.exports
    ? require("./resin-catalog-service.js")
    : root.PolynResinCatalog;
  const descriptionInformation = typeof module === "object" && module.exports
    ? require("./resin-description-info.js")
    : root.RESIN_DESCRIPTION_INFORMATION;
  const api = factory(catalog, descriptionInformation || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynLookup = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (catalog, descriptionInformation) {
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
      const description = normalizeSearch(resin.display_description);
      if (code === query) exact.push(resin);
      else if (code.startsWith(query)) codeStarts.push(resin);
      else if (code.includes(query) || description.includes(query)) other.push(resin);
    });

    return [...exact, ...codeStarts, ...other].slice(0, Math.max(0, limit));
  }

  function formatResinResult(resin) {
    return {
      description: resin?.display_description || "Unknown",
      density: Number.isFinite(resin?.density_g_cm3) && resin.density_g_cm3 > 0
        ? `${resin.density_g_cm3.toFixed(3)} g/cm³`
        : "Unknown"
    };
  }

  const noDescriptionInformation = "No additional material information is currently available.";

  function findDescriptionInformationEntry(description, code = "") {
    const normalizedDescription = normalizeSearch(description);
    const normalizedCode = normalizeSearch(code);
    if (!normalizedDescription && !normalizedCode) return null;
    const entries = Object.values(descriptionInformation);

    const exactMatch = entries.find(entry =>
      entry.exact.some(label => normalizeSearch(label) === normalizedDescription)
    );
    if (exactMatch) return exactMatch;

    const keywordMatch = entries.find(entry =>
      entry.keywords.some(keyword => {
        const normalizedKeyword = normalizeSearch(keyword);
        return normalizedDescription.includes(normalizedKeyword) || normalizedCode.includes(normalizedKeyword);
      })
    );
    return keywordMatch || null;
  }

  function getDescriptionDetails(description, code = "") {
    const entry = findDescriptionInformationEntry(description, code);
    return {
      information: entry?.information || noDescriptionInformation,
      typicalUses: entry?.typicalUses || null
    };
  }

  function getDescriptionInformation(description, code = "") {
    return getDescriptionDetails(description, code).information;
  }

  function getResinDetails(resin) {
    const details = getDescriptionDetails(resin?.display_description, resin?.resin_code);
    return {
      information: resin?.information_description || details.information,
      typicalUses: details.typicalUses
    };
  }

  return {
    normalizeSearch,
    getResinNames,
    findExactResin,
    findResinSuggestions,
    formatResinResult,
    getResinDetails,
    getDescriptionInformation,
    getDescriptionDetails,
    noDescriptionInformation
  };
});
