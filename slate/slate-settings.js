/* The Settings section: the theme, read-only, the tracking mode, and
 * room for what comes after them.
 *
 * The theme picker drives the controller slate-host.js (or the harness)
 * created on the root; the controller writes the attribute and the
 * preference, this only asks. Later preferences take their place beside
 * it as further groups.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    return node;
  }

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {object|null} ctx.theme    the theme controller {getTheme, setTheme, subscribe}
   * @param {object[]} [ctx.themes]    the registry (PolynSlateTheme.THEMES)
   * @param {object|null} [ctx.display] the display controller {getReadOnlyMode, setReadOnly, getTrackingMode, setTrackingMode, subscribe}
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const controller = settings.theme || null;
    const themes = Array.isArray(settings.themes) ? settings.themes : [];

    const rootEl = element(doc, "div", "slate-settings");

    const bar = element(doc, "div", "slate-section__bar");
    bar.appendChild(text(doc, "p", "slate-section__subtitle", "Preferences for this device. Nothing here is shared."));
    rootEl.appendChild(bar);

    // Appearance.
    const appearance = element(doc, "section", "slate-settings__group", { "aria-label": "Appearance" });
    appearance.appendChild(text(doc, "h2", "slate-settings__heading", "Appearance"));
    const gallery = element(doc, "div", "slate-settings__themes", { role: "radiogroup", "aria-label": "Theme" });
    const tiles = new Map();
    for (const item of themes) {
      const tile = element(doc, "button", "slate-theme-tile", { type: "button", role: "radio", "aria-checked": "false", "data-theme-choice": item.id });
      const swatch = element(doc, "span", "slate-theme-tile__swatch slate-theme-scope", { "data-theme": item.id, "aria-hidden": "true" });
      swatch.appendChild(element(doc, "span", "slate-theme-tile__swatch-bar"));
      swatch.appendChild(element(doc, "span", "slate-theme-tile__swatch-accent"));
      const preview = element(doc, "span", "slate-theme-tile__preview");
      preview.appendChild(element(doc, "span", "slate-theme-tile__preview-title"));
      preview.appendChild(element(doc, "span", "slate-theme-tile__preview-copy"));
      const previewStatus = element(doc, "span", "slate-theme-tile__preview-status");
      previewStatus.appendChild(element(doc, "span", "slate-theme-tile__preview-status-dot"));
      previewStatus.appendChild(element(doc, "span", "slate-theme-tile__preview-status-label"));
      preview.appendChild(previewStatus);
      preview.appendChild(element(doc, "span", "slate-theme-tile__preview-action"));
      swatch.appendChild(preview);
      tile.appendChild(text(doc, "span", "slate-theme-tile__selected-mark", "✓", { "aria-hidden": "true" }));
      tile.appendChild(swatch);
      tile.appendChild(text(doc, "span", "slate-theme-tile__name", item.label));
      tile.appendChild(text(doc, "span", "slate-theme-tile__description", item.description || ""));
      tile.addEventListener("click", () => { if (controller) controller.setTheme(item.id); });
      tiles.set(item.id, tile);
      gallery.appendChild(tile);
    }
    appearance.appendChild(gallery);
    if (!controller) appearance.appendChild(text(doc, "p", "slate-settings__note", "The theme cannot be changed on this page."));
    rootEl.appendChild(appearance);

    // Safety: read-only mode.
    const display = settings.display || null;
    const safety = element(doc, "section", "slate-settings__group", { "aria-label": "Safety" });
    safety.appendChild(text(doc, "h2", "slate-settings__heading", "Safety"));
    safety.appendChild(text(doc, "p", "slate-settings__lead", "Read-only keeps Slate from changing the line's job: the recipe, the plan, tracking, pump-off, the changeover and the output stay as they are. Connecting to and leaving lines is not affected."));
    const modes = element(doc, "div", "slate-settings__modes", { role: "radiogroup", "aria-label": "Read-only" });
    const modeButtons = new Map();
    for (const [mode, label, note] of [["auto", "Automatic", "Read-only whenever a line is linked; writable on this device's own session."], ["on", "On", "Always read-only."], ["off", "Off", "Always writable."]]) {
      const button = element(doc, "button", "slate-settings__mode", { type: "button", role: "radio", "aria-checked": "false", "data-readonly-mode": mode });
      button.appendChild(text(doc, "span", "slate-settings__mode-label", label));
      button.appendChild(text(doc, "span", "slate-settings__mode-note", note));
      button.addEventListener("click", () => { if (display) display.setReadOnly(mode); });
      modeButtons.set(mode, button);
      modes.appendChild(button);
    }
    safety.appendChild(modes);
    if (!display) safety.appendChild(text(doc, "p", "slate-settings__note", "Read-only cannot be changed on this page."));
    rootEl.appendChild(safety);

    // Tracking: how the Track toggle is offered.
    const tracking = element(doc, "section", "slate-settings__group", { "aria-label": "Tracking" });
    tracking.appendChild(text(doc, "h2", "slate-settings__heading", "Tracking"));
    tracking.appendChild(text(doc, "p", "slate-settings__lead", "How the recipe offers Track on each hopper. Automatic tracks hoppers whose resin changes at the changeover for you and only ever turns tracking on; it needs Slate writable (Read-only Off) and changes nothing otherwise."));
    const trackingModes = element(doc, "div", "slate-settings__modes", { role: "radiogroup", "aria-label": "Tracking" });
    const trackingButtons = new Map();
    for (const [mode, label, note] of [
      ["automatic", "Automatic", "No Track toggles. Once a Next Recipe swaps or empties a hopper's resin, that hopper is tracked at once. Reset tracking clears pump-off; those hoppers are tracked again."],
      ["assisted", "Assisted", "Track is offered where a Next Recipe swaps or empties the resin, and everywhere without a plan."],
      ["manual", "Manual", "Track is offered on every hopper, whatever is planned."]
    ]) {
      const button = element(doc, "button", "slate-settings__mode", { type: "button", role: "radio", "aria-checked": "false", "data-tracking-mode": mode });
      button.appendChild(text(doc, "span", "slate-settings__mode-label", label));
      button.appendChild(text(doc, "span", "slate-settings__mode-note", note));
      button.addEventListener("click", () => { if (display && typeof display.setTrackingMode === "function") display.setTrackingMode(mode); });
      trackingButtons.set(mode, button);
      trackingModes.appendChild(button);
    }
    tracking.appendChild(trackingModes);
    if (!display) tracking.appendChild(text(doc, "p", "slate-settings__note", "Tracking cannot be changed on this page."));
    rootEl.appendChild(tracking);

    // What comes next.
    const later = element(doc, "section", "slate-settings__group", { "aria-label": "More settings" });
    later.appendChild(text(doc, "h2", "slate-settings__heading", "More"));
    later.appendChild(text(doc, "p", "slate-stub", "Display and workflow preferences arrive in later phases."));
    rootEl.appendChild(later);

    function paint() {
      const selected = controller ? controller.getTheme() : null;
      for (const [id, tile] of tiles) {
        const on = id === selected;
        tile.setAttribute("aria-checked", on ? "true" : "false");
        tile.classList.toggle("is-selected", on);
      }
      const mode = display ? display.getReadOnlyMode() : null;
      for (const [id, button] of modeButtons) {
        const on = id === mode;
        button.setAttribute("aria-checked", on ? "true" : "false");
        button.classList.toggle("is-selected", on);
      }
      const trackingMode = display && typeof display.getTrackingMode === "function" ? display.getTrackingMode() : null;
      for (const [id, button] of trackingButtons) {
        const on = id === trackingMode;
        button.setAttribute("aria-checked", on ? "true" : "false");
        button.classList.toggle("is-selected", on);
      }
    }

    if (controller && typeof controller.subscribe === "function") controller.subscribe(paint);
    if (display && typeof display.subscribe === "function") display.subscribe(paint);
    paint();

    return Object.freeze({ element: rootEl, paint, tile: id => tiles.get(id) || null, mode: id => modeButtons.get(id) || null, trackingMode: id => trackingButtons.get(id) || null });
  }

  return Object.freeze({ create });
});
