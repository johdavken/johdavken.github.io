/* Slate theme state.
 *
 * One controller owns one Slate root's theme. It validates the stored
 * device-local preference, writes a single data-theme attribute, and tells
 * interested Slate UI (Settings) when that value changes. It knows no
 * component colours; the theme stylesheets map the selected id onto Slate's
 * semantic tokens.
 *
 * Slate's preference is its own (polyn.slate.theme.v1): choosing a theme
 * here recolours neither Station nor the application hidden behind it.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateTheme = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "polyn.slate.theme.v1";
  const DEFAULT_THEME = "yaru-light";
  /* The registry, in gallery order: a light theme over its dark one.
   * Yaru is Ubuntu's palette, mapped onto Slate's contract. */
  const THEMES = Object.freeze([
    Object.freeze({ id: "yaru-light", label: "Yaru Light", scheme: "light", description: "Cool white, near-black text, Ubuntu orange." }),
    Object.freeze({ id: "yaru-dark", label: "Yaru Dark", scheme: "dark", description: "Neutral graphite, white text, Ubuntu orange." })
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

    // Restore before any component is created. Hosted Slate calls this
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
