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
  const logo = typeof require === "function"
    ? require("./station-logo.js")
    : (root && root.PolynStationLogo);
  const api = factory(logo);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationShell = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (logoModule) {
  "use strict";

  /* Every mount point the boot file looks for. Named here so the shell and
   * the code that fills it cannot disagree about what exists.
   *
   * Four regions and nothing else: the header (with the job controls' slot,
   * the hopper editor's slot and the line console's slot), the machine stage, the run-down timeline
   * across the foot of the workspace, and the status bar - plus three slots
   * that are not regions: the Operator Handbook's, the utility surfaces'
   * and the machine utility rail's, all laid over the stage's own cell
   * (see below). The earlier side
   * columns - a demo-configuration list on the left, an inspector on the
   * right - and the Current / Next recipe strip under the stage were taken
   * out (2026-09-12) so the stage has the whole width: configuration
   * switching is the workspace's job now, and the recipe readout will come
   * back in a different place and shape. Nothing here reserves space for
   * them. The timeline row is not a strip of that kind: it is an
   * operational view of the job the stage shows, one modest row deep, and
   * the stage keeps everything above it. */
  const MOUNTS = Object.freeze(["avatar", "machine", "timeline", "status", "job", "edit", "connection", "handbook", "utility", "rail"]);

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) {
      for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    }
    return node;
  }

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  /* THE WAY BACK
   *
   * Station and the legacy interface coexist on one page: the application
   * host is index.html, and ?view=station is the one flag that makes it
   * show Station instead (station-host.js does nothing without it). So the
   * route back is that same URL without the flag - nothing is redirected,
   * nothing else about the address is touched, and the application starts
   * exactly as it does for anyone who never asked for Station. On the
   * standalone harness (station/station.html), which has no application,
   * the route is the application's page beside it.
   *
   * @param {string} [href]  the page's own URL
   * @returns {string} a relative href for the legacy interface
   */
  const HARNESS_LEGACY = "../index.html";
  function legacyHref(href) {
    let url;
    try {
      url = new URL(String(href));
    } catch (error) {
      return HARNESS_LEGACY;
    }
    if (url.searchParams.get("view") !== "station") return HARNESS_LEGACY;
    url.searchParams.delete("view");
    return url.pathname + url.search + url.hash;
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
   * @param {string} [options.legacy]  the href of the legacy interface; by
   *        default derived from the document's own location (legacyHref)
   */
  function createShell(doc, options) {
    const settings = options || {};
    const root = element(doc, "div", "station-root", { "data-station-app": "" });

    root.appendChild(text(doc, "p", "station-too-small",
      "Station is a desktop console and needs a window at least 1100px wide. Use Resin.Tools on this device instead."));

    const shell = element(doc, "div", "station-shell");

    /* The header: identity, the way back, the job's two line-wide readouts,
     * and the connection at the far end. Nothing else lives here. */
    const header = element(doc, "header", "station-header");
    /* Station's picture, before the name: the slot station-avatar.js fills
     * with the face and the larger picture it opens. A slot rather than
     * the picture itself, as the job readouts and the line console are,
     * so the shell stays structure and the open/close behaviour stays
     * with the module that owns it. */
    header.appendChild(element(doc, "div", "station-header__avatar", { "data-station-mount": "avatar" }));
    /* The name, as the logo (station-logo.js): the mark and the word
     * STATION drawn inline so they take the theme, inside the heading
     * that names the page. Without the module (a host that did not load
     * it) the word is set in type, as it was. */
    const title = element(doc, "h1", "station-header__title");
    if (logoModule && typeof logoModule.create === "function") title.appendChild(logoModule.create(doc, { label: "Station" }));
    else title.textContent = "Station";
    header.appendChild(title);
    /* Beside the name, the way back to the legacy interface: a plain link,
     * quiet by design - text, not a button, no explanation - so it is
     * there when wanted and never competes with the readouts. */
    const legacy = typeof settings.legacy === "string" && settings.legacy
      ? settings.legacy
      : legacyHref(doc.location && doc.location.href);
    header.appendChild(text(doc, "a", "station-header__legacy", "Legacy", {
      href: legacy, "data-action": "legacy", title: "Resin.Tools, the legacy interface"
    }));
    /* The job controls' slot: the line's output and the changeover, filled
     * by station-job-controls.js. */
    header.appendChild(element(doc, "div", "station-header__job", { "data-station-mount": "job" }));
    /* The hopper editor's slot, to the right of the job readouts: the
     * selected hoppers' resin and percentage (station-hopper-edit.js),
     * shown while a card's badge is selected and empty otherwise. */
    header.appendChild(element(doc, "div", "station-header__edit", { "data-station-mount": "edit" }));
    /* The line console's slot, at the header's far end: the one place the
     * connection is shown, filled by station-sync-console.js when the
     * application publishes a connection and left empty otherwise. */
    header.appendChild(element(doc, "div", "station-header__connection", { "data-station-mount": "connection" }));
    shell.appendChild(header);

    shell.appendChild(element(doc, "section", "station-machine", {
      "data-station-mount": "machine", "aria-label": "Machine stage"
    }));

    /* The Operator Handbook's slot (station-handbook.js): the launcher in
     * the stage's corner and the panel it opens over the stage's lower
     * half. The SAME grid cell as the machine - laid over it, not beside
     * it - so opening the Handbook reserves no track, reflows nothing and
     * leaves the hoppers above it drawn exactly where they were: Blend
     * Edit works on them while it is open. The slot itself is inert to
     * the pointer (shell.css); only what the Handbook puts in it is not. */
    shell.appendChild(element(doc, "div", "station-handbook-slot", { "data-station-mount": "handbook" }));

    /* The utility surfaces' slot: the smaller focused surfaces that open
     * out of the header's readouts - the Changeover Calculator
     * (station-changeover.js) today - across the UPPER part of the same
     * cell, above the Handbook's share of it, so the two are open
     * together without meeting. The same rule as the Handbook's slot:
     * laid over the stage, no track, inert to the pointer itself. */
    shell.appendChild(element(doc, "div", "station-utility-slot", { "data-station-mount": "utility" }));

    /* The machine utility rail's slot (station-machine-rail.js): the
     * column of tiles stacked over the Handbook's launcher in the stage's
     * corner - the faces' switches and Reset Tracking. The same cell
     * again, under the two slots above in the stack, so a surface laid
     * across the stage covers what reaches under it rather than meeting
     * it; the rail stands in the launcher's corner by stylesheet alone,
     * and reserves no track and moves nothing. Inert to the pointer
     * itself, like the others. */
    shell.appendChild(element(doc, "div", "station-rail-slot", { "data-station-mount": "rail" }));

    /* The run-down timeline's row: no heading, no card - the timeline
     * itself (station-rundown-timeline.js) begins with its Now anchor. */
    shell.appendChild(element(doc, "section", "station-timeline", {
      "data-station-mount": "timeline", "aria-label": "Run-down timeline"
    }));

    shell.appendChild(element(doc, "footer", "station-status", { "data-station-mount": "status" }));

    root.appendChild(shell);
    return root;
  }

  return { MOUNTS, HARNESS_LEGACY, legacyHref, createShell };
});
