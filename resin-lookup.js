(function (root, factory) {
  const data = typeof module === "object" && module.exports
    ? require("./resin-data.js")
    : root.RESIN_LOOKUP_DATA;
  const descriptionInformation = typeof module === "object" && module.exports
    ? require("./resin-description-info.js")
    : root.RESIN_DESCRIPTION_INFORMATION;
  const api = factory(data || [], descriptionInformation || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ResinIQLookup = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (resins, descriptionInformation) {
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

  const noDescriptionInformation = "No additional material information is currently available.";

  function getDescriptionInformation(description) {
    const normalizedDescription = normalizeSearch(description);
    if (!normalizedDescription) return noDescriptionInformation;
    const entries = Object.values(descriptionInformation);

    const exactMatch = entries.find(entry =>
      entry.exact.some(label => normalizeSearch(label) === normalizedDescription)
    );
    if (exactMatch) return exactMatch.information;

    const keywordMatch = entries.find(entry =>
      entry.keywords.some(keyword => normalizedDescription.includes(normalizeSearch(keyword)))
    );
    return keywordMatch?.information || noDescriptionInformation;
  }

  return {
    normalizeSearch,
    findExactResin,
    findResinSuggestions,
    formatResinResult,
    getDescriptionInformation,
    noDescriptionInformation
  };
});
