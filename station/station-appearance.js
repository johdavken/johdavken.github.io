/* Operator Handbook > Appearance.
 *
 * A small view over the Station theme controller: it owns no preference and
 * no palette. Choosing a row asks the controller to change the authoritative
 * root attribute immediately; CSS does the rest.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationAppearance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  function create(doc, context) {
    const controller = context && context.theme;
    const registry = context && Array.isArray(context.themes) ? context.themes : [];
    const rootEl = element(doc, "div", "station-appearance");
    const intro = element(doc, "div", "station-appearance__intro");
    intro.appendChild(text(doc, "h2", "station-appearance__title", "Appearance"));
    intro.appendChild(text(doc, "p", "station-appearance__copy",
      "Choose this Station's display theme. The preference stays on this device."));
    rootEl.appendChild(intro);

    const choices = element(doc, "div", "station-appearance__choices", { role: "radiogroup", "aria-label": "Station theme" });
    const buttons = new Map();
    for (const theme of registry) {
      const button = element(doc, "button", "station-appearance__choice", {
        type: "button", role: "radio", "aria-checked": "false", "data-theme-choice": theme.id
      });
      const mark = element(doc, "span", "station-appearance__mark", { "aria-hidden": "true" });
      const words = element(doc, "span", "station-appearance__words");
      words.appendChild(text(doc, "span", "station-appearance__name", theme.label));
      words.appendChild(text(doc, "span", "station-appearance__description", theme.description));
      button.appendChild(mark);
      button.appendChild(words);
      button.addEventListener("click", () => {
        if (controller && typeof controller.setTheme === "function") controller.setTheme(theme.id);
        update();
      });
      choices.appendChild(button);
      buttons.set(theme.id, button);
    }
    rootEl.appendChild(choices);

    function update() {
      const selected = controller && typeof controller.getTheme === "function" ? controller.getTheme() : "";
      for (const [id, button] of buttons) button.setAttribute("aria-checked", id === selected ? "true" : "false");
    }

    update();
    return { element: rootEl, update, focus() { const selected = buttons.get(controller?.getTheme?.()); if (selected) selected.focus(); } };
  }

  return Object.freeze({
    section: Object.freeze({ id: "appearance", title: "Appearance", create })
  });
});
