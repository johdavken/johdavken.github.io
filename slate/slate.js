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
  const drawerDragModule = root.PolynSlateDrawerDrag || null;
  const phoneBarModule = root.PolynSlatePhoneBar || null;
  const homeModule = root.PolynSlateHome || null;
  const lineModule = root.PolynSlateLine || null;

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
  const guideModule = root.PolynSlateGuide;
  const weightsGuideModule = root.PolynSlateWeightsGuide;
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
  /* A phone's first page (slate-home.js), listed only there. */
  const HOME = "home";
  /* Listed on the rail under a finger; a desktop opens each in the
   * Recipe - the Book under its tabs, Weights as its third tab. */
  const BOOK = "recipe-book";
  const WEIGHTS = "weights";
  const SCRAP = "scrap";

  const mounts = {};
  /* Weight profiles loaded from Slate this session, by the line's workspace. */
  const loadedProfiles = new Map();
  function profileLine() {
    try {
      const book = weightProfiles && typeof weightProfiles.getBook === "function" ? weightProfiles.getBook() : null;
      return book && book.workspace && book.workspace.id ? String(book.workspace.id) : null;
    } catch (error) {
      return null;
    }
  }
  let container = null;
  let current = null;
  let lastOwnRevision = null;
  let sections = null;
  /* Every swap, by pane: the centre, the aside, the Scrap card's slot.
   * Each has a home - what it shows when no tool is in it. */
  const panes = {};
  let railView = null;
  let phoneBar = null;
  /* Every section the boot defines (start() fills it), for the bar to
   * know which are tools. */
  const sectionDefinitions = [];
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

  /* LAYERS
   *
   * Both pages are the Grid (slate-display.js); the Layout preference says
   * where a layer's head stands - at the start of its row, or on top of
   * its column - and the Layer order which way the layers run. The words
   * go onto the root as data-layers, data-weights-layers, data-grid-heads
   * and data-layer-order and the sheets lay the sections out from them. No
   * section is told and nothing is rebuilt. */
  let lastInput = null;
  function renderLayout() {
    if (!container) return;
    const layout = displayController && typeof displayController.getLayout === "function" ? displayController.getLayout() : "grid";
    const order = displayController && typeof displayController.getLayerOrder === "function" ? displayController.getLayerOrder() : "forward";
    const tier = tierNow();
    // A phone's column has no room for the Grid: there the layers always
    // stand on top, in its own layout. The operator's choice is kept
    // (slate-display.js) and comes back on a wider screen.
    const phoneTier = tier.input === "touch" && tier.width === "phone";
    container.setAttribute("data-layers", phoneTier ? "top" : "grid");
    container.setAttribute("data-weights-layers", phoneTier ? "top" : "grid");
    container.setAttribute("data-grid-heads", layout === "grid-top" ? "top" : "start");
    container.setAttribute("data-layer-order", order);
    // How a dragged hopper's card moves (components/recipe-edit.css).
    container.setAttribute("data-drag-motion", displayController && typeof displayController.getHandling === "function" ? displayController.getHandling() : "lift");
    // The picture behind the page (components/background.css).
    container.setAttribute("data-background", displayController && typeof displayController.getBackground === "function" ? displayController.getBackground() : "none");
    container.setAttribute("data-input", tier.input);
    container.setAttribute("data-viewport", tier.width);
    container.setAttribute("data-orientation", tier.orientation || "portrait");
    // Wide again, or a mouse: there is no drawer or page to hold open,
    // and no rail sheet to raise.
    if (asideOpen && !drawer() && !page()) setAside(false);
    if (railOpen && !page()) setRail(false);
    if (toolsOpen && !page()) setTools(false);
    // Home is a phone's alone: listed there, and left for the Recipe
    // when the screen stops being one.
    if (railView) railView.setListed(HOME, page());
    if (!page() && sections && sections.current() && sections.current().id === HOME) sections.show(DEFAULT_SECTION);
    // A desktop opens the Recipe Book under the Recipe's tabs
    // (slate-recipe.js); the rail lists it under a finger only.
    if (railView) { railView.setListed(BOOK, tier.input === "touch"); railView.setListed(WEIGHTS, tier.input === "touch"); }
    // A mouse or a finger arrived: the Recipe changes its ways with it
    // (a preference change refreshes every section itself).
    if (tier.input !== lastInput) {
      lastInput = tier.input;
      const recipeView = sections ? sections.section(DEFAULT_SECTION) : null;
      if (recipeView && typeof recipeView.refresh === "function") recipeView.refresh();
    }
    const shownId = sections && sections.current() ? sections.current().id : null;
    if (tier.input !== "touch" && (shownId === BOOK || shownId === WEIGHTS)) {
      sections.show(DEFAULT_SECTION);
      // Weights was showing: the Recipe's Weights tab takes its place.
      const recipeView = shownId === WEIGHTS ? sections.section(DEFAULT_SECTION) : null;
      if (recipeView && typeof recipeView.showWeights === "function") recipeView.showWeights();
    }
    paintBar();
  }

  /* SCANNING
   *
   * The application's recipe scan (recipe-scan-ui.js): photograph a job
   * traveler or a dosing screen, read it, review it, apply it. Slate starts
   * it for the recipe tab on screen and draws none of it - the capture and
   * review are the application's own dialogs, which the host lets through
   * over Slate. The application reads the photo only for a connected line.
   * Read at boot: index.html loads the scan modules before Slate's. */
  function scanner() {
    const ui = root.PolynRecipeScanUI || null;
    const service = root.PolynRecipeScanBridge || null;
    if (!ui || typeof ui.startScan !== "function") return null;
    return Object.freeze({
      able() {
        let workspace = "";
        try { workspace = service && typeof service.getWorkspaceId === "function" ? service.getWorkspaceId() : ""; } catch (error) { workspace = ""; }
        return workspace ? { ok: true } : { ok: false, reason: "connect this device to a line (RT Sync) to scan" };
      },
      start(kind, recipe) {
        ui.startScan(kind, { destination: recipe === "next" ? "next" : "current" });
      }
    });
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
  /* On a phone the aside is a page of its own in the centre's place
   * (components/panel.css), opened from the bar; the rail is a sheet
   * raised from the bar's Menu. */
  function page() {
    const tier = tierNow();
    return tier.input === "touch" && tier.width === "phone";
  }
  function paintScrim() {
    const scrim = container ? container.querySelector("[data-slate-scrim]") : null;
    if (!scrim) return;
    if ((asideOpen && drawer()) || railOpen || toolsOpen) scrim.removeAttribute("hidden");
    else scrim.setAttribute("hidden", "");
  }
  function setAside(open) {
    asideOpen = !!open && (drawer() || page());
    // On the Back key's stack while open (slate-dismiss.js).
    if (asideOpen && !asideOffStack && dismissModule) asideOffStack = dismissModule.register(() => setAside(false));
    if (!asideOpen && asideOffStack) { const off = asideOffStack; asideOffStack = null; off(); }
    if (mounts.aside) mounts.aside.classList.toggle("is-open", asideOpen);
    paintScrim();
    paintBar();
    const handle = container ? container.querySelector("[data-slate-aside-handle]") : null;
    if (handle) {
      handle.setAttribute("aria-expanded", asideOpen ? "true" : "false");
      handle.classList.toggle("is-open", asideOpen);
    }
  }

  /* THE RAIL AS A SHEET (phone)
   *
   * The bar's Menu raises the rail from the foot of the screen over a
   * scrim; a choice, the scrim, the Menu again or Back lowers it. */
  let railOpen = false;
  let railOffStack = null;
  let statsOffStack = null;
  function setRail(open) {
    railOpen = !!open && page();
    if (railOpen && !railOffStack && dismissModule) railOffStack = dismissModule.register(() => setRail(false));
    if (!railOpen && railOffStack) { const off = railOffStack; railOffStack = null; off(); }
    if (mounts.rail) mounts.rail.classList.toggle("is-open", railOpen);
    if (phoneBar) phoneBar.setExpanded(railOpen);
    paintScrim();
  }

  /* The bar's lit key: the Timeline while its page is up, the centre's
   * section when the bar has a key for it, and Menu - the way to it -
   * for anything else. */
  function paintBar() {
    paintTitle();
    if (!phoneBar || !panes.aside || !sections) return;
    // The pages Home leads to (the Recipe, the Timeline, Resin Balance)
    // light Home; a tool lights Tools; what only Menu lists lights Menu.
    const fromHome = new Set([HOME, DEFAULT_SECTION, TIMELINE, "resin-balance"]);
    const tools = new Set(sectionDefinitions.filter(one => one.group === "tools").map(one => one.id));
    let id;
    if (asideOpen) {
      const showing = panes.aside.swap.current();
      id = showing ? showing.id : TIMELINE;
    } else {
      const centre = sections.current();
      id = centre ? centre.id : DEFAULT_SECTION;
    }
    if (fromHome.has(id)) id = HOME;
    else if (tools.has(id)) id = phoneBarModule.TOOLS;
    phoneBar.setActive(phoneBarModule.KEYS.some(key => key.id === id) ? id : phoneBarModule.MENU);
  }

  /* The header names the centre's section - or, on a phone, the page laid
   * over it: the Timeline or the tool in its place. The Recipe, Slate's
   * standing page, goes unnamed: the header row keeps its height, so
   * nothing moves when another section's name comes and goes. */
  function paintTitle() {
    const title = container ? container.querySelector(".slate-header__title") : null;
    if (!title || !sections) return;
    const over = asideOpen && page() && panes.aside ? panes.aside.swap.current() : null;
    const showing = over || sections.current();
    if (!showing) return;
    title.textContent = showing.label;
    if (showing.id === DEFAULT_SECTION) title.setAttribute("hidden", "");
    else title.removeAttribute("hidden");
  }

  /* A key on the phone's bar. */
  function onBarKey(id) {
    if (!phoneBarModule) return;
    if (id === phoneBarModule.MENU) { setTools(false); setRail(!railOpen); return; }
    if (id === phoneBarModule.TOOLS) { setRail(false); setTools(!toolsOpen); return; }
    setRail(false);
    setTools(false);
    goTo(id);
  }

  /* THE TOOLS SHEET (phone)
   *
   * The bar's Tools raises a short sheet of the calculators over the
   * scrim; a choice opens it where it lives (the pressure conversion in
   * the Scrap card's place, a sheet itself on a phone; Winding Tension as
   * the page over the centre). */
  let toolsOpen = false;
  let toolsOffStack = null;
  let toolSheet = null;
  function setTools(open) {
    toolsOpen = !!open && page() && !!toolSheet;
    if (toolsOpen && !toolsOffStack && dismissModule) toolsOffStack = dismissModule.register(() => setTools(false));
    if (!toolsOpen && toolsOffStack) { const off = toolsOffStack; toolsOffStack = null; off(); }
    if (toolSheet) {
      if (toolsOpen) toolSheet.removeAttribute("hidden");
      else toolSheet.setAttribute("hidden", "");
    }
    if (phoneBar && phoneBarModule) phoneBar.setExpanded(toolsOpen, phoneBarModule.TOOLS);
    paintScrim();
  }

  /* A page by id: a centre section, or the Timeline or a tool in the
   * aside, which on a phone is the page over the centre. */
  function goTo(id) {
    if (panes.stats && panes.stats.swap.definitions().some(one => one.id === id)) { panes.stats.swap.show(id); return; }
    const inAside = id === TIMELINE || (panes.aside && panes.aside.swap.definitions().some(one => one.id === id));
    if (inAside) {
      panes.aside.swap.show(id);
      if (drawer() || page()) setAside(true);
      return;
    }
    setAside(false);
    sections.show(id);
  }

  function refreshHome() {
    const homeView = sections ? sections.section(HOME) : null;
    if (homeView && typeof homeView.refresh === "function") homeView.refresh();
  }

  /* A drag's position (px from open), or null when it ends: written on the
   * root for the drawer, its panel and the handle to read together
   * (components/panel.css). */
  function followDrawer(shift) {
    if (!container || !container.style || typeof container.style.setProperty !== "function") return;
    const aside = mounts.aside;
    const handle = container.querySelector("[data-slate-aside-handle]");
    const dragging = shift !== null && shift !== undefined;
    if (dragging) container.style.setProperty("--slate-drawer-shift", `${Math.round(shift)}px`);
    else if (typeof container.style.removeProperty === "function") container.style.removeProperty("--slate-drawer-shift");
    if (aside) aside.classList.toggle("is-dragging", dragging);
    if (handle) handle.classList.toggle("is-dragging", dragging);
  }

  /* The handle's dot: a hopper past its mark and still running. */
  function paintHandle() {
    const handle = container ? container.querySelector("[data-slate-aside-handle]") : null;
    const dot = handle ? handle.querySelector(".slate-shell__handle-dot") : null;
    const overdue = !!(summary && typeof summary.entries === "function") && summary.entries().some(entry => entry && entry.overdue && !entry.pumpOff);
    // On a phone the dot is Home's: the Timeline is one of its steps.
    if (phoneBar) phoneBar.setDot(HOME, overdue);
    if (!dot || !summary || typeof summary.entries !== "function") return;
    if (overdue) dot.removeAttribute("hidden");
    else dot.setAttribute("hidden", "");
    handle.classList.toggle("is-overdue", overdue);
  }

  /* TIER
   *
   * For a finger or a mouse, wide or narrow (slate/slate-tier.js): always
   * the window's own answer - there is no Settings choice. Written onto
   * the root with the layer words, and followed live - a rotation or a
   * keyboard plugged in re-renders the attributes, never the sections. */
  function tierNow() {
    if (!tierModule) return { input: "pointer", width: "wide" };
    return tierModule.tierFor(tierModule.probe(root));
  }

  /* A preference moved: the root's attributes follow, and every control
   * re-reads its ability. */
  function onDisplayChange() {
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
    // Home reads the Timeline, which the aside's swap has just updated.
    refreshHome();
    if (summary) applyMarks(summary.marks());
    paintHandle();
    renderNotice(resolved);
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
    refreshHome();
    applyMarks(marks);
    paintHandle();
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
      // The weight profile last loaded here, per line, this session: the one
      // a "ran out early" correction offers to update (slate-timeline.js).
      rememberWeightProfile: id => { const line = profileLine(); if (line) loadedProfiles.set(line, id); },
      lastWeightProfile: () => { const line = profileLine(); return line ? (loadedProfiles.get(line) || null) : null; },
      theme: themeController,
      themes: themeModule ? themeModule.THEMES : [],
      display: displayController,
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
      tier: tierNow,
      // A desktop's Recipe: the always-open form, Compare always on (slate-recipe.js).
      desktop: () => tierNow().input !== "touch",
      scan: scanner(),
      // The Timeline's "No weight" on a phone: the Weights page, over it.
      openWeights: () => { setAside(false); if (sections) sections.show("weights"); }
    });

    stats = statCards.create(doc, ctx);
    if (mounts.stats) mounts.stats.appendChild(stats.element);

    // Every section the rail lists, and the pane each shows in: the
    // centre (the default); the aside, where the Timeline sits and a
    // tool takes its place one at a time; or the stats row, where the
    // Scrap card does the same for the one tool small enough for a card.
    // Resin Balance is listed with the sections, under the Recipe Book,
    // though it shows in the aside; the two calculators list under Tools.
    // What Home reads and asks for: the job's cards' words and editors, the
    // Timeline's entries, the balance's arithmetic, and the way to a page.
    const homeHooks = Object.freeze({
      line: resolved => (lineModule && typeof lineModule.lineTitle === "function" ? lineModule.lineTitle(resolved && resolved.line) : ""),
      readout: field => statCards.display(field, current ? current.job : null, Date.now()),
      open: field => { if (stats) stats.open(field); },
      go: id => goTo(id),
      recipe: resolved => {
        const changes = resolved ? source.compareFor(resolved, "current") : null;
        return {
          line: !!(resolved && resolved.line),
          planned: !!(resolved && resolved.plan && resolved.plan.planned),
          resinChanges: changes ? Object.values(changes.hoppers).filter(one => one && one.resinDiffers).length : 0
        };
      },
      timeline: () => (summary && typeof summary.entries === "function" ? summary.entries() : []),
      balance: resolved => {
        const inputs = balanceModule && typeof balanceModule.inputsFor === "function" ? balanceModule.inputsFor(resolved) : null;
        return resinTotals && inputs ? resinTotals.compute(inputs).total : 0;
      },
      clock: at => (rundown && typeof rundown.formatClock === "function" ? rundown.formatClock(at) : new Date(at).toLocaleTimeString())
    });

    const definitions = sectionDefinitions;
    sectionDefinitions.push(
      ...(homeModule ? [{ id: HOME, label: homeModule.TITLE, group: "sections", phone: true, icon: "home", create: (d, c) => homeModule.create(d, Object.assign({}, c, { home: homeHooks })) }] : []),
      { id: "recipe", label: "Recipe", group: "sections", icon: "recipe", create: (d, c) => recipeModule.create(d, Object.assign({}, c, { validate })) },
      { id: BOOK, label: "Recipe Book", group: "sections", icon: "book", create: (d, c) => bookModule.create(d, c) },
      { id: WEIGHTS, label: weightsModule.TITLE, group: "sections", icon: "weights", create: (d, c) => weightsModule.create(d, c) },
      { id: "resin-balance", label: "Resin Balance", group: "sections", pane: "aside", icon: "balance", create: (d, c) => balanceModule.create(d, Object.assign({}, c, {
        totals: resinTotals,
        back: () => home("aside"),
        // Under a finger production and scrap are entered from Resin
        // Balance: the words and the entry are the job cards' own.
        job: {
          value: field => statCards.display(field, current ? current.job : null, Date.now()).value,
          draft: field => (stats ? stats.draft(field) : ""),
          enter: (field, raw) => (stats ? stats.enter(field, raw) : { ok: false, code: "unavailable", message: "The job's cards did not load." })
        }
      })) },
      // How to Use: a short guide to a changeover, under Resin Balance and
      // in the aside as it is.
      ...(guideModule ? [{ id: "guide", label: guideModule.TITLE, group: "sections", pane: "aside", icon: "guide", create: (d, c) => guideModule.create(d, Object.assign({}, c, {
        back: () => home("aside"),
        more: weightsGuideModule ? () => panes.aside.swap.show("weights-guide") : null
      })) }] : []),
      // Hopper Weights Configuration: How to Use's specifics, reached from
      // it and swapped into the same place; the rail lists it nowhere.
      ...(weightsGuideModule ? [{ id: "weights-guide", label: weightsGuideModule.TITLE, group: "aside", pane: "aside", icon: "guide", create: (d, c) => weightsGuideModule.create(d, Object.assign({}, c, {
        back: () => home("aside"),
        guide: () => panes.aside.swap.show("guide")
      })) }] : []),
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
    );
    const paneOf = definition => definition.pane || rail.CENTRE;
    const inPane = name => definitions.filter(definition => paneOf(definition) === name);
    const home = name => panes[name].swap.show(panes[name].home);

    sections = sectionsModule.mountSections(doc, mounts.centre, inPane(rail.CENTRE), ctx, {
      onChange(definition) {
        if (railView) railView.setActive(definition.id);
        // Home carries the job's figures itself: the strip steps aside
        // (shell.css), its editors still rising from it as sheets.
        if (mounts.stats) mounts.stats.classList.toggle("is-home", definition.id === HOME);
        paintBar();
      }
    });
    panes[rail.CENTRE] = { swap: sections, home: DEFAULT_SECTION };
    for (const [name, mount, homeId] of [["aside", mounts.aside, TIMELINE], ["stats", stats.slot(SCRAP), SCRAP]]) {
      const swap = sectionsModule.mountSections(doc, mount, inPane(name), ctx, {
        onChange(definition) {
          if (railView) railView.setActivePane(name, definition.id === homeId ? null : definition.id);
          if (name === "aside") paintBar();
          // A tool in the Scrap card's place is a sheet on a phone
          // (components/phone.css): Back closes it, as its own close does.
          if (name === "stats") {
            if (definition.id !== homeId && page() && !statsOffStack && dismissModule) statsOffStack = dismissModule.register(() => home("stats"));
            if (definition.id === homeId && statsOffStack) { const off = statsOffStack; statsOffStack = null; off(); }
          }
          // The drawer's handle names what the drawer holds.
          const handle = name === "aside" ? container.querySelector("[data-slate-aside-handle]") : null;
          if (handle) { handle.setAttribute("aria-label", definition.label); handle.setAttribute("title", definition.label); }
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
        // On a phone the sheet is lowered by any choice, and a section
        // takes the screen from the Timeline's page.
        if (page()) {
          setRail(false);
          if (name === rail.CENTRE) { setAside(false); sections.show(id); return; }
          if (name === "aside") { panes.aside.swap.show(id); setAside(true); return; }
        }
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
    if (phoneBarModule && mounts.bar) {
      phoneBar = phoneBarModule.create(doc, { onSelect: onBarKey });
      mounts.bar.appendChild(phoneBar.element);
      // The Tools key's sheet: one row per calculator the rail lists under Tools.
      toolSheet = doc.createElement("div");
      toolSheet.setAttribute("class", "slate-toolsheet");
      toolSheet.setAttribute("role", "dialog");
      toolSheet.setAttribute("aria-label", "Tools");
      toolSheet.setAttribute("hidden", "");
      const heading = doc.createElement("p");
      heading.setAttribute("class", "slate-toolsheet__title");
      heading.textContent = "Tools";
      toolSheet.appendChild(heading);
      for (const definition of definitions.filter(one => one.group === "tools")) {
        const button = doc.createElement("button");
        button.setAttribute("type", "button");
        button.setAttribute("class", "slate-toolsheet__item");
        button.setAttribute("data-tool", definition.id);
        button.textContent = definition.label;
        button.addEventListener("click", () => { setTools(false); goTo(definition.id); });
        toolSheet.appendChild(button);
      }
      container.appendChild(toolSheet);
    }

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

    if (displayController && typeof displayController.subscribe === "function") displayController.subscribe(onDisplayChange);

    const asideHandle = container.querySelector("[data-slate-aside-handle]");
    if (asideHandle && drawerDragModule && mounts.aside) {
      drawerDragModule.create(doc, {
        handle: asideHandle,
        drawer: mounts.aside,
        enabled: drawer,
        isOpen: () => asideOpen,
        width: () => (typeof mounts.aside.getBoundingClientRect === "function" ? mounts.aside.getBoundingClientRect().width : 0),
        follow: followDrawer,
        settle: open => setAside(open)
      });
    }
    const scrim = container.querySelector("[data-slate-scrim]");
    if (scrim) scrim.addEventListener("click", () => { if (toolsOpen) setTools(false); else if (railOpen) setRail(false); else setAside(false); });
    container.addEventListener("keydown", event => {
      if (!event || event.key !== "Escape") return;
      if (toolsOpen) setTools(false);
      else if (railOpen) setRail(false);
      else if (asideOpen) setAside(false);
    });

    /* THE ANDROID BACK KEY
     *
     * android-back-button.js asks the page first (a cancelable
     * `polyn:android-back` on the document) and otherwise hands the key to
     * the application's own handler, which would act on the hidden floor
     * UI. Slate always answers: Back closes what is open on top - a
     * popover, the drawer, a phone's Timeline page or its rail sheet - then
     * on a phone takes a section other than the Recipe back to the Recipe,
     * and with nothing left lets the app go to the background, as Android
     * expects. */
    if (typeof doc.addEventListener === "function") {
      doc.addEventListener("polyn:android-back", event => {
        if (!event || typeof event.preventDefault !== "function") return;
        let handled = dismissModule ? dismissModule.dismissTop() : false;
        if (!handled && page()) {
          const showing = sections.current();
          const first = sections.section(HOME) ? HOME : DEFAULT_SECTION;
          if (showing && showing.id !== first) { sections.show(first); handled = true; }
        }
        if (!handled && event.detail && typeof event.detail === "object") event.detail.minimize = true;
        event.preventDefault();
      });
    }

    /* A VISIT
     *
     * The host marks a load where the address asked for Slate but the
     * device would have opened the floor UI (data-slate-visit). With the
     * device's choice still automatic, Slate offers to open every time -
     * the same choice as Settings > This device opens > Slate. */
    const offerEl = container.querySelector("[data-slate-offer]");
    if (offerEl && container.hasAttribute("data-slate-visit") && displayController && typeof displayController.getHostChoice === "function" && displayController.getHostChoice() === "auto") {
      offerEl.removeAttribute("hidden");
      offerEl.addEventListener("click", event => {
        const target = event && event.target;
        const button = target && typeof target.closest === "function" ? target.closest("[data-slate-offer-do]") : null;
        if (!button) return;
        if (button.getAttribute("data-slate-offer-do") === "always" && typeof displayController.setHostChoice === "function") {
          displayController.setHostChoice("slate");
          say("This device opens Slate from now on. Settings > This device opens changes it.");
        }
        offerEl.setAttribute("hidden", "");
      });
    }

    /* THE PUMP-OFF ALARM
     *
     * The application sounds the alarm, vibrates and notifies whatever
     * view is up; its banner is the floor UI's and hidden under Slate. It
     * asks the page first (a cancelable `polyn:pump-off-alert` on the
     * document): Slate takes it and shows its own, whose Dismiss is the
     * banner's - the vibration stopped. Back closes it the same way. */
    const alertEl = container.querySelector("[data-slate-alert]");
    let alertDismiss = null;
    let alertOffStack = null;
    function closeAlert() {
      if (!alertEl || alertEl.hasAttribute("hidden")) return;
      alertEl.setAttribute("hidden", "");
      if (alertOffStack) { const off = alertOffStack; alertOffStack = null; off(); }
      const dismiss = alertDismiss;
      alertDismiss = null;
      if (typeof dismiss === "function") { try { dismiss(); } catch (error) { /* the vibration is the application's */ } }
    }
    if (alertEl && typeof doc.addEventListener === "function") {
      const dismissButton = alertEl.querySelector(".slate-alert__dismiss");
      if (dismissButton) dismissButton.addEventListener("click", closeAlert);
      doc.addEventListener("polyn:pump-off-alert", event => {
        if (!event || typeof event.preventDefault !== "function") return;
        const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
        const words = alertEl.querySelector(".slate-alert__text");
        if (words) words.textContent = `Pump off ${detail.hopper || "a hopper"}: ${detail.resin || "Tracked hopper"} is due now.`;
        alertDismiss = typeof detail.dismiss === "function" ? detail.dismiss : null;
        alertEl.removeAttribute("hidden");
        if (!alertOffStack && dismissModule) alertOffStack = dismissModule.register(closeAlert);
        event.preventDefault();
      });
    }

    renderLayout();
    if (tierModule) tierModule.observe(root, renderLayout);
    for (const name of Object.keys(panes)) home(name);
    // A phone opens on Home, as the floor UI's phone does.
    if (page() && sections.section(HOME)) sections.show(HOME);
    onPublish();
    if (bridge && typeof bridge.subscribe === "function") bridge.subscribe(() => onPublish());
  }

  if (!root.document) return;
  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof globalThis !== "undefined" ? globalThis : this);
