(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function writeJson(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  return { writeJson };
});
