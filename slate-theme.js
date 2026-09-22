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
  const DEFAULT_THEME = "yaru-dark";
  /* The registry, in gallery order: every family as a pair, its light
   * over its dark. Each is a well-known palette mapped onto Slate's
   * contract; these are Slate's own files, not Station's. */
  const THEMES = Object.freeze([
    Object.freeze({ id: "yaru-light", label: "Yaru Light", scheme: "light", description: "Cool white, near-black text, Ubuntu orange." }),
    Object.freeze({ id: "yaru-dark", label: "Yaru Dark", scheme: "dark", description: "Neutral graphite, white text, Ubuntu orange." }),
    Object.freeze({ id: "rose-pine-light", label: "Rosé Pine Dawn", scheme: "light", description: "Warm parchment, ink-violet text, pine accent." }),
    Object.freeze({ id: "rose-pine-dark", label: "Rosé Pine Moon", scheme: "dark", description: "Dusk violet, lilac-white text, pine accent." }),
    Object.freeze({ id: "tokyo-night-light", label: "Tokyo Night Day", scheme: "light", description: "Cool grey, navy text, blue accent." }),
    Object.freeze({ id: "tokyo-night-dark", label: "Tokyo Night", scheme: "dark", description: "Deep blue-black, lavender text, blue accent." }),
    Object.freeze({ id: "gruvbox-light", label: "Gruvbox Light", scheme: "light", description: "Cream, dark-brown text, faded-blue accent." }),
    Object.freeze({ id: "gruvbox-dark", label: "Gruvbox Dark", scheme: "dark", description: "Warm charcoal, sand text, blue-teal accent." }),
    Object.freeze({ id: "everforest-light", label: "Everforest Light", scheme: "light", description: "Paper, slate-green text, blue accent." }),
    Object.freeze({ id: "everforest-dark", label: "Everforest Dark", scheme: "dark", description: "Green-grey, parchment text, blue accent." }),
    Object.freeze({ id: "catppuccin-light", label: "Catppuccin Latte", scheme: "light", description: "Cool white, ink-grey text, blue accent." }),
    Object.freeze({ id: "catppuccin-dark", label: "Catppuccin Mocha", scheme: "dark", description: "Soft navy, pale text, blue accent." }),
    Object.freeze({ id: "retro-82-light", label: "Retro 82 Light", scheme: "light", description: "Cream, navy text, orange accent." }),
    Object.freeze({ id: "retro-82-dark", label: "Retro 82 Dark", scheme: "dark", description: "Deep navy, cream text, orange accent." })
  ]);
  const THEME_IDS = Object.freeze(THEMES.map(theme => theme.id));
  const VALID = new Set(THEME_IDS);
  /* The ids the six single themes carried before each family had both
   * halves: a device that saved one keeps the palette it chose. */
  const RENAMED = Object.freeze({
    "rose-pine": "rose-pine-light", "tokyo-night": "tokyo-night-dark", "gruvbox": "gruvbox-dark",
    "everforest": "everforest-dark", "catppuccin": "catppuccin-dark", "retro-82": "retro-82-dark"
  });

  function normalize(value) {
    if (VALID.has(value)) return value;
    if (typeof value === "string" && Object.prototype.hasOwnProperty.call(RENAMED, value)) return RENAMED[value];
    return DEFAULT_THEME;
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
