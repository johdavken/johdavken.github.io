/* Station shell boot.
 *
 * Isolated on purpose. This file is loaded by station/station.html and by
 * nothing else: index.html does not reference it, so the existing floor UI
 * cannot be affected by anything in this directory, and station-isolation.test.js
 * holds that boundary in place.
 *
 * WHERE STATE COMES FROM
 *
 * Station reads the application through PolynStationStateBridge: a frozen,
 * deep-cloned projection, with no way back to the object it was copied from.
 * Which source is in play is decided by station-source.js, not here.
 *
 * A NOTE ON WHAT YOU WILL SEE ON THIS PAGE TODAY
 *
 * station.html does not load app.js - by design, and enforced by
 * station-isolation.test.js. So on the standalone Station page nothing is
 * connected to the bridge, and Station renders demo data. That is the
 * fallback working, not the bridge failing. The live path runs whenever
 * Station is mounted in a document where the application is running, and is
 * covered by tests rather than by this page.
 *
 * Still not wired up in this phase: run-down timing, changeover, the recipe
 * strip's contents. The bridge carries the inputs; nothing reads them yet.
 */
(function (root) {
  "use strict";

  const lineModel = root.PolynStationLineModel;
  const render = root.PolynStationRender;
  const demoLines = root.PolynStationDemoLines;
  const source = root.PolynStationSource;
  const shell = root.PolynStationShell;
  const bridge = root.PolynStationStateBridge || null;

  if (!lineModel || !render || !demoLines || !source || !shell) return;

  const mounts = {};
  let selectedDemoId = demoLines.DEMO_LINES[0] ? demoLines.DEMO_LINES[0].id : "";
  // "auto" follows the bridge and falls back to demo; "demo" pins demo data
  // even while the application is connected. Pinning is what makes the demo
  // configurations usable as a dev mode rather than only as a fallback, and
  // it is reachable at ?source=demo.
  let sourceMode = source.MODE_AUTO;

  /* Which piece of equipment the operator is looking at.
   *
   * PRESENTATION STATE, NOT APPLICATION STATE. Which layer is expanded is a
   * fact about this screen, like which demo is selected - it is not part of
   * the job and must never travel anywhere. The recipe values it displays all
   * come from the bridge snapshot; nothing is copied into here.
   *
   *   target "cluster"    -> edit the layer's recipe contents
   *   target "mixer"      -> inspect the layer blend
   *   target "extruder"   -> inspect / edit the layer percentage
   *
   * That mapping is fixed. See station-machine-parts.js, which is the only
   * place the targets are marked.
   */
  let focus = null;   // { layer, target } or null

  function setFocus(next) {
    const same = focus && next && focus.layer === next.layer && focus.target === next.target;
    focus = same ? null : next;
    renderAll();
  }

  /* The seam. Everything below reads this one resolved object, so the
   * difference between live and demo is settled in exactly one place. */
  function currentSource() {
    return source.resolveSource({
      snapshot: bridge ? bridge.getSnapshot() : null,
      demoLines,
      demoId: selectedDemoId,
      mode: sourceMode
    });
  }

  function renderNav(live) {
    const host = mounts.nav;
    if (!host) return;
    render.clear(host);
    const doc = host.ownerDocument;
    for (const demo of demoLines.DEMO_LINES) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "station-nav__item";
      button.dataset.demo = demo.id;
      const active = demo.id === selectedDemoId && !live;
      if (active) button.classList.add("is-selected");
      button.setAttribute("aria-pressed", active ? "true" : "false");

      const label = doc.createElement("span");
      label.className = "station-nav__label";
      label.textContent = demo.label;
      button.appendChild(label);

      const note = doc.createElement("span");
      note.className = "station-nav__note";
      note.textContent = demo.note;
      button.appendChild(note);

      button.addEventListener("click", () => {
        selectedDemoId = demo.id;
        // Choosing a demo configuration while the application is connected is
        // an explicit request to look at that demo, so it pins demo mode
        // rather than being silently overridden on the next publish.
        sourceMode = source.MODE_DEMO;
        renderAll();
      });
      host.appendChild(button);
    }
  }

  /* --------------------------------------------------------------------
   *   Inspector
   * ------------------------------------------------------------------ */

  function inspectorRow(doc, term, value, className) {
    const item = doc.createElement("div");
    item.className = "station-inspector__row";
    const key = doc.createElement("dt");
    key.className = "station-inspector__term";
    key.textContent = term;
    const val = doc.createElement("dd");
    val.className = `station-inspector__value${className ? ` ${className}` : ""}`;
    val.textContent = value;
    item.append(key, val);
    return item;
  }

  /* The blend a layer's hoppers add up to. One derivation, used by both the
   * mixer summary and the expanded edit panel, so they can never disagree. */
  function blendFor(model, resolved, layerId) {
    const layer = model && model.layers.find(entry => entry.id === layerId);
    if (!layer) return null;
    const rows = layer.hoppers.map(hopper => {
      const runtime = resolved.hopperState[`${layerId}:${hopper.index}`] || {};
      return {
        id: hopper.id,
        index: hopper.index,
        resin: runtime.resinName || "",
        pct: Number.isFinite(runtime.pct) ? runtime.pct : 0,
        source: runtime.source || ""
      };
    });
    const total = rows.reduce((sum, row) => sum + row.pct, 0);
    return { layer, rows, total, assigned: rows.filter(row => row.resin || row.pct) };
  }

  function panelHeader(doc, title, subtitle) {
    const header = doc.createElement("div");
    header.className = "station-panel__header";
    const heading = doc.createElement("h3");
    heading.className = "station-panel__title";
    heading.textContent = title;
    header.appendChild(heading);
    if (subtitle) {
      const note = doc.createElement("p");
      note.className = "station-panel__subtitle";
      note.textContent = subtitle;
      header.appendChild(note);
    }
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "station-panel__close";
    close.textContent = "Close";
    close.addEventListener("click", () => { focus = null; renderAll(); });
    header.appendChild(close);
    return header;
  }

  /* A blend table: hopper, resin, percentage - and the source column only when
   * the expanded edit state asked for it. */
  function blendTable(doc, blend, { withSource } = {}) {
    const table = doc.createElement("table");
    table.className = "station-blend";

    const body = doc.createElement("tbody");
    for (const row of blend.rows) {
      const tr = doc.createElement("tr");
      tr.className = "station-blend__row";
      if (!row.resin && !row.pct) tr.classList.add("is-unassigned");
      for (const cell of [
        { text: row.id, className: "station-blend__id" },
        { text: row.resin || "—", className: "station-blend__resin" },
        { text: row.pct ? `${row.pct}%` : "—", className: "station-blend__pct" }
      ].concat(withSource ? [{ text: row.source || "—", className: "station-blend__source" }] : [])) {
        const td = doc.createElement("td");
        td.className = cell.className;
        td.textContent = cell.text;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    table.appendChild(body);

    const foot = doc.createElement("tfoot");
    const tr = doc.createElement("tr");
    tr.className = "station-blend__total";
    if (Math.round(blend.total) !== 100) tr.classList.add("is-warning");
    const label = doc.createElement("td");
    label.className = "station-blend__id";
    label.textContent = "Total";
    const spacer = doc.createElement("td");
    spacer.colSpan = withSource ? 2 : 1;
    const total = doc.createElement("td");
    total.className = "station-blend__pct";
    total.textContent = `${Math.round(blend.total)}%`;
    tr.append(label, spacer, total);
    foot.appendChild(tr);
    table.appendChild(foot);
    return table;
  }

  /* The one honest statement this screen has to make: Station reads the
   * application, it cannot write to it. Shown wherever an edit would otherwise
   * be implied, rather than offering inputs that would silently do nothing. */
  function readOnlyNotice(doc, what) {
    const note = doc.createElement("p");
    note.className = "station-panel__notice";
    note.textContent = `${what} is read-only here: the Station state bridge is a one-way window onto the application.`;
    return note;
  }

  function renderFocusPanel(host, model, resolved) {
    const doc = host.ownerDocument;
    const blend = blendFor(model, resolved, focus.layer);
    if (!blend) return false;

    if (focus.target === "mixer") {
      host.appendChild(panelHeader(doc, `Layer ${blend.layer.id} blend`, blend.layer.roleLabel));
      host.appendChild(blendTable(doc, blend, { withSource: false }));
      return true;
    }

    if (focus.target === "extruder") {
      const layerPct = resolved.layerState && resolved.layerState[focus.layer]
        ? resolved.layerState[focus.layer].layerPct
        : null;
      host.appendChild(panelHeader(doc, `Layer ${blend.layer.id}`, "Share of the film structure"));
      const big = doc.createElement("p");
      big.className = "station-panel__metric";
      big.textContent = Number.isFinite(layerPct) && layerPct > 0 ? `${layerPct}%` : "—";
      host.appendChild(big);
      const list = doc.createElement("dl");
      list.className = "station-inspector__list";
      list.appendChild(inspectorRow(doc, "Position", blend.layer.roleLabel));
      list.appendChild(inspectorRow(doc, "Hoppers assigned", String(blend.assigned.length)));
      host.appendChild(list);
      host.appendChild(readOnlyNotice(doc, "Layer percentage"));
      return true;
    }

    /* Cluster: the expanded edit state.
     *
     * The controls are ON the equipment now - resin on the body, blend under
     * the discharge, source above the receiver - so this panel is deliberately
     * NOT a second copy of them. Repeating the per-hopper table here would make
     * the expansion pointless again and leave two places showing the same
     * values. What it carries instead is what the equipment cannot: the layer's
     * totals, and the fact that the blend adds up. */
    host.appendChild(panelHeader(doc, `Layer ${blend.layer.id}`, "Expanded for editing"));

    const summary = doc.createElement("dl");
    summary.className = "station-inspector__list";
    summary.appendChild(inspectorRow(doc, "Position", blend.layer.roleLabel));
    summary.appendChild(inspectorRow(doc, "Hoppers assigned",
      `${blend.assigned.length} of ${blend.rows.length}`));
    const total = inspectorRow(doc, "Blend total", `${Math.round(blend.total)}%`,
      Math.round(blend.total) === 100 ? "" : "is-warning");
    summary.appendChild(total);
    const layerPct = resolved.layerState && resolved.layerState[focus.layer]
      ? resolved.layerState[focus.layer].layerPct
      : null;
    summary.appendChild(inspectorRow(doc, "Share of structure",
      Number.isFinite(layerPct) && layerPct > 0 ? `${layerPct}%` : "—"));
    host.appendChild(summary);

    const where = doc.createElement("p");
    where.className = "station-panel__notice";
    where.textContent = "Resin, blend and source are on the hoppers themselves.";
    host.appendChild(where);
    host.appendChild(readOnlyNotice(doc, "Recipe editing"));
    return true;
  }

  function renderInspector(model, resolved) {
    const host = mounts.inspector;
    if (!host) return;
    render.clear(host);
    const doc = host.ownerDocument;
    host.removeAttribute("data-focus-target");

    if (model && focus && renderFocusPanel(host, model, resolved)) {
      host.setAttribute("data-focus-target", focus.target);
      return;
    }

    const list = doc.createElement("dl");
    list.className = "station-inspector__list";

    if (!model) {
      list.appendChild(inspectorRow(doc, "Source", resolved.label));
      // Never dressed up as a demo: a connected line we cannot describe has
      // to say so, because the alternative is invented numbers under a live
      // label. See station-source.js.
      list.appendChild(inspectorRow(doc, "Line", resolved.live ? "Connected, but not describable" : "Not configured"));
      host.appendChild(list);
      return;
    }

    list.appendChild(inspectorRow(doc, "Source", resolved.label));
    list.appendChild(inspectorRow(doc, "Line", model.line.displayName));
    list.appendChild(inspectorRow(doc, "Layers", String(model.line.layerCount)));
    list.appendChild(inspectorRow(doc,
      "Layer A",
      model.line.singleLayer ? "Not applicable" : (model.line.layerAPosition || "Unknown")
    ));
    list.appendChild(inspectorRow(doc, "Hoppers", String(lineModel.totalHopperCount(model))));
    list.appendChild(inspectorRow(doc, "Hopper naming", model.line.hopperNamingMode));
    list.appendChild(inspectorRow(doc,
      "Physical order",
      model.layers.map(layer => `${layer.id} (${layer.roleLabel})`).join(" → ")
    ));
    host.appendChild(list);

    const hint = doc.createElement("p");
    hint.className = "station-panel__notice";
    hint.textContent = "Click a hopper cluster to edit a layer, a mixer for its blend, or an extruder for its share.";
    host.appendChild(hint);
  }

  function renderRecipeStrip(model) {
    const host = mounts.recipeStrip;
    if (!host) return;
    render.clear(host);
    const doc = host.ownerDocument;
    // Placeholder only. Current/Next recipe state is not wired up in this
    // phase; this proves the slot exists in the shell, nothing more.
    for (const label of ["Current recipe", "Next recipe"]) {
      const cell = doc.createElement("div");
      cell.className = "station-recipe-strip__cell";
      const title = doc.createElement("span");
      title.className = "station-recipe-strip__title";
      title.textContent = label;
      const value = doc.createElement("span");
      value.className = "station-recipe-strip__value";
      // The bridge carries the recipe assignment, but nothing in Station reads
      // it yet. Saying "not shown yet" is accurate; saying "not connected"
      // would no longer be.
      value.textContent = model ? "Not shown in this phase" : "—";
      cell.append(title, value);
      host.appendChild(cell);
    }
  }

  function renderStatus(model, resolved) {
    const host = mounts.status;
    if (!host) return;
    const parts = [];
    if (model) {
      parts.push(model.line.displayName);
      parts.push(`${model.line.layerCount} layer${model.line.layerCount === 1 ? "" : "s"}`);
      parts.push(`${lineModel.totalHopperCount(model)} hoppers`);
    } else {
      parts.push("No line configuration");
    }
    parts.push(resolved.detail);
    host.textContent = parts.join(" · ");
    host.setAttribute("data-source", resolved.kind);
  }

  /* Development-only extruder study, at ?lab=extruder on the standalone
   * harness. Never reachable from the application: station-host.js does not
   * load the lab module, so `root.PolynStationExtruderLab` is undefined there
   * and this returns false whatever the URL says. */
  function labRequested() {
    if (!root.PolynStationExtruderLab) return false;
    try {
      return new URL(root.location.href).searchParams.get("lab") === "extruder";
    } catch (error) {
      return false;
    }
  }

  function renderAll() {
    if (labRequested()) {
      root.PolynStationExtruderLab.mount(mounts.machine, root.document, {
        layout: root.PolynStationMachineLayout,
        parts: root.PolynStationMachineParts
      });
      if (mounts.status) mounts.status.textContent =
        "Extruder study — development only. The same component the stage draws, at 3.2x.";
      return;
    }

    const resolved = currentSource();
    const model = lineModel.buildLineModel(resolved.modelInput);
    // A focus on a layer that no longer exists (the line changed under us)
    // must not survive into the render.
    if (focus && (!model || !model.layers.some(layer => layer.id === focus.layer))) focus = null;

    renderNav(resolved.live);
    render.mountStage(mounts.machine, model, {
      hopperState: resolved.hopperState,
      layerState: resolved.layerState,
      // Only the cluster expands the layer; the other two targets are
      // inspections and leave the machine as it was.
      focusLayer: focus && focus.target === "cluster" ? focus.layer : null,
      selectedTarget: focus ? focus.target : null
    });
    renderInspector(model, resolved);
    renderRecipeStrip(model);
    renderStatus(model, resolved);
  }

  /* Station mounts into whatever element carries [data-station-app]: the body
   * of the standalone harness, or the host container the application creates
   * for ?view=station. If that element is empty the shell is built into it
   * here, so both hosts get their shell from the same builder.
   *
   * Every mount is then looked up INSIDE that container rather than across the
   * document. In the harness there is nothing else to hit; inside the
   * application there is an entire second UI, and a document-wide query is how
   * a presentation layer starts reaching into a host it does not own. */
  function mountPoint(doc) {
    const existing = doc.querySelector("[data-station-app]");
    if (existing) return existing;
    const built = shell.createShell(doc);
    doc.body.appendChild(built);
    return built;
  }

  function start() {
    const doc = root.document;
    let container = mountPoint(doc);

    // An empty container is the harness's thin body: fill it from the same
    // builder the application host uses.
    if (!container.querySelector("[data-station-mount='machine']")) {
      const built = shell.createShell(doc);
      while (built.firstChild) container.appendChild(built.firstChild);
      if (!container.classList.contains("station-root")) container.classList.add("station-root");
    }

    for (const name of shell.MOUNTS) {
      mounts[name] = container.querySelector(`[data-station-mount='${name}']`);
    }
    // The boot file's own names for two of them.
    mounts.recipeStrip = mounts["recipe-strip"];

    try {
      if (new URL(root.location.href).searchParams.get("source") === "demo") {
        sourceMode = source.MODE_DEMO;
      }
    } catch (error) { /* no URL to read; auto is the right default */ }

    /* One delegated listener on the mount, for the whole machine.
     *
     * The renderer rebuilds the SVG on every change, so per-element listeners
     * would have to be reattached each time and would leak the ones they
     * replaced. Delegation also keeps the renderer event-free, which is what
     * lets it be tested without a browser: the targets are just attributes. */
    mounts.machine?.addEventListener("click", event => {
      const hit = event.target && event.target.closest
        ? event.target.closest("[data-station-target]")
        : null;
      if (!hit) return;
      const layer = hit.getAttribute("data-layer");
      const target = hit.getAttribute("data-station-target");
      if (!layer || !target) return;

      /* The receiver is the pump's indicator and its eventual toggle, and it
       * is marked as a target so it is already addressable. Toggling a pump is
       * a WRITE, and the state bridge is a one-way window with no write API -
       * so rather than offering a control that would silently do nothing, a
       * click here falls through to the cluster it sits in and opens the
       * layer, which is what clicking a hopper has always done. When a write
       * contract exists this becomes the toggle and nothing else moves. */
      if (target === "receiver") {
        const cluster = hit.closest ? hit.closest("[data-station-target='cluster']") : null;
        if (!cluster) return;
        setFocus({ layer: cluster.getAttribute("data-layer") || layer, target: "cluster" });
        return;
      }

      setFocus({ layer, target });
    });

    // Escape leaves whatever is open, which is the exit people try first.
    doc.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !focus) return;
      focus = null;
      renderAll();
    });

    renderAll();

    // Re-render on every published change. The bridge coalesces publishes
    // within a tick, so a burst of edits in the application produces one
    // render here rather than one per keystroke. This is the only path by
    // which live state reaches Station - there is no polling and no second
    // subscription to anything else.
    bridge?.subscribe(() => { renderAll(); });
  }

  if (root.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
