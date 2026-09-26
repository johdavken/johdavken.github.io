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
 * WHICH VIEW A LOAD GETS
 *
 * A URL that names a view gets that view: ?view=slate is Slate,
 * ?view=legacy the floor UI, ?view=station Station (station-host.js reads
 * the same flag). A URL that names none asks, in order:
 *
 *   1. the device's own choice (slate-display.js `host`), which the Android
 *      app needs since it has no address bar: `legacy` is the floor UI
 *      everywhere; `slate` is Slate everywhere, a phone's screen included
 *      (the phone tier, slate/slate-tier.js) - a phone gets there only by
 *      choosing it, from the floor UI's "Slate (Beta)" link and then
 *      Slate's Settings;
 *   2. otherwise the device: Slate on a desktop's window (at least
 *      MIN_WIDTH wide, outside the app), on a tablet's screen with a touch
 *      pointer, and in the Android app on a tablet's screen; the floor UI
 *      on a phone, in the browser or the app. Slate draws for a finger
 *      there on its own (slate/slate-tier.js).
 *
 * A tablet's screen is judged by the screen, not the window, so turning
 * the device never flips the view: its short side at least
 * TABLET_MIN_SHORT CSS px and its long side at least TABLET_MIN_LONG.
 * A phone's short side is under ~450, in either orientation.
 *
 * STARTUP THAT IS NOT SLATE'S IS PROTECTED BY DOING NOTHING
 *
 * When the load is not Slate's this file returns before it touches the
 * document. No attribute is set, no element is created, no stylesheet is
 * linked, no script is fetched. In that mode the Slate rules are not in
 * the document at all. Loading is dynamic for the same reason: a statically
 * linked Slate stylesheet would be inert but present, and "inert but
 * present" is a thing that stops being true one edit later.
 */
