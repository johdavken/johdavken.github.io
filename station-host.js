/* Station host - the development-only switch that lets the graphical Station
 * presentation run inside the real Resin.Tools runtime.
 *
 * THE PROBLEM THIS SOLVES
 *
 * station/station.html cannot show live state, because app.js deliberately does
 * not run there. The state bridge therefore has no producer on that page and
 * Station falls back to demo data. To see real state, Station has to run in the
 * document where the application is already running - one app, one backend
 * connection, one RT Sync runtime, one bridge producer - with Station as a
 * second presentation layer over it.
 *
 * WHAT THIS FILE IS, AND IS NOT
 *
 * It is an activation switch and an asset loader. It starts nothing, owns no
 * state, and never touches application state. It does not boot a second copy of
 * anything: app.js starts exactly as it always does, connects the bridge exactly
 * as it always does, and Station subscribes to that same bridge as an ordinary
 * read-only consumer.
 *
 * NORMAL STARTUP IS PROTECTED BY DOING NOTHING
 *
 * Without ?view=station this file returns before it touches the document. No
 * attribute is set, no element is created, no stylesheet is linked, no script
 * is fetched. The only cost to a normal load is parsing this file, and the only
 * change to index.html is the one <script> tag that loads it. That is a
 * stronger guarantee than "the Station rules happen not to match anything":
 * in normal mode the Station rules are not in the document at all.
 *
 * Loading is dynamic for the same reason. A statically linked Station
 * stylesheet would be inert but present, and "inert but present" is a thing
 * that stops being true one edit later.
 */
(function (root) {
  "use strict";

  const doc = root.document;
  if (!doc) return;

  const FLAG = "view";
  const VALUE = "station";
  const ATTRIBUTE = "data-station-view";

  /* Assets, in load order. Station's own modules are order-dependent -
   * station.js reads the others' globals when it executes - so they are
   * injected with async=false, which preserves execution order for
   * dynamically inserted scripts. */
  const STYLESHEETS = [
    "station/styles/host.css",
    "station/styles/tokens.css",
    "station/styles/themes/industrial-light.css",
    "station/styles/themes/industrial-dark.css",
    "station/styles/themes/gruvbox-light.css",
    "station/styles/themes/gruvbox-dark.css",
    "station/styles/themes/engineering-paper.css",
    "station/styles/themes/blueprint.css",
    "station/styles/base.css",
    "station/styles/shell.css",
    "station/styles/components/machine.css",
    "station/styles/components/hopper.css",
    "station/styles/components/layer-bank.css",
    "station/styles/components/focus-editor.css",
    "station/styles/components/inspector.css",
    "station/styles/components/rundown.css",
    "station/styles/components/job-controls.css",
    "station/styles/components/sync-console.css",
    "station/styles/components/avatar.css",
    "station/styles/components/logo.css",
    "station/styles/components/glass.css",
    "station/styles/components/handbook.css",
    "station/styles/components/changeover.css",
    "station/styles/components/sudo.css",
    "station/styles/components/machine-rail.css",
    "station/styles/components/theme-preview.css"
  ];

  const SCRIPTS = [
    "station/station-line-model.js",
    "station/station-extruder-assets.js",
    "station/station-mixer-assets.js",
    // Layout before parts before the renderer: the renderer reads both of
    // their globals when it executes.
    "station/station-machine-layout.js",
    "station/station-machine-parts.js",
    "station/station-render.js",
    "station/station-transition.js",
    "station/station-focus-editor.js",
    "station/station-hopper-controls.js",
    "station/station-layer-share.js",
    // The machine utility rail: Blend Edit and Reset Tracking beside the
    // far-right cluster. After the hopper controls, whose reset it asks for.
    "station/station-machine-rail.js",
    // The run-down projection before the two that read it: the timeline
    // and the header's job controls.
    "station/station-rundown.js",
    "station/station-rundown-timeline.js",
    "station/station-job-controls.js",
    // The Changeover Calculator: after the job controls it applies through.
    "station/station-changeover.js",
    // The logo before the shell that draws it into the header.
    "station/station-logo.js",
    "station/station-shell.js",
    "station/station-sync-console.js",
    // Station's picture in the header, beside the name.
    "station/station-avatar.js",
    // The Operator Handbook: its first section before the shell that hosts it.
    "station/station-recipe-book.js",
    "station/station-resin-totals.js",
    "station/station-theme-preview.js",
    "station/station-appearance.js",
    // Sudo: its tools, Workspace Management and Line Configuration, before
    // the page that hosts them; all before the Handbook that hosts the page.
    "station/station-sudo-workspaces.js",
    "station/station-sudo-lines.js",
    "station/station-sudo.js",
    "station/station-handbook.js",
    "station/station-demo-lines.js",
    "station/station-source.js",
    "station/station.js"
  ];

  const VERSION = "0.35.0";

  function requested() {
    try {
      return new URL(root.location.href).searchParams.get(FLAG) === VALUE;
    } catch (error) {
      return false;
    }
  }

  // Everything below this line runs only in Station mode.
  if (!requested()) return;

  function linkStylesheet(href) {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = `${href}?v=${VERSION}`;
    doc.head.appendChild(link);
  }

  function loadScript(src) {
    const script = doc.createElement("script");
    script.src = `${src}?v=${VERSION}`;
    // Preserves order for dynamically inserted scripts; without it they race.
    script.async = false;
    doc.head.appendChild(script);
  }

  function activate() {
    if (doc.body.hasAttribute(ATTRIBUTE)) return;

    // The host container. station.js mounts into [data-station-app] and builds
    // the shell there from the shared builder, so the host does not restate
    // the shell's markup and the two cannot drift.
    const host = doc.createElement("div");
    host.setAttribute("data-station-host", "");
    host.setAttribute("data-station-app", "");
    host.className = "station-root";
    const theme = root.PolynStationTheme;
    host.stationTheme = theme && typeof theme.initialize === "function"
      ? theme.initialize(host, root)
      : null;
    if (!host.stationTheme) host.setAttribute("data-theme", "industrial-dark");

    /* FOCUS STOPS AT THE HOST'S EDGE
     *
     * host.css hides the application's shell; this is the same exclusion
     * for the one application behaviour that reaches Station through the
     * document rather than the stylesheet. app.js listens for `focusin`
     * on the document and, for every input that takes the focus, defers a
     * focus-and-select-all (selectAllSoon) - right for its own numeric
     * fields, wrong for Station's, where a deferred refocus lands after
     * the operator has moved on and can take the focus back from the
     * control Station just gave it to. Station's own focus listeners sit
     * inside the host and hear everything as before; the application's,
     * outside it, hear nothing of Station's fields - which is the
     * boundary host.css draws for the eye, drawn for the keyboard. */
    if (typeof host.addEventListener === "function") {
      host.addEventListener("focusin", event => { if (event && typeof event.stopPropagation === "function") event.stopPropagation(); });
    }
    doc.body.appendChild(host);

    // Set last: the moment this lands, host.css hides the application shell,
    // so the container it reveals already exists.
    doc.body.setAttribute(ATTRIBUTE, VALUE);

    STYLESHEETS.forEach(linkStylesheet);
    SCRIPTS.forEach(loadScript);
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", activate);
  else activate();
})(typeof globalThis !== "undefined" ? globalThis : this);
