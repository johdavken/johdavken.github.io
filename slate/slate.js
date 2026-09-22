/* Slate boot.
 *
 * The one file that knows every Slate module and every bridge. It mounts
 * the shell, subscribes to the state bridge as an ordinary consumer, and
 * decides for each publish whether the sections are rebuilt, patched or
 * left alone. It never connects a producer and never publishes: the
 * application is the only writer of the bridges, and Slate is one of the
 * readers. It dispatches nothing itself either - the five files that do
 * (slate-tracking.js, slate-stat-cards.js, slate-recipe-actions.js,
 * slate-plan-actions.js, slate-weight-actions.js) are handed the command
 * bridge and tell this file of every change they commit, so the bridge's
 * echo of the operator's own edit is recognised as such. The recipes
 * bridge (the line's saved recipes) is likewise handed on, to
 * slate-book-actions.js alone, and the weight-profiles bridge to
 * slate-profile-actions.js alone; their results carry no revision, so a
 * load's publish reads as foreign and the rows flash, which is right.
 *
 * Slate mounts into whatever element carries [data-slate-app]: the host
 * container slate-host.js creates for ?view=slate, or the harness's body.
 * Every mount is then looked up INSIDE that container, never across the
 * document: inside the application there is an entire second UI, and a
 * document-wide query is how a presentation layer starts reaching into a
 * host it does not own.
 */
