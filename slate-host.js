/* Slate host - the switch that lets the Slate presentation run inside the
 * real Resin.Tools runtime.
 *
 * THE PROBLEM THIS SOLVES
 *
 * slate/slate.html cannot show live state, because app.js deliberately does
 * not run there. The state bridge has no producer on that page and Slate
 * falls back to demo data. To see real state, Slate has to run in the
 * document where the application is already running - one app, one backend
 * connection, one RT Sync runtime, one bridge producer - with Slate as a
 * presentation layer over it, the way Station is.
 *
 * WHAT THIS FILE IS, AND IS NOT
 *
 * It is an activation switch and an asset loader. It starts nothing, owns no
 * state, and never touches application state. app.js starts exactly as it
 * always does, connects the bridges exactly as it always does, and Slate
 * subscribes to those same bridges as an ordinary consumer beside Station.
 *
 * NORMAL STARTUP IS PROTECTED BY DOING NOTHING
 *
 * Without ?view=slate this file returns before it touches the document. No
 * attribute is set, no element is created, no stylesheet is linked, no
 * script is fetched. In normal mode the Slate rules are not in the document
 * at all. Loading is dynamic for the same reason: a statically linked Slate
 * stylesheet would be inert but present, and "inert but present" is a thing
 * that stops being true one edit later.
 */
(function (root) {
  "use strict";

  const doc = root.document;
  if (!doc) return;

  const FLAG = "view";
  const VALUE = "slate";
  const ATTRIBUTE = "data-slate-view";

  /* Assets, in load order. Slate's own modules are order-dependent -
   * slate.js reads the others' globals when it executes - so they are
   * injected with async=false, which preserves execution order for
   * dynamically inserted scripts. */
  const STYLESHEETS = [
    "slate/styles/host.css",
    "slate/styles/tokens.css",
    "slate/styles/themes/yaru-light.css",
    "slate/styles/themes/yaru-dark.css",
    "slate/styles/themes/rose-pine-light.css",
    "slate/styles/themes/rose-pine-dark.css",
    "slate/styles/themes/tokyo-night-light.css",
    "slate/styles/themes/tokyo-night-dark.css",
    "slate/styles/themes/gruvbox-light.css",
    "slate/styles/themes/gruvbox-dark.css",
    "slate/styles/themes/everforest-light.css",
    "slate/styles/themes/everforest-dark.css",
    "slate/styles/themes/catppuccin-light.css",
    "slate/styles/themes/catppuccin-dark.css",
    "slate/styles/themes/retro-82-light.css",
    "slate/styles/themes/retro-82-dark.css",
    "slate/styles/base.css",
    "slate/styles/shell.css",
    "slate/styles/components/rail.css",
    "slate/styles/components/header.css",
    "slate/styles/components/section.css",
    "slate/styles/components/stat-cards.css",
    "slate/styles/components/wizard.css",
    "slate/styles/components/time-picker.css",
    "slate/styles/components/recipe.css",
    "slate/styles/components/recipe-edit.css",
    "slate/styles/components/recipe-book.css",
    "slate/styles/components/weights.css",
    "slate/styles/components/sync.css",
    "slate/styles/components/modal.css",
    "slate/styles/components/settings.css",
    "slate/styles/components/panel.css",
    "slate/styles/components/timeline.css",
    "slate/styles/components/resin-balance.css",
    "slate/styles/components/admin.css",
    "slate/styles/components/pressure.css",
    "slate/styles/components/winding-tension.css"
  ];

  const SCRIPTS = [
    // The run-down projection, shared with Station: pure arithmetic over
    // the snapshot, no DOM, no timers. The one asset outside slate/.
    "station/station-rundown.js",
    // The floor UI's recipe print sheet, shared the same way: it draws into
    // any document and carries its own stylesheet.
    "station/station-print-sheet.js",
    "slate/slate-logo.js",
    "slate/slate-line.js",
    "slate/slate-demo.js",
    "slate/slate-source.js",
    "slate/slate-tracking.js",
    "slate/slate-recipe-actions.js",
    "slate/slate-plan-actions.js",
    "slate/slate-book-actions.js",
    "slate/slate-weight-actions.js",
    "slate/slate-profile-actions.js",
    "slate/slate-admin-actions.js",
    "slate/slate-resin-search.js",
    "slate/slate-recipe-draft.js",
    "slate/slate-recipe-form.js",
    "slate/slate-recipe-drag.js",
    "slate/slate-layer-menu.js",
    "slate/slate-print.js",
    "slate/slate-recipe.js",
    "slate/slate-recipe-book.js",
    "slate/slate-weights.js",
    "slate/slate-wizard.js",
    "slate/slate-changeover.js",
    "slate/slate-line-rate.js",
    "slate/slate-time-picker.js",
    "slate/slate-stat-cards.js",
    "slate/slate-conflict.js",
    "slate/slate-sync.js",
    "slate/slate-settings.js",
    "slate/slate-timeline-layout.js",
    "slate/slate-timeline.js",
    "slate/slate-resin-balance.js",
    "slate/slate-workspaces.js",
    "slate/slate-line-config.js",
    "slate/slate-resin-db.js",
    "slate/slate-pressure.js",
    "slate/slate-winding-tension.js",
    "slate/slate-rail.js",
    "slate/slate-sections.js",
    "slate/slate-shell.js",
    "slate/slate.js"
  ];

  /* The one cache tag for every Slate asset. Bumped on every Slate change,
   * together with this file's own ?v= in index.html - a stale app.js under
   * fresh Slate modules reads as "the application did not connect". */
  const VERSION = "0.16.0";

  function requested() {
    try {
      return new URL(root.location.href).searchParams.get(FLAG) === VALUE;
    } catch (error) {
      return false;
    }
  }

  // Everything below this line runs only in Slate mode.
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

    // The host container. slate.js mounts into [data-slate-app] and builds
    // the shell there from the shared builder, so the host does not restate
    // the shell's markup and the two cannot drift.
    const host = doc.createElement("div");
    host.setAttribute("data-slate-host", "");
    host.setAttribute("data-slate-app", "");
    host.className = "slate-root";
    const theme = root.PolynSlateTheme;
    host.slateTheme = theme && typeof theme.initialize === "function"
      ? theme.initialize(host, root)
      : null;
    if (!host.slateTheme) host.setAttribute("data-theme", "yaru-dark");
    /* The display preferences (slate-display.js) the same way: read here,
     * before the boot draws, so the first render already honours them. */
    const display = root.PolynSlateDisplay;
    host.slateDisplay = display && typeof display.initialize === "function"
      ? display.initialize(host, root)
      : null;

    /* FOCUS STOPS AT THE HOST'S EDGE
     *
     * host.css hides the application's shell; this is the same exclusion
     * for the one application behaviour that reaches Slate through the
     * document rather than the stylesheet. app.js listens for `focusin`
     * on the document and, for every input that takes the focus, defers a
     * focus-and-select-all (selectAllSoon) - right for its own numeric
     * fields, wrong for Slate's, where a deferred refocus lands after the
     * operator has moved on and can take the focus back from the control
     * Slate just gave it to. */
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
