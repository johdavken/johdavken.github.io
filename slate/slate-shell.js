/* The Slate shell: the frame every host draws Slate into.
 *
 * A builder, not markup. slate-host.js (inside the application) and
 * slate/slate.html (the standalone harness) both take the shell from here,
 * so the two cannot drift. The shell is a centred frame: the section rail
 * down the left, the header across the top, the job's cards over the
 * working pane, and the timeline's pane at the right.
 *
 * <section> and <aside> with aria-labels, never <main>: the application
 * already has a <main>, and the legacy sheets style it bare.
 * slate-host-isolation.test.js pins this.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateShell = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Every mount point the boot file looks for. Named here so the shell and
   * the code that fills it cannot disagree about what exists. */
  const MOUNTS = Object.freeze(["rail", "header", "notice", "sync", "stats", "centre", "aside"]);

  const TOO_SMALL = "Slate needs a window at least 1100px wide. Use Resin.Tools (Legacy) on this screen.";

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
   * Slate and the legacy interface coexist on one page: the application
   * host is index.html, and ?view=slate is the one flag that makes it show
   * Slate instead. So the route back is that same URL without the flag. On
   * the standalone harness (slate/slate.html), which has no application,
   * the route is the application's page beside it. */
  const HARNESS_LEGACY = "../index.html";
  function legacyHref(href) {
    let url;
    try {
      url = new URL(String(href));
    } catch (error) {
      return HARNESS_LEGACY;
    }
    if (url.searchParams.get("view") !== "slate") return HARNESS_LEGACY;
    url.searchParams.delete("view");
    return url.pathname + url.search + url.hash;
  }

  /**
   * Build the Slate shell as a single detached element carrying `slate-root`.
   *
   * @param {Document} doc
   * @param {object} [options]
   * @param {string} [options.legacy]  the href of the legacy interface; by
   *        default derived from the document's own location (legacyHref)
   */
  function createShell(doc, options) {
    const settings = options || {};
    const root = element(doc, "div", "slate-root", { "data-slate-app": "" });
    const legacy = typeof settings.legacy === "string"
      ? settings.legacy
      : legacyHref(doc.location && doc.location.href);

    root.appendChild(text(doc, "p", "slate-too-small", TOO_SMALL, { role: "status" }));

    const shell = element(doc, "div", "slate-shell");

    shell.appendChild(element(doc, "nav", "slate-rail", { "data-slate-mount": "rail", "aria-label": "Sections" }));

    const header = element(doc, "header", "slate-header", { "data-slate-mount": "header" });
    header.appendChild(text(doc, "h1", "slate-header__title", "Slate"));
    header.appendChild(text(doc, "a", "slate-header__legacy", "Legacy", { href: legacy, title: "Open Resin.Tools (Legacy)" }));
    header.appendChild(element(doc, "p", "slate-header__notice", { "data-slate-mount": "notice", role: "status", hidden: "" }));
    // Read-only, when Slate is: a badge that opens Settings, where the mode is chosen.
    header.appendChild(text(doc, "button", "slate-header__readonly", "Read-only", { type: "button", "data-slate-readonly": "", hidden: "", title: "Slate is read-only on this line. Open Settings to change." }));
    header.appendChild(element(doc, "div", "slate-header__sync", { "data-slate-mount": "sync" }));
    shell.appendChild(header);

    shell.appendChild(element(doc, "section", "slate-stats", { "data-slate-mount": "stats", "aria-label": "Job" }));
    shell.appendChild(element(doc, "section", "slate-centre", { "data-slate-mount": "centre", "aria-label": "Workspace" }));
    shell.appendChild(element(doc, "aside", "slate-aside", { "data-slate-mount": "aside", "aria-label": "Timeline" }));

    root.appendChild(shell);
    return root;
  }

  return Object.freeze({ MOUNTS, TOO_SMALL, HARNESS_LEGACY, legacyHref, createShell });
});
