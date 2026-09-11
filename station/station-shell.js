/* The Station shell, as a DOM builder rather than as markup.
 *
 * WHY THIS IS JAVASCRIPT AND NOT HTML
 *
 * Station runs in two places: the standalone harness at station/station.html,
 * and inside the real application at /?view=station. Those two need the same
 * shell. Written as markup it would have to exist twice, and the copy nobody
 * is looking at would drift - which is exactly the fork this project keeps
 * saying it does not want. Written once as a builder, both hosts call it and
 * there is no second version to drift.
 *
 * The builder takes its document, like station-render.js does, so the shell
 * can be built and inspected in tests without a browser.
 *
 * ELEMENT CHOICES ARE NOT ARBITRARY
 *
 * The machine area is a <section>, not a <main>. Two reasons, both about
 * living inside the application's document: the application already has its
 * own <main> and a second one is invalid, and the legacy stylesheet styles
 * bare `main` - so a Station <main> would inherit the application's grid.
 * <section> with an aria-label is still a landmark, and nothing bare-styles
 * it. station-host-isolation.test.js pins this.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationShell = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Every mount point the boot file looks for. Named here so the shell and
   * the code that fills it cannot disagree about what exists. */
  const MOUNTS = Object.freeze(["nav", "machine", "recipe-strip", "inspector", "status"]);

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) {
      for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    }
    return node;
  }

  function text(doc, name, className, value) {
    const node = element(doc, name, className);
    node.textContent = value;
    return node;
  }

  /**
   * Build the Station shell.
   *
   * Returns a single detached element carrying `station-root` - the class that
   * defines the design tokens - so whichever host appends it gets the whole
   * token scope with it and never has to remember to add one.
   *
   * @param {Document} doc
   * @param {object} [options]
   * @param {string[]} [options.tags]  Short labels in the header, e.g. ["Live"].
   */
  function createShell(doc, options) {
    const settings = options || {};
    const root = element(doc, "div", "station-root", { "data-station-app": "" });

    root.appendChild(text(doc, "p", "station-too-small",
      "Station is a desktop console and needs a window at least 1100px wide. Use Resin.Tools on this device instead."));

    const shell = element(doc, "div", "station-shell");

    const header = element(doc, "header", "station-header");
    header.appendChild(text(doc, "h1", "station-header__title", "Station"));
    const tags = Array.isArray(settings.tags) ? settings.tags : ["Experimental"];
    for (const tag of tags) header.appendChild(text(doc, "span", "station-header__tag", tag));
    shell.appendChild(header);

    const sidebar = element(doc, "nav", "station-sidebar", { "aria-label": "Line configuration" });
    sidebar.appendChild(text(doc, "h2", "station-section__heading", "Demo configurations"));
    sidebar.appendChild(element(doc, "div", "station-nav", { "data-station-mount": "nav" }));
    shell.appendChild(sidebar);

    shell.appendChild(element(doc, "section", "station-machine", {
      "data-station-mount": "machine", "aria-label": "Machine stage"
    }));

    shell.appendChild(element(doc, "section", "station-recipe-strip", {
      "data-station-mount": "recipe-strip", "aria-label": "Recipe state"
    }));

    const inspector = element(doc, "aside", "station-inspector", { "aria-label": "Inspector" });
    inspector.appendChild(text(doc, "h2", "station-section__heading", "Configuration"));
    inspector.appendChild(element(doc, "div", "", { "data-station-mount": "inspector" }));
    shell.appendChild(inspector);

    shell.appendChild(element(doc, "footer", "station-status", { "data-station-mount": "status" }));

    root.appendChild(shell);
    return root;
  }

  return { MOUNTS, createShell };
});