(function (root) {
  "use strict";

  const doc = root.document;
  if (!doc) return;

  const FLAG = "view";
  const VALUE = "slate";
  /* The narrowest window Slate is drawn for (slate-shell.js says the same). */
  const MIN_WIDTH = 1100;
  const TABLET_MIN_SHORT = 600;
  /* 900, not 960: the unfolded Galaxy Z Fold reports 933x704 and gets Slate
   * (the user's choice, 2026-09-22). The short side keeps phones out - and
   * the Fold's folded cover screen - whatever their long side. */
  const TABLET_MIN_LONG = 900;
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
    "slate/styles/themes/ristretto-light.css",
    "slate/styles/themes/ristretto-dark.css",
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
    "slate/styles/components/background.css",
    "slate/styles/components/panel.css",
    "slate/styles/components/timeline.css",
    "slate/styles/components/resin-balance.css",
    "slate/styles/components/guide.css",
    "slate/styles/components/admin.css",
    "slate/styles/components/pressure.css",
    "slate/styles/components/winding-tension.css",
    "slate/styles/components/phone.css",
    "slate/styles/components/home.css"
  ];

  const SCRIPTS = [
    // The run-down projection, shared with Station: pure arithmetic over
    // the snapshot, no DOM, no timers. The one asset outside slate/.
    "station/station-rundown.js",
    // The floor UI's recipe print sheet, shared the same way: it draws into
    // any document and carries its own stylesheet.
    "station/station-print-sheet.js",
    "slate/slate-logo.js",
    "slate/slate-dismiss.js",
    "slate/slate-drawer-drag.js",
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
    // Before the Recipe, which opens the Book under its tabs and the
    // Weights as its third tab on a desktop.
    "slate/slate-recipe-book.js",
    "slate/slate-weights.js",
    "slate/slate-recipe.js",
    "slate/slate-wizard.js",
    "slate/slate-changeover.js",
    "slate/slate-line-rate.js",
    "slate/slate-time-picker.js",
    "slate/slate-stat-cards.js",
    "slate/slate-conflict.js",
    "slate/slate-sync.js",
    "slate/slate-handling-preview.js",
    "slate/slate-settings.js",
    "slate/slate-timeline-layout.js",
    "slate/slate-runout.js",
    "slate/slate-timeline.js",
    "slate/slate-resin-balance.js",
    "slate/slate-guide.js",
    "slate/slate-weights-guide.js",
    "slate/slate-workspaces.js",
    "slate/slate-line-config.js",
    "slate/slate-resin-db.js",
    "slate/slate-pressure.js",
    "slate/slate-winding-tension.js",
    "slate/slate-tier.js",
    "slate/slate-rail.js",
    "slate/slate-phone-bar.js",
    "slate/slate-home.js",
    "slate/slate-sections.js",
    "slate/slate-shell.js",
    "slate/slate.js"
  ];

  /* The one cache tag for every Slate asset. Bumped on every Slate change,
   * together with this file's own ?v= in index.html - a stale app.js under
   * fresh Slate modules reads as "the application did not connect". */
  const VERSION = "0.52.28";

  /* The native Android shell, whose bridge is on the page before any
   * script runs. A throwing bridge reads as the app: never assume a
   * desktop. */
  function nativeApp() {
    try {
      const capacitor = root.Capacitor;
      return !!(capacitor && typeof capacitor.isNativePlatform === "function" && capacitor.isNativePlatform());
    } catch (error) {
      return true;
    }
  }

  function matches(query) {
    try {
      return typeof root.matchMedia === "function" ? !!root.matchMedia(query).matches : null;
    } catch (error) {
      return null;
    }
  }

  /* Wide enough for the sheet. Nothing to measure with reads as not. */
  function wideWindow() {
    const wide = matches(`(min-width: ${MIN_WIDTH}px)`);
    if (wide !== null) return wide;
    return Number(root.innerWidth) >= MIN_WIDTH;
  }

  /* A tablet's screen, in either orientation. Nothing to measure with
   * reads as not: a phone is never given Slate by guesswork. */
  function tabletScreen() {
    let width = NaN;
    let height = NaN;
    try {
      width = Number(root.screen && root.screen.width);
      height = Number(root.screen && root.screen.height);
    } catch (error) {
      return false;
    }
    if (!(width > 0 && height > 0)) return false;
    return Math.min(width, height) >= TABLET_MIN_SHORT && Math.max(width, height) >= TABLET_MIN_LONG;
  }

  /* A phone, by slate/slate-tier.js's rule: a screen whose shorter side is
   * under a tablet's (TABLET_MIN_SHORT), or a window narrower than that.
   * Only for the provisional mark; nothing to measure is not a phone. */
  function phoneViewport() {
    const roomy = matches(`(min-width: ${TABLET_MIN_SHORT}px)`);
    if (roomy === false) return true;
    try {
      const width = Number(root.screen && root.screen.width);
      const height = Number(root.screen && root.screen.height);
      return width > 0 && height > 0 && Math.min(width, height) < TABLET_MIN_SHORT;
    } catch (error) {
      return false;
    }
  }

  /* The device's own choice (slate-display.js), when it made one. */
  function hostChoice() {
    try {
      const display = root.PolynSlateDisplay;
      if (!display || typeof display.readFrom !== "function") return "auto";
      const record = display.readFrom(root);
      return record && typeof record.host === "string" ? record.host : "auto";
    } catch (error) {
      return "auto";
    }
  }

  /* Slate's device: see WHICH VIEW A LOAD GETS above. */
  function slateDevice() {
    const choice = hostChoice();
    if (choice === "legacy") return false;
    if (choice === "slate") return true;
    const native = nativeApp();
    const tablet = tabletScreen();
    if (native) return tablet;
    if (wideWindow()) return true;
    return tablet && matches("(pointer: coarse)") === true;
  }

  function requested() {
    try {
      const view = new URL(root.location.href).searchParams.get(FLAG);
      if (view === VALUE) return true;
      if (view !== null) return false;
      return slateDevice();
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
    /* A PROVISIONAL TIER
     *
     * The boot (slate/slate.js) decides the tier; it runs only after every
     * stylesheet and module has arrived. Until then the sheets would draw
     * the 1440px desktop frame, and on a touch screen the browser settles
     * its zoom against that frame for good. So the host marks the root with
     * the tier the device most likely has - the boot corrects it, and the
     * operator's Settings choice with it - and the frame is fluid from the
     * first paint. */
    const touchDevice = nativeApp() || matches("(pointer: coarse)") === true;
    /* A VISIT
     *
     * The address asked for Slate where the device, left to choose, would
     * have opened the floor UI - a phone following the floor UI's "Slate
     * (Beta)" link. Slate then offers to open every time (slate.js), since
     * the Android app has no address bar to come back by. */
    if (hostChoice() === "auto" && !slateDevice()) host.setAttribute("data-slate-visit", "");
    host.setAttribute("data-input", touchDevice ? "touch" : "pointer");
    host.setAttribute("data-viewport", phoneViewport() ? "phone" : (wideWindow() ? "wide" : "narrow"));
    doc.body.appendChild(host);

    // Set last: the moment this lands, host.css hides the application shell,
    // so the container it reveals already exists.
    doc.body.setAttribute(ATTRIBUTE, VALUE);

    STYLESHEETS.forEach(linkStylesheet);
    SCRIPTS.forEach(loadScript);
    if (touchDevice && phoneViewport()) keyboardResizes();
    if (touchDevice) settleZoom();
  }

  /* THE KEYBOARD ON A PHONE
   *
   * A phone's editors are sheets at the foot of the screen
   * (components/phone.css). By default a browser lays the keyboard over
   * the page and leaves the page its full height, so a sheet at the foot
   * would stand under the keyboard. Told `interactive-widget=
   * resizes-content`, it shortens the page to what the keyboard leaves,
   * and the sheet rises above it. Only on a phone, and only while Slate is
   * the view: leaving Slate loads the page afresh with its own tag. */
  function keyboardResizes() {
    const meta = doc.querySelector ? doc.querySelector("meta[name='viewport']") : null;
    if (!meta) return;
    const content = meta.getAttribute("content") || "";
    if (/interactive-widget/.test(content)) return;
    meta.setAttribute("content", content ? `${content},interactive-widget=resizes-content` : "interactive-widget=resizes-content");
  }

  /* ZOOM
   *
   * A touch browser (the Android WebView most of all) can keep a page
   * magnified from before Slate drew - a zoom the operator never chose,
   * which reads as sideways scrolling. Once the page has loaded, the
   * viewport's zoom is capped at 1 for a moment, which brings it back,
   * and the viewport is then restored as it was, so a pinch still zooms. */
  function settleZoom() {
    const view = root;
    const meta = doc.querySelector ? doc.querySelector("meta[name='viewport']") : null;
    if (!meta || typeof view.addEventListener !== "function" || typeof view.setTimeout !== "function") return;
    const reset = () => {
      const original = meta.getAttribute("content") || "";
      if (/maximum-scale/.test(original)) return;
      meta.setAttribute("content", `${original},maximum-scale=1`);
      view.setTimeout(() => meta.setAttribute("content", original), 300);
    };
    if (doc.readyState === "complete") view.setTimeout(reset, 0);
    else view.addEventListener("load", () => view.setTimeout(reset, 0));
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", activate);
  else activate();
})(typeof globalThis !== "undefined" ? globalThis : this);
