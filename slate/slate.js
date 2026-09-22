/* Slate boot.
 *
 * The one file that knows every Slate module and every bridge. It mounts
 * the shell, subscribes to the state bridge as an ordinary consumer, and
 * decides for each publish whether the sections are rebuilt, patched or
 * left alone. It never connects a producer and never publishes: the
 * application is the only writer of the bridges, and Slate is one of the
 * readers. It dispatches nothing itself either - the four files that do
 * (slate-tracking.js, slate-stat-cards.js, slate-recipe-actions.js,
 * slate-plan-actions.js) are handed the command bridge
 * and tell this file of every change they commit, so the bridge's echo of
 * the operator's own edit is recognised as such. The recipes bridge (the
 * line's saved recipes) is likewise handed on, to slate-book-actions.js
 * alone; its results carry no revision, so a load's publish reads as
 * foreign and the rows flash, which is right.
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
  const rundown = root.PolynStationRundown || null;
  // The shared resin catalog, for the recipe's resin search. Optional: with
  // none, the search offers only what is typed.
  const catalog = root.PolynResinCatalog || null;
  const themeModule = root.PolynSlateTheme || null;
  const displayModule = root.PolynSlateDisplay || null;

  const shell = root.PolynSlateShell;
  const rail = root.PolynSlateRail;
  const sectionsModule = root.PolynSlateSections;
  const source = root.PolynSlateSource;
  const demo = root.PolynSlateDemo;
  const recipeModule = root.PolynSlateRecipe;
  const bookModule = root.PolynSlateRecipeBook;
  const statCards = root.PolynSlateStatCards;
  const syncModule = root.PolynSlateSync;
  const settingsModule = root.PolynSlateSettings;
  const timelineModule = root.PolynSlateTimeline;

  /* Inside the application host (?view=slate, marked on the body by
   * slate-host.js) the application connects the bridges before any of
   * Slate's scripts run. Finding the state bridge unconnected there is
   * therefore not "no application": it is an application from before
   * Slate existed, served from the browser's cache under an unmoved tag
   * while this newer Slate arrives under the host's own version. */
  const STALE_APPLICATION = "The application on this page did not connect to Slate - it is likely a cached copy from before Slate. Reload bypassing the cache.";
  const HARNESS = "Standalone harness: demo data, read-only. The application's Slate view is index.html?view=slate.";
  const DEFAULT_SECTION = "recipe";

  const mounts = {};
  let container = null;
  let current = null;
  let lastOwnRevision = null;
  let sections = null;
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

  /* The switch moved: every control re-reads its ability. */
  function onDisplayChange() {
    renderReadOnly();
    if (sections) {
      for (const definition of sections.definitions()) {
        const built = sections.section(definition.id);
        if (built && typeof built.refresh === "function") built.refresh();
      }
    }
    if (stats) stats.refresh();
    if (summary && typeof summary.refresh === "function") summary.refresh();
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
    if (sections) sections.update(resolved, { kind, own });
    if (stats) stats.update(resolved, { kind, own });
    if (summary) {
      summary.update(resolved);
      applyMarks(summary.marks());
    }
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

    const ctx = Object.freeze({
      commands: () => commandsFor(current),
      connection,
      admin,
      recipes,
      theme: themeController,
      themes: themeModule ? themeModule.THEMES : [],
      display: displayController,
      readOnly: readOnlyNow,
      rundown,
      resins: () => {
        if (!catalog || typeof catalog.getResins !== "function") return [];
        try { return catalog.getResins() || []; } catch (error) { return []; }
      },
      now: () => Date.now(),
      timers: { setTimeout: (fn, ms) => root.setTimeout(fn, ms), clearTimeout: id => root.clearTimeout(id) },
      onCommitted,
      say
    });

    const definitions = [
      { id: "recipe", label: "Recipe", group: "sections", icon: "recipe", create: (d, c) => recipeModule.create(d, c) },
      { id: "recipe-book", label: "Recipe Book", group: "sections", icon: "book", create: (d, c) => bookModule.create(d, c) },
      { id: "settings", label: "Settings", group: "foot", icon: "settings", create: (d, c) => settingsModule.create(d, c) }
    ];

    sections = sectionsModule.mountSections(doc, mounts.centre, definitions, ctx, {
      onChange(definition) {
        const title = container.querySelector(".slate-header__title");
        if (title) title.textContent = definition.label;
        if (railView) railView.setActive(definition.id);
      }
    });

    railView = rail.create(doc, { sections: definitions, onSelect: id => sections.show(id) });
    if (mounts.rail) mounts.rail.appendChild(railView.element);

    stats = statCards.create(doc, ctx);
    if (mounts.stats) mounts.stats.appendChild(stats.element);

    // The timeline keeps the clock every readout follows; it is handed the
    // same context as a section so Pump off goes through the tracking seam.
    summary = timelineModule.create(doc, Object.assign({}, ctx, { onTick, visibility: doc, view: root }));
    if (mounts.aside) mounts.aside.appendChild(summary.element);

    sync = syncModule.create(doc, { connection, admin });
    if (mounts.sync) mounts.sync.appendChild(sync.element);

    const badge = container.querySelector("[data-slate-readonly]");
    if (badge) badge.addEventListener("click", () => sections.show("settings"));
    if (displayController && typeof displayController.subscribe === "function") displayController.subscribe(onDisplayChange);

    sections.show(DEFAULT_SECTION);
    onPublish();
    if (bridge && typeof bridge.subscribe === "function") bridge.subscribe(() => onPublish());
  }

  if (!root.document) return;
  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof globalThis !== "undefined" ? globalThis : this);
