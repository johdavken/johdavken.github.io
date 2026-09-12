/* Station theme state.
 *
 * One controller owns one Station root's theme. It validates the stored
 * device-local preference, writes a single data-theme attribute, and tells
 * interested Station UI (currently Handbook > Appearance) when that value
 * changes. It knows no component colours; the theme stylesheets map the
 * selected id onto Station's semantic tokens.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationTheme = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "polyn.station.theme.v1";
  const DEFAULT_THEME = "industrial-dark";
  const THEMES = Object.freeze([
    Object.freeze({ id: "industrial-light", label: "Industrial Light", description: "Low-glare slate and steel for bright work areas." }),
    Object.freeze({ id: "industrial-dark", label: "Industrial Dark", description: "Graphite surfaces for long shifts in lower light." }),
    Object.freeze({ id: "gruvbox-dark", label: "Gruvbox Dark", description: "Warm charcoal, cream, and restrained earthy accents." })
  ]);
  const THEME_IDS = Object.freeze(THEMES.map(theme => theme.id));
  const VALID = new Set(THEME_IDS);

  function normalize(value) {
    return VALID.has(value) ? value : DEFAULT_THEME;
  }

  function read(storage) {
    if (!storage || typeof storage.getItem !== "function") return DEFAULT_THEME;
    try {
      return normalize(storage.getItem(STORAGE_KEY));
    } catch (error) {
      return DEFAULT_THEME;
    }
  }

  function write(storage, value) {
    if (!storage || typeof storage.setItem !== "function") return false;
    try {
      storage.setItem(STORAGE_KEY, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function create(element, storage) {
    if (!element || typeof element.setAttribute !== "function") return null;
    const listeners = new Set();
    let current = read(storage);

    function apply(value, options) {
      const next = normalize(value);
      const changed = next !== current || element.getAttribute("data-theme") !== next;
      current = next;
      element.setAttribute("data-theme", current);
      if (!options || options.persist !== false) write(storage, current);
      if (changed) {
        for (const listener of [...listeners]) {
          try { listener(current); } catch (error) { /* one view cannot stop the others */ }
        }
      }
      return current;
    }

    // Restore before any component is created. Hosted Station calls this
    // before appending its root; the standalone harness calls it in <head>.
    apply(current, { persist: false });

    return Object.freeze({
      getTheme: () => current,
      setTheme: value => apply(value),
      subscribe(listener) {
        if (typeof listener !== "function") return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    });
  }

  function initialize(element, environment) {
    let storage = null;
    try { storage = environment && environment.localStorage; } catch (error) { storage = null; }
    return create(element, storage);
  }

  return Object.freeze({ STORAGE_KEY, DEFAULT_THEME, THEMES, THEME_IDS, normalize, read, create, initialize });
});
