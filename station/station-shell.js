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
   * the code that fills it cannot disagree about what exists.
   *
   * Four regions and nothing else: the header (with the job controls' slot
   * and the line console's slot), the machine stage, the run-down timeline
   * across the foot of the workspace, and the status bar. The earlier side
   * columns - a demo-configuration list on the left, an inspector on the
   * right - and the Current / Next recipe strip under the stage were taken
   * out (2026-09-12) so the stage has the whole width: configuration
   * switching is the workspace's job now, and the recipe readout will come
   * back in a different place and shape. Nothing here reserves space for
   * them. The timeline row is not a strip of that kind: it is an
   * operational view of the job the stage shows, one modest row deep, and
   * the stage keeps everything above it. */
  const MOUNTS = Object.freeze(["machine", "timeline", "status", "job", "connection"]);

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
    /* The job controls' slot: the line's output, the changeover and the
     * timeline's scale, filled by station-job-controls.js. A temporary
     * home in the header while the timeline is new. */
    header.appendChild(element(doc, "div", "station-header__job", { "data-station-mount": "job" }));
    /* The line console's slot, at the header's far end: the one place the
     * connection is shown, filled by station-sync-console.js when the
     * application publishes a connection and left empty otherwise. */
    header.appendChild(element(doc, "div", "station-header__connection", { "data-station-mount": "connection" }));
    shell.appendChild(header);

    shell.appendChild(element(doc, "section", "station-machine", {
      "data-station-mount": "machine", "aria-label": "Machine stage"
    }));

    /* The run-down timeline's row: no heading, no card - the timeline
     * itself (station-rundown-timeline.js) begins with its Now anchor. */
    shell.appendChild(element(doc, "section", "station-timeline", {
      "data-station-mount": "timeline", "aria-label": "Run-down timeline"
    }));

    shell.appendChild(element(doc, "footer", "station-status", { "data-station-mount": "status" }));

    root.appendChild(shell);
    return root;
  }

  return { MOUNTS, createShell };
});