(function (root) {
  "use strict";

  const bridge = root.PolynStationStateBridge || null;
  const commands = root.PolynStationCommandBridge || null;
  const connection = root.PolynStationConnectionBridge || null;
  const admin = root.PolynStationAdminBridge || null;
  const recipes = root.PolynStationRecipesBridge || null;
  const weightProfiles = root.PolynStationWeightProfilesBridge || null;
  const rundown = root.PolynStationRundown || null;
  // The application's own arithmetic for the tools - Resin Totals
  // (resin-totals.js), the pressure factor (pressure-conversion.js), the
  // tension bands (winding-tension.js). The application loads them; the
  // harness loads the same files. Optional: without one, its tool says so.
  const resinTotals = root.PolynResinTotals || null;
  const pressureConversion = root.PolynPressureConversion || null;
  const windingTension = root.PolynWindingTension || null;
  // The changeover calculator's arithmetic and records (changeover-estimate.js):
  // the application's own wizard, restated. Its storage is the module's to
  // find; Slate is handed the result and never looks itself.
  const changeoverEstimate = root.PolynChangeoverEstimate || null;
  const changeoverStorage = changeoverEstimate && typeof changeoverEstimate.storageFrom === "function" ? changeoverEstimate.storageFrom(root) : null;
  // The line rate calculator's arithmetic and answers (line-rate-estimate.js), the same way.
  const lineRateEstimate = root.PolynLineRateEstimate || null;
  const lineRateStorage = lineRateEstimate && typeof lineRateEstimate.storageFrom === "function" ? lineRateEstimate.storageFrom(root) : null;
  // The application's own percentage rule, for the bulk edit's totals.
  const validation = root.PolynValidation || null;
  const validate = validation && typeof validation.validateHopperPercentages === "function" ? validation.validateHopperPercentages : null;
  // The shared resin catalog, for the recipe's resin search. Optional: with
  // none, the search offers only what is typed.
  const catalog = root.PolynResinCatalog || null;
  const themeModule = root.PolynSlateTheme || null;
  const displayModule = root.PolynSlateDisplay || null;
  const tierModule = root.PolynSlateTier || null;
  const dismissModule = root.PolynSlateDismiss || null;

  const shell = root.PolynSlateShell;
  const rail = root.PolynSlateRail;
  const sectionsModule = root.PolynSlateSections;
  const source = root.PolynSlateSource;
  const demo = root.PolynSlateDemo;
  const recipeModule = root.PolynSlateRecipe;
  const bookModule = root.PolynSlateRecipeBook;
  const weightsModule = root.PolynSlateWeights;
  const statCards = root.PolynSlateStatCards;
  const syncModule = root.PolynSlateSync;
  const conflictModule = root.PolynSlateConflict;
  const settingsModule = root.PolynSlateSettings;
  const timelineModule = root.PolynSlateTimeline;
  const balanceModule = root.PolynSlateResinBalance;
  const adminActions = root.PolynSlateAdminActions;
  const workspacesModule = root.PolynSlateWorkspaces;
  const lineConfigModule = root.PolynSlateLineConfig;
  const resinDbModule = root.PolynSlateResinDb;
  const pressureModule = root.PolynSlatePressure;
  const windingModule = root.PolynSlateWindingTension;

  /* Inside the application host (?view=slate, marked on the body by
   * slate-host.js) the application connects the bridges before any of
   * Slate's scripts run. Finding the state bridge unconnected there is
   * therefore not "no application": it is an application from before
   * Slate existed, served from the browser's cache under an unmoved tag
   * while this newer Slate arrives under the host's own version. */
  const STALE_APPLICATION = "The application on this page did not connect to Slate - it is likely a cached copy from before Slate. Reload bypassing the cache.";
  const HARNESS = "Standalone harness: demo data, read-only. The application's Slate view is index.html?view=slate.";
  const DEFAULT_SECTION = "recipe";
  const TIMELINE = "timeline";
  const SCRAP = "scrap";

  const mounts = {};
  let container = null;
  let current = null;
  let lastOwnRevision = null;
  let sections = null;
  /* Every swap, by pane: the centre, the aside, the Scrap card's slot.
   * Each has a home - what it shows when no tool is in it. */
  const panes = {};
  let railView = null;
  let stats = null;
  let summary = null;
  let sync = null;
  let themeController = null;
  let displayController = null;

  function hosted() {
    const body = root.document ? root.document.body : null;
    return !!(body && typeof body.hasAttribute === "function" && body.hasAttribute("data-slate-view"));
  }

  function applicationConnected() {
    return !!(bridge && typeof bridge.isConnected === "function" && bridge.isConnected());
  }

  function hostWithoutApplication() {
    return hosted() && !applicationConnected();
  }

  function standaloneHarness() {
    return !hosted() && !applicationConnected();
  }

  /* The command bridge, for a live source only. A demo is never writable,
   * so the sections are handed null and their controls say why. */
  function commandsFor(resolved) {
    return commands && resolved && resolved.live ? commands : null;
  }

  /* READ-ONLY
   *
   * RT Sync's members may all write; read-only is Slate's own promise
   * (slate-display.js). The preference is automatic by default - read-only
   * whenever a line is linked, writable on the device's own session - and
   * the sections ask this on every render, so a flip of the switch or of
   * the line takes effect at once. */
  function linked(resolved) {
    return !!(resolved && resolved.live && resolved.line && resolved.line.line.linked);
  }

  function readOnlyNow() {
    const preference = displayController ? displayController.getReadOnly() : null;
    return displayModule
      ? displayModule.effectiveReadOnly(preference, linked(current))
      : (typeof preference === "boolean" ? preference : linked(current));
  }

  function renderReadOnly() {
    const on = readOnlyNow();
    if (container) container.setAttribute("data-readonly", on ? "on" : "off");
    const badge = container ? container.querySelector("[data-slate-readonly]") : null;
    if (badge) {
      if (on) badge.removeAttribute("hidden");
      else badge.setAttribute("hidden", "");
    }
  }

  /* LAYERS
   *
   * Where a layer's head stands and which way the layers run
   * (slate-display.js): the words go onto the root as data-layers and
   * data-layer-order and the sheets lay the sections out from them. No
   * section is told and nothing is rebuilt. */
  function renderLayout() {
    if (!container) return;
    const orientation = displayController && typeof displayController.getLayerOrientation === "function" ? displayController.getLayerOrientation() : "left";
    const order = displayController && typeof displayController.getLayerOrder === "function" ? displayController.getLayerOrder() : "forward";
    container.setAttribute("data-layers", orientation);
    container.setAttribute("data-layer-order", order);
    const tier = tierNow();
    container.setAttribute("data-input", tier.input);
    container.setAttribute("data-viewport", tier.width);
    // Wide again, or a mouse: there is no drawer to hold open.
    if (asideOpen && !drawer()) setAside(false);
  }

  /* THE ASIDE AS A DRAWER
   *
   * On a narrow touch screen the aside - the Timeline, or a tool in its
   * place - is a drawer over the page's right edge (components/panel.css).
   * Its open state is the boot's: the header's button and a rail item for
   * an aside section open it; that button, the scrim behind it and Escape
   * close it. Nothing is re-parented and nothing rebuilt: the drawer is the
   * same aside, moved by the sheet. */
  let asideOpen = false;
  let asideOffStack = null;
  function drawer() {
    const tier = tierNow();
    return tier.input === "touch" && tier.width === "narrow";
  }
  function setAside(open) {
    asideOpen = !!open && drawer();
    // On the Back key's stack while open (slate-dismiss.js).
    if (asideOpen && !asideOffStack && dismissModule) asideOffStack = dismissModule.register(() => setAside(false));
    if (!asideOpen && asideOffStack) { const off = asideOffStack; asideOffStack = null; off(); }
    if (mounts.aside) mounts.aside.classList.toggle("is-open", asideOpen);
    const scrim = container ? container.querySelector("[data-slate-scrim]") : null;
    if (scrim) {
      if (asideOpen) scrim.removeAttribute("hidden");
      else scrim.setAttribute("hidden", "");
    }
    const toggle = container ? container.querySelector("[data-slate-aside-toggle]") : null;
    if (toggle) toggle.setAttribute("aria-expanded", asideOpen ? "true" : "false");
  }

  /* TIER
   *
   * For a finger or a mouse, wide or narrow (slate/slate-tier.js): the
   * operator's Settings choice resolved against the window. Written onto
   * the root with the layer words, and followed live - a rotation or a
   * keyboard plugged in re-renders the attributes, never the sections. */
  function tierNow() {
    const preference = displayController && typeof displayController.getInputMode === "function" ? displayController.getInputMode() : "auto";
    if (!tierModule) return { input: "pointer", width: "wide" };
    return tierModule.tierFor(Object.assign(tierModule.probe(root), { preference }));
  }

  /* A preference moved: the root's attributes follow, and every control
   * re-reads its ability. */
  function onDisplayChange() {
    renderReadOnly();
    renderLayout();
    for (const pane of Object.values(panes)) {
      const swap = pane.swap;
      for (const definition of swap.definitions()) {
        const built = swap.section(definition.id);
        if (built && typeof built.refresh === "function") built.refresh();
      }
    }
    if (stats) stats.refresh();
  }

  function currentSource() {
    return source.resolveSource({
      snapshot: bridge && typeof bridge.getSnapshot === "function" ? bridge.getSnapshot() : null,
      demo,
      now: Date.now()
    });
  }

  /* ---- Notice ---- */

  function renderNotice(resolved) {
    const notice = mounts.notice;
    if (!notice) return;
    let message = "";
    let quiet = false;
    if (hostWithoutApplication()) message = STALE_APPLICATION;
    else if (standaloneHarness()) { message = HARNESS; quiet = true; }
    else if (resolved && resolved.live && resolved.line && !resolved.line.line.linked) { message = "No line is linked; this is the device's own session."; quiet = true; }
    notice.textContent = message;
    notice.classList.toggle("is-quiet", quiet);
    notice.classList.toggle("is-stale-application", message === STALE_APPLICATION);
    if (message) notice.removeAttribute("hidden");
    else notice.setAttribute("hidden", "");
  }

  /* A line for the operator: a refusal, a reason a control is not live.
   * Shown in the header's notice strip for a few seconds. */
  let sayTimer = null;
  function say(message) {
    const notice = mounts.notice;
    if (!notice || !message) return;
    notice.textContent = String(message);
    notice.classList.remove("is-quiet", "is-stale-application");
    notice.removeAttribute("hidden");
    if (sayTimer !== null) root.clearTimeout(sayTimer);
    sayTimer = root.setTimeout(() => { sayTimer = null; renderNotice(current); }, 6000);
  }

  /* ---- Publish policy ---- */

  function onPublish(options) {
    const settings = options || {};
    const resolved = currentSource();
    const kind = source.classifyChange(current, resolved);
    const own = !!settings.own || (resolved.revision !== null && resolved.revision === lastOwnRevision);
    if (kind === "none") { current = resolved; return; }
    current = resolved;
    if (stats) stats.update(resolved, { kind, own });
    // Every pane's panels, the Timeline among them, are updated by their
    // swap; the marks the Timeline then holds go to the recipe's rows.
    for (const pane of Object.values(panes)) pane.swap.update(resolved, { kind, own });
    if (summary) applyMarks(summary.marks());
    renderNotice(resolved);
    renderReadOnly();
  }

  function applyMarks(marks) {
    const recipe = sections ? sections.section(DEFAULT_SECTION) : null;
    if (recipe && typeof recipe.applyMarks === "function") recipe.applyMarks(marks);
  }

  function onCommitted(result) {
    lastOwnRevision = result && Number.isInteger(result.revision) ? result.revision : null;
    onPublish({ own: true });
  }

  function onTick(marks) {
    if (stats) stats.refresh();
    applyMarks(marks);
  }

  /* ---- Mount ---- */

  function mountPoint(doc) {
    const existing = doc.querySelector("[data-slate-app]");
    if (existing) return existing;
    const built = shell.createShell(doc);
    doc.body.appendChild(built);
    return built;
  }

  function start() {
    const doc = root.document;
    container = mountPoint(doc);
    themeController = container.slateTheme || (doc.documentElement && doc.documentElement.slateTheme) || null;
    displayController = container.slateDisplay || (doc.documentElement && doc.documentElement.slateDisplay) || null;

    // An empty container is the harness's thin body: fill it from the same
    // builder the application host uses.
    if (!container.querySelector("[data-slate-mount='centre']")) {
      const built = shell.createShell(doc);
      while (built.firstChild) container.appendChild(built.firstChild);
      if (!container.classList.contains("slate-root")) container.classList.add("slate-root");
    }

    for (const name of shell.MOUNTS) {
      mounts[name] = container.querySelector(`[data-slate-mount='${name}']`);
    }

    // The application's line rules. index.html loads line-identity.js after
    // this host's own tag, so it is read at boot - start() runs at or after
    // DOMContentLoaded, by which time every deferred script has run - and
    // not when this module was parsed.
    const lineIdentity = root.PolynLineIdentity || null;

    const ctx = Object.freeze({
      commands: () => commandsFor(current),
      connection,
      admin,
      recipes,
      weightProfiles,
      theme: themeController,
      themes: themeModule ? themeModule.THEMES : [],
      display: displayController,
      readOnly: readOnlyNow,
      trackingMode: () => (displayController && typeof displayController.getTrackingMode === "function" ? displayController.getTrackingMode() : (displayModule ? displayModule.DEFAULTS.tracking : "automatic")),
      timelineView: () => (displayController && typeof displayController.getTimelineView === "function" ? displayController.getTimelineView() : (displayModule ? displayModule.DEFAULTS.timeline : "realtime")),
      rundown,
      resins: () => {
        if (!catalog || typeof catalog.getResins !== "function") return [];
        try { return catalog.getResins() || []; } catch (error) { return []; }
      },
      now: () => Date.now(),
      timers: { setTimeout: (fn, ms) => root.setTimeout(fn, ms), clearTimeout: id => root.clearTimeout(id) },
      onCommitted,
      say,
      estimate: changeoverEstimate,
      estimateStorage: changeoverStorage,
      lineRate: lineRateEstimate,
      lineRateStorage,
      tier: tierNow
    });

    stats = statCards.create(doc, ctx);
    if (mounts.stats) mounts.stats.appendChild(stats.element);

    // Every section the rail lists, and the pane each shows in: the
    // centre (the default); the aside, where the Timeline sits and a
    // tool takes its place one at a time; or the stats row, where the
    // Scrap card does the same for the one tool small enough for a card.
    // Resin Balance is listed with the sections, under the Recipe Book,
    // though it shows in the aside; the two calculators list under Tools.
    const definitions = [
      { id: "recipe", label: "Recipe", group: "sections", icon: "recipe", create: (d, c) => recipeModule.create(d, Object.assign({}, c, { validate })) },
      { id: "recipe-book", label: "Recipe Book", group: "sections", icon: "book", create: (d, c) => bookModule.create(d, c) },
      { id: "weights", label: weightsModule.TITLE, group: "sections", icon: "weights", create: (d, c) => weightsModule.create(d, c) },
      { id: "resin-balance", label: "Resin Balance", group: "sections", pane: "aside", icon: "balance", create: (d, c) => balanceModule.create(d, Object.assign({}, c, { totals: resinTotals, back: () => home("aside") })) },
      // The administrator's three. Listed under Resin Balance and marked
      // `admin`, so the rail keeps them off an operator's rail until one
      // is signed in; they are built with the rest and read nothing until
      // they are both shown and open.
      { id: "workspaces", label: workspacesModule.TITLE, group: "sections", admin: true, icon: "workspaces", create: (d, c) => workspacesModule.create(d, c) },
      { id: "line-config", label: lineConfigModule.TITLE, group: "sections", admin: true, icon: "lines", create: (d, c) => lineConfigModule.create(d, Object.assign({}, c, { lineIdentity })) },
      { id: "resins", label: resinDbModule.TITLE, group: "sections", admin: true, icon: "resins", create: (d, c) => resinDbModule.create(d, c) },
      { id: "pressure", label: pressureModule.TITLE, group: "tools", pane: "stats", icon: "gauge", create: (d, c) => pressureModule.create(d, Object.assign({}, c, { pressure: pressureConversion, back: () => home("stats") })) },
      { id: "winding-tension", label: windingModule.TITLE, group: "tools", pane: "aside", icon: "winding", create: (d, c) => windingModule.create(d, Object.assign({}, c, { winding: windingTension, back: () => home("aside") })) },
      { id: "settings", label: "Settings", group: "foot", icon: "settings", create: (d, c) => settingsModule.create(d, c) },
      // The timeline keeps the clock every readout follows; it is handed
      // the same context as a section so Pump off goes through the
      // tracking seam. No rail item: it is what the aside shows by default.
      { id: TIMELINE, label: "Timeline", group: "aside", pane: "aside", icon: "timeline", create: (d, c) => timelineModule.create(d, Object.assign({}, c, { onTick, visibility: doc, view: root })) },
      // The Scrap card, already built and painted by the job's cards: the
      // stats row's home, the way the Timeline is the aside's.
      { id: SCRAP, label: "Scrap", group: "stats", pane: "stats", create: () => ({ element: stats.card(SCRAP).card }) }
    ];
    const paneOf = definition => definition.pane || rail.CENTRE;
    const inPane = name => definitions.filter(definition => paneOf(definition) === name);
    const home = name => panes[name].swap.show(panes[name].home);

    sections = sectionsModule.mountSections(doc, mounts.centre, inPane(rail.CENTRE), ctx, {
      onChange(definition) {
        const title = container.querySelector(".slate-header__title");
        if (title) title.textContent = definition.label;
        if (railView) railView.setActive(definition.id);
      }
    });
    panes[rail.CENTRE] = { swap: sections, home: DEFAULT_SECTION };
    for (const [name, mount, homeId] of [["aside", mounts.aside, TIMELINE], ["stats", stats.slot(SCRAP), SCRAP]]) {
      const swap = sectionsModule.mountSections(doc, mount, inPane(name), ctx, {
        onChange(definition) {
          if (railView) railView.setActivePane(name, definition.id === homeId ? null : definition.id);
          // The drawer's button names what the drawer holds.
          const toggle = name === "aside" ? container.querySelector("[data-slate-aside-toggle]") : null;
          if (toggle) toggle.textContent = definition.label;
        }
      });
      panes[name] = { swap, home: homeId };
    }
    summary = panes.aside.swap.section(TIMELINE);

    // A tool selected again while it is showing closes it: the pane's
    // home comes back, as the tool's own close brings it.
    railView = rail.create(doc, {
      sections: definitions,
      flyout: () => tierNow().input === "touch",
      onSelect: id => {
        const definition = definitions.find(one => one.id === id);
        if (!definition) return;
        const name = paneOf(definition);
        if (name === rail.CENTRE) { sections.show(id); return; }
        const showing = panes[name].swap.current();
        // A closed drawer opens on what was asked for, rather than the tool
        // being closed behind it.
        if (name === "aside" && drawer() && !asideOpen) {
          if (!showing || showing.id !== id) panes[name].swap.show(id);
          setAside(true);
          return;
        }
        if (showing && showing.id === id) home(name);
        else panes[name].swap.show(id);
      }
    });
    if (mounts.rail) mounts.rail.appendChild(railView.element);

    // The administrator's sections appear and vanish with the one session,
    // wherever it was opened or ended - here, the floor UI or Station. A
    // section left open when access goes hands the centre back to Recipe.
    const adminSections = definitions.filter(definition => definition.admin).map(definition => definition.id);
    function applyAdmin() {
      const open = !!(adminActions && adminActions.signedIn(admin));
      for (const id of adminSections) railView.setListed(id, open);
      if (open) return;
      const showing = sections.current();
      if (showing && adminSections.includes(showing.id)) sections.show(DEFAULT_SECTION);
    }
    applyAdmin();
    if (admin && typeof admin.subscribe === "function") admin.subscribe(applyAdmin);

    // The conflict question's dialog stands in the root, where the theme's
    // tokens reach it; the sync module registers it with the bridge.
    const conflict = conflictModule ? conflictModule.create(doc) : null;
    if (conflict) container.appendChild(conflict.element);
    sync = syncModule.create(doc, { connection, admin, conflict });
    if (mounts.sync) mounts.sync.appendChild(sync.element);

    const badge = container.querySelector("[data-slate-readonly]");
    if (badge) badge.addEventListener("click", () => sections.show("settings"));
    if (displayController && typeof displayController.subscribe === "function") displayController.subscribe(onDisplayChange);

    const asideToggle = container.querySelector("[data-slate-aside-toggle]");
    if (asideToggle) asideToggle.addEventListener("click", () => setAside(!asideOpen));
    const scrim = container.querySelector("[data-slate-scrim]");
    if (scrim) scrim.addEventListener("click", () => setAside(false));
    container.addEventListener("keydown", event => {
      if (event && event.key === "Escape" && asideOpen) setAside(false);
    });

    /* THE ANDROID BACK KEY
     *
     * android-back-button.js asks the page first (a cancelable
     * `polyn:android-back` on the document) and otherwise hands the key to
     * the application's own handler, which would act on the hidden floor
     * UI. Slate always answers: Back closes what is open on top - a
     * popover, the drawer - and with nothing open lets the app go to the
     * background, as Android expects. */
    if (typeof doc.addEventListener === "function") {
      doc.addEventListener("polyn:android-back", event => {
        if (!event || typeof event.preventDefault !== "function") return;
        const dismissed = dismissModule ? dismissModule.dismissTop() : false;
        if (!dismissed && event.detail && typeof event.detail === "object") event.detail.minimize = true;
        event.preventDefault();
      });
    }

    renderLayout();
    if (tierModule) tierModule.observe(root, renderLayout);
    for (const name of Object.keys(panes)) home(name);
    onPublish();
    if (bridge && typeof bridge.subscribe === "function") bridge.subscribe(() => onPublish());
  }

  if (!root.document) return;
  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof globalThis !== "undefined" ? globalThis : this);
