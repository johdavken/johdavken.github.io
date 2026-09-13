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
 * Run-down timing and the changeover are read by the timeline across the
 * foot of the workspace (station-rundown-timeline.js) and set from the
 * header's job controls (station-job-controls.js); the changeover readout
 * opens the Changeover Calculator (station-changeover.js) in the utility
 * slot over the stage's upper part. The Operator Handbook
 * (station-handbook.js) opens over the stage's lower half from the
 * launcher in its corner; its Recipe Book (station-recipe-book.js) lists
 * the line's saved recipes, saves the running one, and enters Blend Edit
 * - the mode under which this file turns hopper clusters over into
 * compact editors (see BLEND EDIT below).
 */
(function (root) {
  "use strict";

  const lineModel = root.PolynStationLineModel;
  const render = root.PolynStationRender;
  const demoLines = root.PolynStationDemoLines;
  const source = root.PolynStationSource;
  const shell = root.PolynStationShell;
  const transition = root.PolynStationTransition;
  const focusEditor = root.PolynStationFocusEditor;
  const syncConsole = root.PolynStationSyncConsole || null;
  /* Station's picture (station-avatar.js): the face beside the name in the
   * header and the larger picture it opens. Identity, not a control - it
   * is handed nothing and reaches nothing. */
  const avatar = root.PolynStationAvatar || null;
  const bridge = root.PolynStationStateBridge || null;
  /* The connection bridge (station-connection-bridge.js): the line this
   * desktop is attached to and how the connection stands, as the
   * application publishes it, plus the letterbox for Refresh and Add
   * device. Consumed by the line console alone; this file only mounts
   * that console and hands the bridge over. With no producer - the
   * standalone harness - getStatus() is null and the console stays
   * hidden, which is the truthful state: this page has no line. */
  const connection = root.PolynStationConnectionBridge || null;
  /* The command bridge (station-command-bridge.js): the write direction's
   * transport. The application host connects an executor to it; the
   * standalone harness has none, so it answers "unavailable" there. This
   * file never dispatches: the bridge is handed to the focused editor,
   * which issues each edit as a command and reads the answer, and the
   * boot file's part is what happens after - see onCommitted in
   * drawStage. */
  const commands = root.PolynStationCommandBridge || null;
  /* The hopper cluster's write seam (station-hopper-controls.js): the
   * tracking and pump controls drawn on every hopper. This file resolves
   * a click on one to the module, which issues the command on the bridge
   * it is handed; what happens after is the same publish policy the
   * editor's commands run (see toggleHopperControl). */
  const hopperControls = root.PolynStationHopperControls || null;
  /* The layer header's write seam (station-layer-share.js): the layer's
   * share of the film, drawn under its role and edited in that same
   * slot. This file resolves a click on the drawn value to the module,
   * which opens its field there and issues the command on the bridge it
   * is handed; what happens after is the same publish policy the
   * editor's commands run (see openShareEditor). */
  const layerShare = root.PolynStationLayerShare || null;
  /* The machine utility rail (station-machine-rail.js): the short stack
   * of controls beside the far-right hopper cluster - Blend Edit's one
   * switch, and Reset Tracking. A reader that asks: the mode is this
   * file's (below), the reset goes through the hopper controls' seam on
   * the bridge, and the rail is told what to show after each. Optional,
   * as the Handbook is; mounted only when the shell has its slot. */
  const machineRail = root.PolynStationMachineRail || null;
  /* The run-down timeline (station-rundown-timeline.js) and the header's
   * job controls (station-job-controls.js). The timeline is a reader: it
   * is fed the same resolved state the stage draws from and projects it;
   * the controls are the third dispatching file, for the line's output
   * and changeover, on the same bridge the editor is handed. Both are
   * optional, as the line console is. */
  const rundownTimeline = root.PolynStationRundownTimeline || null;
  const jobControls = root.PolynStationJobControls || null;
  /* The Changeover Calculator (station-changeover.js): the header's
   * changeover readout opened out into a utility surface under the
   * header, and the application's own calculator arithmetic and records
   * behind it (changeover-estimate.js, a shared application module, as
   * scheduling.js is). Optional, as the Handbook is; it sets the deadline
   * only through the job controls' apply, so it dispatches nothing. */
  const changeoverCalculator = root.PolynStationChangeover || null;
  const changeoverEstimate = root.PolynChangeoverEstimate || null;
  /* The Operator Handbook (station-handbook.js) and its first section, the
   * Recipe Book (station-recipe-book.js), and the bridge the book reads
   * through: the workspace's saved recipes as the application publishes
   * them (station-recipes-bridge.js), with the letterbox for Save Current.
   * All optional, as the line console is; the Handbook is mounted only
   * when the shell has its slot. */
  const handbook = root.PolynStationHandbook || null;
  const recipeBook = root.PolynStationRecipeBook || null;
  /* Resin Totals (station-resin-totals.js), over the application's own
   * calculation (resin-totals.js, a shared module like scheduling.js): it
   * reads the resolved job and draws; it computes nothing itself. */
  const resinTotalsSection = root.PolynStationResinTotals || null;
  const resinTotals = root.PolynResinTotals || null;
  const appearance = root.PolynStationAppearance || null;
  const themePreview = root.PolynStationThemePreview || null;
  const theme = root.PolynStationTheme || null;
  const recipes = root.PolynStationRecipesBridge || null;
  /* Sudo (station-sudo.js): the Handbook's administrator page, and the
   * bridge it reads and asks through - administrator access and Workspace
   * Management as the application publishes them (station-admin-bridge.js).
   * Optional, as the other sections are; with no producer - the standalone
   * harness - the page says so and offers nothing. */
  const sudo = root.PolynStationSudo || null;
  const admin = root.PolynStationAdminBridge || null;

  /* The commands Station may offer for what it is SHOWING. The executor
   * writes the application's live recipe, so it is only on offer while the
   * live snapshot is what is on screen: with demo data pinned in the host,
   * a write would change a real recipe under a drawing of a demo one. */
  function commandsFor(resolved) {
    return commands && resolved && resolved.live ? commands : null;
  }

  /* Which of a hopper's operational controls may act, for what is on
   * screen: the bridge's offer, read once per render and written onto
   * each control by the renderer. No table of permissions is kept here:
   * the offer is the bridge's answer, asked each time. */
  function controlsFor(resolved) {
    return hopperControls ? hopperControls.abilities(commandsFor(resolved), "current") : null;
  }

  /* Whether the layer share in each header may be changed, for what is on
   * screen: the same question, asked of the share module, written onto
   * each drawn share by the renderer. */
  function shareFor(resolved) {
    return layerShare ? layerShare.abilities(commandsFor(resolved), "current") : null;
  }

  if (!lineModel || !render || !demoLines || !source || !shell || !transition || !focusEditor) return;

  const mounts = {};
  /* Which demo line the demo source draws. There is no list to choose from
   * on screen any more (the left column went with the shell cleanup:
   * switching lines is the workspace's job); a developer opening the
   * harness names one at ?demo=<id> (station-demo-lines.js), or gets the
   * first. */
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
   *   target "mixer"      -> OPEN the layer in the workspace; inspect the blend
   *   target "extruder"   -> OPEN the layer in the workspace; inspect the share
   *   target "cluster"    -> the hoppers themselves. Never opens the layer. Carries
   *                          `hopper`, the id of the one hopper selected -
   *                          by a click on its row in the focused editor -
   *                          or null for the cluster as a whole. A click on
   *                          a hopper itself is one of its two controls.
   *
   * The equipment train is the handle on the layer; the hoppers are the
   * controls in it. See station-machine-parts.js, which is the only place
   * the targets are marked.
   */
  let focus = null;   // { layer, target, hopper } or null

  /* Which hopper the pointer (or keyboard focus) is on, as "<layer>:<id>".
   * Transient and DOM-only: it links a drawn hopper to its editor row and
   * back, and is reset by every render, which removes the classes. */
  let highlighted = null;

  /* TWO KINDS OF STATE, KEPT APART
   *
   * Canonical state is the application's: the frozen bridge snapshot and
   * its revision, read through currentSource() and never copied here as
   * anything authoritative. Everything in `current` derives from it.
   *
   * Transient interaction state is Station's own and goes nowhere:
   *
   *   focus            which equipment is open / selected     (above)
   *   highlighted      which hopper the pointer is on          (above)
   *   editing          the control the operator is in, if any:
   *                    { recipe, layer, index, hopper, slot, mode, draft,
   *                      baseRevision, baseValue }
   *                    recipe: current | next
   *                    slot: resin | pct | source | share (the header's
   *                    layer share: index and hopper null)
   *                    mode: search | typing    baseRevision: the snapshot
   *                    revision when the control was entered; baseValue:
   *                    the canonical value then
   *   lastOwnRevision  the revision Station's own most recent command
   *                    produced, so a publish that is only Station's echo
   *                    can be told from someone else's change.
   *
   * A publish updates canonical state and must leave transient state
   * standing - see onPublish() - unless the structure it lives in is gone. */
  let editing = null;
  let lastOwnRevision = null;

  /* The focused editor's handle (station-focus-editor.js) for the stage as
   * drawn: what a value-only publish updates in place. Null when no layer
   * is open. */
  let editorHandle = null;
  /* The share editor's handle (station-layer-share.js) while one is in a
   * header's slot: at most one, on one layer. Null otherwise, and after
   * every render, which rebuilds the header it was in. */
  let shareHandle = null;

  /* BLEND EDIT - PRESENTATION STATE, NOT APPLICATION STATE.
   *
   * A mode of the stage, entered from the Handbook's Recipe Book: while
   * it is on, a layer can be turned over from the Handbook's A-E
   * selectors (or all at once), and a layer that has been turned over
   * shows the compact blend editor (station-focus-editor.js, variant
   * "compact") in its cluster's own footprint. The header above stays as
   * it is, its share slot included: the layer's share is edited there in
   * this mode as out of it. Which layers are turned over is a fact about this screen,
   * like which layer is open; it travels nowhere and copies nothing. The
   * recipe values every card shows come from the bridge snapshot, and
   * every edit made on a card is a command through the same bridge the
   * focused editor uses - the card IS that editor, built smaller.
   *
   *   active     the mode is on
   *   flipped    the ids of the layers turned over, in no particular order
   *
   * The mode and the open layer are exclusive: entering Blend Edit closes
   * whatever layer is open, and while it is on a click on a mixer or an
   * extruder opens nothing - it turns that one layer over or back
   * instead, the mode's per-layer switch. One interaction model at a
   * time, and no click that means two things.
   *
   * The mode is switched from the machine utility rail (the one entry
   * and the one exit an operator has, with Escape on the stage as the
   * same exit); the Operator Handbook neither enters nor leaves it, so
   * the Recipe Book can be read while the cards are out. */
  const blendEdit = { active: false, flipped: [] };
  /* The compact editors' handles, by layer id, for the stage as drawn:
   * what a value-only publish updates in place, as editorHandle is for
   * the open layer. Rebuilt by every render. */
  let cardHandles = {};
  /* The Handbook's handle, once mounted, so the boot file can tell it
   * something it shows changed (a line change, a value). */
  let handbookPanel = null;
  /* The machine rail's handle, once mounted: told the mode's state, what
   * the reset may do, and where the far-right cluster stands. */
  let railPanel = null;
  /* The theme controller belongs to the Station root, not to this boot file
   * or the application global. Resolved once the host root is known. */
  let themeController = null;
  /* The one transient line the status bar carries ahead of what it was
   * saying: why a click did nothing, until something newer replaces it
   * or a valid interaction clears it. One, replaced - never stacked. */
  let notice = "";

  /* The stage's transition controller (station-transition.js): the one
   * thing that renders the machine, so that every change of focus is a
   * transition and no code path can redraw the stage out from under one.
   * Created in start(), once the mount exists. */
  let stage = null;
  // What the stage is drawing from, for the controller's render callback.
  let current = { model: null, resolved: null };

  /* The timeline's and the job controls' handles, once mounted. Fed from
   * the same `current` the stage draws from - never from a second read of
   * the bridge - so the three can never disagree about the job. */
  let timeline = null;
  let jobPanel = null;
  /* The Changeover Calculator's handle, once mounted: fed the same job
   * the header is, and told the clock moved. */
  let changeoverPanel = null;

  function feedJob(model, resolved) {
    const inputs = {
      model,
      hopperState: resolved ? resolved.hopperState : null,
      layerState: resolved ? resolved.layerState : null,
      job: resolved ? resolved.job : null,
      live: !!(resolved && resolved.live)
    };
    if (timeline) timeline.update(inputs);
    if (jobPanel) jobPanel.update(inputs);
    if (changeoverPanel) changeoverPanel.update(inputs);
    applyRundownMarks();
  }

  /* --------------------------------------------------------------------
   *   Operational marks on the drawn hoppers
   * ------------------------------------------------------------------
   * Overdue - the pump-off point has passed with the pump still running -
   * is the timeline's projection (station-rundown.js, through the
   * timeline's own anchors), written onto the drawn hoppers as a class
   * the way the highlight and the selection are: from the state that owns
   * it, to the elements as they stand, with no render. So the stage and
   * the axis say one thing about a hopper, and the mark follows the clock
   * on the timeline's tick without a clock of its own. No deadline is
   * derived here; nothing is published; nothing is kept but the classes. */
  function applyRundownMarks() {
    const mount = mounts.machine;
    if (!mount) return;
    const marks = timeline && typeof timeline.getMarks === "function" ? timeline.getMarks() : {};
    for (const el of mount.querySelectorAll(".station-hopper[data-layer][data-hopper-index]")) {
      const key = `${el.getAttribute("data-layer")}:${el.getAttribute("data-hopper-index")}`;
      const mark = marks[key];
      el.classList.toggle("is-overdue", !!(mark && mark.overdue));
    }
  }

  /* Which targets OPEN the layer: the equipment train - mixer or extruder.
   * The hopper cluster carries the pump and tracking controls - the
   * receiver and the body of each hopper; a click on the cluster around
   * them selects it for the inspector and, on a layer that is already
   * open, keeps it open - it never opens or closes one. */
  function opensLayer(target) {
    return target === "mixer" || target === "extruder";
  }

  /* Which layer the stage should show for the current focus. The train
   * decides: mixer or extruder means their layer. The cluster decides
   * nothing - whatever is open stays open, whatever is closed stays closed
   * - so no click on a hopper, on a row, or on anything that resolves to a
   * cluster can ever close a layer or open one. */
  function focusLayerFor() {
    if (!focus) return null;
    if (opensLayer(focus.target)) return focus.layer;
    return stage ? stage.getState().focusLayer : null;
  }

  function setFocus(next) {
    const same = focus && next && focus.layer === next.layer && focus.target === next.target;
    if (opensLayer(next.target)) {
      // The train toggles: the same target again closes the layer.
      focus = same ? null : { layer: next.layer, target: next.target, hopper: null };
    } else {
      /* The cluster never opens or closes anything, so it never clears the
       * focus either. A second click on the selected hopper deselects it
       * and leaves the cluster selected. */
      const hopper = next.hopper || null;
      focus = { layer: next.layer, target: "cluster", hopper: same && focus.hopper === hopper ? null : hopper };
    }
    // A layer opening or a hopper selecting is a valid interaction: a
    // refusal still on the status line is stale. The open editor's own
    // note is its own.
    if (notice && !editorHandle) say("");
    stage.request(focusLayerFor());
    syncSelection();
    renderInspector(current.model, current.resolved);
    syncRail();
  }

  function clearFocus() {
    if (!focus) return;
    focus = null;
    stage.request(null);
    syncSelection();
    renderInspector(current.model, current.resolved);
    syncRail();
  }

  /* --------------------------------------------------------------------
   *   Blend Edit
   * ------------------------------------------------------------------ */

  function layerIds() {
    return current.model ? current.model.layers.map(layer => layer.id) : [];
  }

  function isFlipped(id) {
    return blendEdit.flipped.includes(id);
  }

  /* A control the operator is in on the stage - a card's percentage
   * field, an open search - is left before the stage is rebuilt, so the
   * value in it is committed along the editor's own path (leaving a field
   * commits it) rather than thrown away with the element. Nothing is
   * discarded silently: a draft that commits is applied, a draft the
   * application refuses is reported by the editor's note before the
   * rebuild, and the rebuilt card shows what the application holds. */
  function leaveStageControl() {
    const doc = root.document;
    const active = doc && "activeElement" in doc ? doc.activeElement : null;
    if (!active || !mounts.machine || typeof mounts.machine.contains !== "function") return;
    if (mounts.machine.contains(active) && typeof active.blur === "function") active.blur();
  }

  /* The card face that just arrived settles in, as the focus workspace
   * does: opacity and a little scale over the settle time, on the same
   * tokens, and nothing when the operator asked for less motion. Which
   * layers changed face is what the caller says; the stage has already
   * been rendered. */
  function settleFaces(ids) {
    if (!mounts.machine || !ids.length || prefersReducedMotion()) return;
    const timing = stage && typeof stage.getTiming === "function" ? stage.getTiming() : { settle: 120 };
    for (const id of ids) {
      const layer = mounts.machine.querySelector(`[data-role='layer'][data-layer='${id}']`);
      if (!layer) continue;
      const face = layer.querySelector(isFlipped(id) ? ".station-blend-card" : ".station-hopper-cluster");
      if (!face) continue;
      // Through the transition module, the one place Station animates.
      transition.play(face, [{ opacity: 0, transform: "scaleX(0.92)" }, { opacity: 1, transform: "none" }],
        { duration: timing.settle, easing: "ease-out", fill: "none" });
    }
  }

  function redrawForBlend(changed) {
    stage.refresh(focusLayerFor());
    settleFaces(changed || []);
    if (handbookPanel) handbookPanel.update();
    syncRail();
  }

  function canEnterBlendEdit() {
    return !!(current.model && current.model.layers.length);
  }

  /* The rail's one click: every layer turns over at once - the mode IS
   * "edit the blends", and a layer the operator wants as hoppers again is
   * one click on its train. The hint says so, on the status line, until
   * the first thing the operator does in the mode replaces it. */
  const BLEND_EDIT_HINT = "Blend Edit: every layer is turned over to its blend card. Click a layer's mixer or extruder to show its hoppers; click Blend Edit again when done.";

  function enterBlendEdit() {
    if (blendEdit.active || !canEnterBlendEdit()) return false;
    leaveStageControl();
    // The open layer closes: the two modes do not share the stage.
    focus = null;
    blendEdit.active = true;
    blendEdit.flipped = layerIds();
    redrawForBlend(blendEdit.flipped.slice());
    say(BLEND_EDIT_HINT);
    return true;
  }

  /* Done: every card's pending entry is committed along the editor's own
   * path (see leaveStageControl), every layer comes back as hoppers, and
   * the stage is the stage it was. Edits made while the mode was on were
   * each applied by the application as they were made; there is nothing
   * held back to apply or discard here. */
  function exitBlendEdit() {
    if (!blendEdit.active) return false;
    leaveStageControl();
    const were = blendEdit.flipped.slice();
    blendEdit.active = false;
    blendEdit.flipped = [];
    redrawForBlend(were);
    // Whatever the mode refused to do is no longer refused.
    say("");
    return true;
  }

  function flipLayer(id, on) {
    if (!blendEdit.active || !layerIds().includes(id)) return false;
    const wanted = on === undefined ? !isFlipped(id) : !!on;
    if (wanted === isFlipped(id)) return false;
    leaveStageControl();
    blendEdit.flipped = wanted ? blendEdit.flipped.concat([id]) : blendEdit.flipped.filter(other => other !== id);
    redrawForBlend([id]);
    say("");
    return true;
  }

  /* The rail's switch: on when the mode is off, off when it is on. The
   * one toggle, over the one entry and the one exit above. */
  function toggleBlendEdit() {
    return blendEdit.active ? exitBlendEdit() : enterBlendEdit();
  }

  /* --------------------------------------------------------------------
   *   The machine utility rail
   * ------------------------------------------------------------------
   * What the rail shows is read off the state this file already holds and
   * the bridge's offer - never kept in the rail. syncRail runs after
   * anything that could change one of its inputs: a render, a publish, a
   * flip, a focus change. placeRail runs after every render of the
   * normal layout and when the stage's cell resizes: the rail stands at
   * the far-right cluster's outer corner, which the drawn stage declares
   * (station-machine-rail.js reads it off the SVG). */

  /* How many hoppers a reset would touch: tracked, or pump marked off. */
  function trackedHopperCount(resolved) {
    const states = resolved && resolved.hopperState ? resolved.hopperState : {};
    let count = 0;
    for (const key of Object.keys(states)) {
      const entry = states[key];
      if (entry && (entry.track || entry.pumpOff)) count += 1;
    }
    return count;
  }

  function syncRail() {
    if (!railPanel) return;
    const commandsNow = commandsFor(current.resolved);
    const resetOffered = !!(hopperControls && typeof hopperControls.canReset === "function" && hopperControls.canReset(commandsNow, "current"));
    railPanel.update({
      hidden: !canEnterBlendEdit(),
      withdrawn: !!focusLayerFor(),
      blend: { active: blendEdit.active, available: canEnterBlendEdit() },
      reset: {
        available: resetOffered,
        reason: resetOffered || !hopperControls ? "" : hopperControls.resetReason(commandsNow, "current"),
        count: trackedHopperCount(current.resolved)
      }
    });
  }

  function placeRail() {
    if (!railPanel || !mounts.machine || !mounts.rail || focusLayerFor()) return;
    const svg = typeof mounts.machine.querySelector === "function" ? mounts.machine.querySelector("svg") : null;
    if (svg) railPanel.place(svg, mounts.rail);
  }

  /* The rail's second click on Reset Tracking, already confirmed there:
   * one resetTracking through the hopper controls' seam, and the answer
   * run through the same publish policy a tracking toggle's is. What the
   * application did is said on the status line either way. */
  function resetTracking() {
    if (!hopperControls || typeof hopperControls.resetTracking !== "function") return null;
    const result = hopperControls.resetTracking(commandsFor(current.resolved));
    if (!result || !result.ok) {
      say(result && result.message ? result.message : "Tracking could not be reset.");
      return result || null;
    }
    if (!result.changed) {
      say("Nothing is tracked: there was no tracking to reset.");
      return result;
    }
    lastOwnRevision = Number.isInteger(result.revision) ? result.revision : null;
    onPublish({ own: true });
    say("Tracking reset: every hopper is untracked and its pump marked running.");
    return result;
  }

  /* --------------------------------------------------------------------
   *   Hopper <-> editor row linking
   * ------------------------------------------------------------------ */

  /* The selection classes on the stage as drawn, brought into line with
   * `focus` without a render. A change of target or hopper on the layer
   * that is already open must not rebuild the stage - that would throw
   * away an open resin search - so the classes the renderer would have
   * written are written here instead, from the same state, to the same
   * elements. The drawing is the source of which elements those are: a
   * hopper and its row both carry data-hopper and data-layer. */
  function syncSelection() {
    const mount = mounts.machine;
    if (!mount || !stage) return;
    const shown = stage.getState().focusLayer;
    const active = focus && shown && focus.layer === shown ? focus : null;
    for (const layer of mount.querySelectorAll("[data-role='layer']")) {
      const id = layer.getAttribute("data-layer");
      for (const target of ["mixer", "extruder", "cluster"]) {
        const on = !!active && id === shown && active.target === target &&
          !(target === "cluster" && active.hopper);
        layer.classList.toggle(`is-${target}-selected`, on);
      }
    }
    const selected = active ? active.hopper : null;
    for (const el of mount.querySelectorAll(".station-hopper[data-hopper], .station-editor__item[data-hopper]")) {
      el.classList.toggle("is-selected",
        !!selected && el.getAttribute("data-layer") === shown && el.getAttribute("data-hopper") === selected);
    }
  }

  /* The hopper an event target belongs to - drawn or in the editor - when
   * it is on the open layer; null otherwise. Hover linking is a focused-
   * view behaviour: the normal row is not restyled by the pointer. */
  function hopperAt(target) {
    const el = target && target.closest ? target.closest("[data-hopper][data-layer]") : null;
    if (!el) return null;
    const layer = el.getAttribute("data-layer");
    if (!layer || layer !== stage.getState().focusLayer) return null;
    return { layer, hopper: el.getAttribute("data-hopper") };
  }

  function highlight(key) {
    const next = key ? `${key.layer}:${key.hopper}` : null;
    if (next === highlighted) return;
    highlighted = next;
    applyHighlight();
  }

  /* The highlight classes as `highlighted` says, written to the drawing
   * as it stands - after a patch as well as on a pointer move. */
  function applyHighlight() {
    const mount = mounts.machine;
    if (!mount) return;
    const [layer, hopper] = highlighted ? highlighted.split(":") : [null, null];
    for (const el of mount.querySelectorAll(".station-hopper[data-hopper], .station-editor__item[data-hopper]")) {
      el.classList.toggle("is-highlighted",
        !!highlighted && el.getAttribute("data-layer") === layer && el.getAttribute("data-hopper") === hopper);
    }
  }

  /* The shared resin catalog, when the page has it. The application host
   * always does; the harness loads the same module. Nothing Station-only:
   * the list the search offers is the list Recipe Setup offers. */
  function catalogResins() {
    const catalog = root.PolynResinCatalog;
    return catalog && typeof catalog.getResins === "function" ? catalog.getResins() : [];
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

  /* --------------------------------------------------------------------
   *   Inspector
   * --------------------------------------------------------------------
   * NOT ON SCREEN. The shell no longer has an inspector column
   * (station-shell.js), so `mounts.inspector` is null and everything below
   * returns before drawing. The panels are kept because what they say -
   * the layer's blend as a table, its share, a hopper's operational state
   * in words - is due to come back in a different place; when it does, a
   * mount named "inspector" is all this needs. Nothing here is a second
   * source of truth: it reads the same snapshot the stage draws from.
   */

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

  /* The blend a layer's hoppers add up to. One derivation - the focused
   * editor's - used by the inspector too, so the two can never disagree. */
  function blendFor(model, resolved, layerId) {
    const layer = model && model.layers.find(entry => entry.id === layerId);
    return layer ? focusEditor.blendFor(layer, resolved.hopperState) : null;
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
    close.addEventListener("click", clearFocus);
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

    /* Cluster: the hoppers. The pump and tracking controls are on the
     * equipment itself; this panel carries the summary - the layer's
     * totals, whether the blend adds up - and, for a selected hopper, its
     * operational state said in words. */
    host.appendChild(panelHeader(doc, `Layer ${blend.layer.id} hoppers`, blend.layer.roleLabel));

    const summary = doc.createElement("dl");
    summary.className = "station-inspector__list";
    summary.appendChild(inspectorRow(doc, "Position", blend.layer.roleLabel));
    summary.appendChild(inspectorRow(doc, "Hoppers assigned",
      `${blend.assigned.length} of ${blend.rows.length}`));
    const total = inspectorRow(doc, "Blend total", `${Math.round(blend.total)}%`,
      blend.valid ? "" : "is-warning");
    summary.appendChild(total);
    if (focus.hopper) {
      const row = blend.rows.find(entry => entry.id === focus.hopper);
      summary.appendChild(inspectorRow(doc, "Selected hopper", row
        ? `${row.id} · ${row.resin || "no resin"}${row.pct ? ` · ${row.pct}%` : ""}${row.source ? ` · ${row.source}` : ""}`
        : focus.hopper));
      /* The running job's state for this hopper, as the application
       * holds it - the same two flags the drawn hopper shows, so a state
       * that was missed on the drawing is explicit here. Read-out only:
       * the toggles are the hopper's receiver and body. */
      if (row && hopperControls) {
        summary.appendChild(inspectorRow(doc, "Tracking", hopperControls.stateLabel("tracking", row.track),
          row.track ? "is-tracking" : ""));
        summary.appendChild(inspectorRow(doc, "Pump", hopperControls.stateLabel("pump", row.pumpOff),
          row.pumpOff ? "is-pump-off" : ""));
      }
    }
    const layerPct = resolved.layerState && resolved.layerState[focus.layer]
      ? resolved.layerState[focus.layer].layerPct
      : null;
    summary.appendChild(inspectorRow(doc, "Share of structure",
      Number.isFinite(layerPct) && layerPct > 0 ? `${layerPct}%` : "—"));
    host.appendChild(summary);

    const where = doc.createElement("p");
    where.className = "station-panel__notice";
    const able = controlsFor(resolved);
    where.textContent = able && (able.tracking || able.pump)
      ? "Click a hopper's body to track it in the timeline, and its receiver to mark the pump off or running. The application applies each change."
      : "Tracking and pump-off are shown on each hopper - the run-down flow through a tracked one, the amber receiver of a running pump - and are read-only here.";
    host.appendChild(where);
    if (commandsFor(resolved)) {
      const how = doc.createElement("p");
      how.className = "station-panel__notice";
      how.textContent = "Resin, blend and source are edited in the open layer's rows; the application applies each change.";
      host.appendChild(how);
    } else {
      host.appendChild(readOnlyNotice(doc, "Recipe editing"));
    }
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
    hint.textContent = "Click a mixer or extruder to open its layer in the workspace. Click a hopper's body to track it, and its receiver to mark the pump off or running.";
    host.appendChild(hint);
  }

  /* Inside the application host (?view=station, marked on the body by
   * station-host.js) the application connects both bridges before any of
   * Station's scripts run. Finding the state bridge unconnected there is
   * therefore not "no application": it is an application from before the
   * bridges existed - which a returning browser serves from its cache
   * under an unmoved tag, while this newer Station arrives under the
   * host's own version. The standalone harness has no application and
   * this is false there; demo pinned in the host is a choice, and the
   * bridge is connected either way. */
  const STALE_APPLICATION = "The application on this page did not connect to Station - it is likely a cached copy from before Station. Reload bypassing the cache.";

  function hosted() {
    const body = root.document ? root.document.body : null;
    return !!(body && typeof body.hasAttribute === "function" && body.hasAttribute("data-station-view"));
  }

  function applicationConnected() {
    return !!(bridge && typeof bridge.isConnected === "function" && bridge.isConnected());
  }

  function hostWithoutApplication() {
    return hosted() && !applicationConnected();
  }

  /* The standalone harness: no application, by design - and nothing in the
   * application links to either page yet, so the harness is easy to open
   * expecting the application. Its status names itself and where the
   * application's Station view is. */
  const HARNESS = "Standalone harness: demo data, read-only. The application's Station view is index.html?view=station.";

  function standaloneHarness() {
    return !hosted() && !applicationConnected();
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
    parts.push(hostWithoutApplication() ? STALE_APPLICATION : (standaloneHarness() ? HARNESS : resolved.detail));
    host.textContent = (notice ? [notice] : []).concat(parts).join(" · ");
    host.setAttribute("data-source", resolved.kind);
    host.classList.toggle("is-stale-application", hostWithoutApplication());
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
        parts: root.PolynStationMachineParts,
        extruderAssets: root.PolynStationExtruderAssets,
        mixerAssets: root.PolynStationMixerAssets
      });
      if (mounts.status) mounts.status.textContent =
        "Equipment review — development only. Original assets beside the Station derivatives the stage draws.";
      return;
    }

    const resolved = currentSource();
    const model = lineModel.buildLineModel(resolved.modelInput);
    // A focus on a layer that no longer exists (the line changed under us)
    // must not survive into the render.
    if (focus && (!model || !model.layers.some(layer => layer.id === focus.layer))) focus = null;
    // Nor a card for one: the mode stays on, the layer that is gone is not
    // turned over, and a line with no layers has nothing to be in the
    // mode with.
    blendEdit.flipped = blendEdit.flipped.filter(id => !!model && model.layers.some(layer => layer.id === id));
    if (blendEdit.active && (!model || !model.layers.length)) blendEdit.active = false;
    current = { model, resolved };
    // A rebuilt stage starts with a clean line: what a click on the old
    // one could not do is not what this one is refusing.
    notice = "";

    // A plain redraw: any transition in flight lands first, then the stage
    // is drawn in the state it was heading for.
    stage.refresh(focusLayerFor());
    renderInspector(model, resolved);
    renderStatus(model, resolved);
    feedJob(model, resolved);
    if (handbookPanel) handbookPanel.update();
    syncRail();
  }

  /* --------------------------------------------------------------------
   *   Publish policy
   * ------------------------------------------------------------------
   * The bridge publishes on every committed change, and until now every
   * one redrew the stage - rebuilding the <foreignObject> and the editor in
   * it, and with them an open resin search, the caret, and keyboard focus.
   * A weight typed on a phone would close a search here.
   *
   * So a publish is classified first (station-source.js):
   *
   *   structural  the drawing's structure changed, or the open layer is
   *               gone: the full render path. If a control was active its
   *               interaction cannot be kept; it is closed on purpose and
   *               the editor's note says why, rather than the DOM simply
   *               disappearing under the operator.
   *   values      only values moved: the mounted stage is patched in place
   *               (hoppers, running state, shares) and the editor's rows
   *               are updated around whatever control is active. Nothing
   *               is rebuilt; the <foreignObject> node is the same node.
   *   none        the drawing reads nothing new; the resolved state is
   *               kept current and that is all.
   *
   * The same policy runs for the answer to Station's own command
   * (`own`): the editor was told the result, and the snapshot it carries
   * is the one the bridge now holds, so this is the publish arriving
   * early rather than a second way in. The bridge's own notification
   * follows on the next tick and reads as "none". */
  function onPublish(options) {
    const own = !!(options && options.own);
    if (labRequested()) { renderAll(); return; }
    const resolved = currentSource();
    const model = lineModel.buildLineModel(resolved.modelInput);
    const kind = source.classifyChange(current.resolved, resolved);
    if (kind === "none") { current = { model, resolved }; return; }

    const shown = stage.getState().shown;
    const openLayerGone = !!shown && (!model || !model.layers.some(layer => layer.id === shown));
    if (kind === "values" && !openLayerGone && stage.getState().phase !== "opening" && stage.getState().phase !== "closing") {
      current = { model, resolved };
      render.patchStage(mounts.machine, model, {
        hopperState: resolved.hopperState,
        layerState: resolved.layerState,
        focusLayer: shown,
        selectedHopper: focus && focus.layer === shown ? focus.hopper : null,
        hopperControls: controlsFor(resolved),
        layerShare: shareFor(resolved)
      });
      if (editorHandle) editorHandle.update({ hopperState: resolved.hopperState });
      // The cards are editors too: the same update, around whatever
      // control is active in each.
      for (const id of Object.keys(cardHandles)) cardHandles[id].update({ hopperState: resolved.hopperState });
      // A patched hopper is a new element; the classes the boot file owns
      // are written to it again from the state that owns them.
      applyHighlight();
      syncSelection();
      renderInspector(model, resolved);
      renderStatus(model, resolved);
      feedJob(model, resolved);
      // The Handbook's pages read values too (Resin Totals: production,
      // scrap, lots, the blend) - told the same way the full render tells it.
      if (handbookPanel) handbookPanel.update();
      // And the rail: how many hoppers a reset would touch is a value.
      syncRail();
      return;
    }

    /* Structural (or a value change arriving mid-flight, which the landing
     * render will draw anyway): the full path. An interaction in progress
     * is abandoned deliberately, and said so - unless what landed was the
     * operator's own edit, which was applied; the rebuilt editor shows it. */
    const abandoned = own ? null : editing;
    renderAll();
    if (abandoned) {
      const what = abandoned.hopper ? abandoned.hopper : `layer ${abandoned.layer}'s share`;
      const message = `Layer ${abandoned.layer} changed underneath you; what you were entering for ${what} was not applied.`;
      if (editorHandle) editorHandle.note(message);
      else say(message);
    }
  }

  /* Where a message about a cluster control goes: the open editor's note
   * when a layer is open - it is the one line Station already keeps for
   * "why an edit did nothing" - and otherwise the status bar's notice,
   * ahead of what it was saying. Saying it again replaces it; saying
   * nothing clears it. The status line is redrawn from state either way,
   * so a repeated refusal reads once, not once per click. */
  function say(message) {
    if (editorHandle) { editorHandle.note(message); return; }
    const next = message || "";
    if (next === notice) return;
    notice = next;
    if (current.resolved) renderStatus(current.model, current.resolved);
  }

  /* A click on one of a hopper's operational controls - tracking on the
   * body, pump on the receiver. The request is what the control's
   * own element says (station-hopper-controls.js reads the address, the
   * state as drawn and whether the command is on offer off it), the
   * toggle goes to the application as one command, and the answer runs
   * the same publish policy the editor's commands run: the hopper is
   * redrawn from the application's snapshot, showing what it applied.
   * Nothing here selects, opens or closes anything - the control is the
   * whole of the click, and a hopper's focus behaviour is the hopper's
   * own hit, untouched. `is-pending` marks the control for the answer's
   * duration and is removed on every path out. */
  function toggleHopperControl(element) {
    if (!hopperControls) return;
    const request = hopperControls.requestFrom(element);
    if (!request) return;
    if (!request.able) {
      say(`${request.hopper || "This hopper"}'s ${hopperControls.LABEL[request.control]} cannot be changed here: ${hopperControls.reason(commandsFor(current.resolved), "current", request.control)}`);
      return;
    }
    let result;
    element.classList.add("is-pending");
    try {
      result = hopperControls.toggle(commandsFor(current.resolved), {
        control: request.control, layer: request.layer, index: request.index, next: !request.on
      });
    } finally {
      element.classList.remove("is-pending");
    }
    if (!result || !result.ok) {
      say(result && result.message ? result.message : "The change could not be applied.");
      return;
    }
    say("");
    if (result.changed) {
      lastOwnRevision = Number.isInteger(result.revision) ? result.revision : null;
      onPublish({ own: true });
    }
  }

  /* A click on a layer header's share - the drawn value, or the field
   * already in its slot. The request is what the share's own element
   * says (station-layer-share.js reads the layer and the offer off it);
   * the module opens its field in the slot, and each commit the field
   * makes is one command whose answer runs the same publish policy the
   * editor's commands run: the header is patched from the application's
   * snapshot, showing what it applied. Nothing here selects, opens or
   * closes anything - a share is edited with a layer open, with none,
   * and in Blend Edit alike. A second click on the slot that is already
   * open returns the caret to it; a click on another layer's slot has
   * already left this one (leaving the field commits it) by the time it
   * lands here. */
  function openShareEditor(element) {
    if (!layerShare) return;
    const request = layerShare.requestFrom(element);
    if (!request) return;
    if (shareHandle && shareHandle.isOpen() && shareHandle.layer === request.layer) {
      shareHandle.focus();
      return;
    }
    if (!request.able) {
      say(`Layer ${request.layer}'s share cannot be changed here: ${layerShare.reason(commandsFor(current.resolved), "current")}`);
      return;
    }
    if (shareHandle && shareHandle.isOpen()) shareHandle.commit();
    const recipe = "current";
    const layerState = current.resolved ? current.resolved.layerState : null;
    const handle = layerShare.open(mounts.machine.ownerDocument, {
      target: element,
      layer: request.layer,
      value: layerState && layerState[request.layer] ? layerState[request.layer].layerPct : null,
      commands: commandsFor(current.resolved),
      recipe,
      note: say,
      onEditing: record => {
        editing = record ? Object.assign({
          recipe,
          baseRevision: current.resolved ? current.resolved.revision : null
        }, record) : null;
      },
      onCommitted: result => {
        lastOwnRevision = Number.isInteger(result.revision) ? result.revision : null;
        onPublish({ own: true });
      },
      onClosed: () => { if (shareHandle === handle) shareHandle = null; }
    });
    shareHandle = handle;
  }

  /* The controller's render callback: the stage for the current line, at a
   * given focus. The selected target is drawn only on the layer that is
   * open, as before; the open layer's editor is built here and handed to
   * the renderer as the workspace's content, so the renderer never learns
   * what a recipe is. */
  function drawStage(focusLayer, extra) {
    highlighted = null;
    // A render replaces the editor, so no control can still be active.
    editing = null;
    shareHandle = null;
    const model = current.model;
    const hopperState = current.resolved ? current.resolved.hopperState : null;
    const layer = focusLayer && model ? model.layers.find(entry => entry.id === focusLayer) : null;
    const selectedHopper = focus && focus.layer === focusLayer ? focus.hopper : null;
    /* The editor shows the running job's hopper state - the Current
     * recipe - so that is the recipe every command it issues addresses,
     * named here once and passed explicitly; nothing is inherited from
     * whichever page the hidden Recipe editor happens to show. */
    const recipe = "current";
    const editor = layer ? focusEditor.create(mounts.machine.ownerDocument, {
      layer,
      hopperState,
      resins: catalogResins,
      selected: selectedHopper,
      commands: commandsFor(current.resolved),
      recipe,
      onSelect: hopper => setFocus({ layer: focusLayer, target: "cluster", hopper }),
      /* The editor reports the control the operator is in; Station keeps
       * the record, stamped with which recipe it addresses and the
       * revision it was entered at. */
      onEditing: record => {
        editing = record ? Object.assign({
          recipe,
          baseRevision: current.resolved ? current.resolved.revision : null
        }, record) : null;
      },
      /* A command changed something. The result's snapshot is the one the
       * bridge now holds; the publish policy runs over it at once, so the
       * stage, the inspector and the editor's rows show what the
       * application applied - not what was asked for. */
      onCommitted: result => {
        lastOwnRevision = Number.isInteger(result.revision) ? result.revision : null;
        onPublish({ own: true });
      }
    }) : null;
    editorHandle = editor;
    /* Blend Edit's cards: the same editor, compact, one per layer turned
     * over, addressed to the same recipe through the same bridge. Only in
     * the normal layout - the mode and an open layer are exclusive (see
     * enterBlendEdit) - and only for layers the model still has. */
    const cards = {};
    cardHandles = {};
    if (blendEdit.active && model && !focusLayer) {
      for (const entry of model.layers) {
        if (!isFlipped(entry.id)) continue;
        const card = focusEditor.create(mounts.machine.ownerDocument, {
          layer: entry,
          hopperState,
          resins: catalogResins,
          commands: commandsFor(current.resolved),
          recipe,
          variant: "compact",
          onEditing: record => {
            editing = record ? Object.assign({
              recipe,
              baseRevision: current.resolved ? current.resolved.revision : null
            }, record) : null;
          },
          onCommitted: result => {
            lastOwnRevision = Number.isInteger(result.revision) ? result.revision : null;
            onPublish({ own: true });
          }
        });
        if (!card) continue;
        cards[entry.id] = card.element;
        cardHandles[entry.id] = card;
      }
    }
    const svg = render.mountStage(mounts.machine, model, {
      hopperState,
      layerState: current.resolved ? current.resolved.layerState : null,
      focusLayer,
      selectedTarget: focus ? focus.target : null,
      selectedHopper,
      hopperControls: controlsFor(current.resolved),
      layerShare: shareFor(current.resolved),
      workspace: editor ? editor.element : null,
      blendEdit: blendEdit.active && !focusLayer,
      blendCards: cards,
      raiseLayer: extra && extra.raiseLayer
    });
    // A rendered stage is new elements: the marks the boot file owns are
    // written to it from the projection as it stands (feedJob follows
    // with the fresh one on every path that changes the job).
    applyRundownMarks();
    // The rail stands against the normal layout as drawn; a focused
    // layout is not measured (the rail has stepped back for it).
    if (!focusLayer) placeRail();
    return svg;
  }

  function prefersReducedMotion() {
    try {
      return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (error) {
      return false;
    }
  }

  /* Development-only transition controls, at ?transition=debug on the
   * standalone harness. As with the lab: station-host.js never loads the
   * module, so this is false in the application whatever the URL says. */
  function transitionDebugRequested() {
    if (!root.PolynStationTransitionDev) return false;
    try {
      return new URL(root.location.href).searchParams.get("transition") === "debug";
    } catch (error) {
      return false;
    }
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
    themeController = container.stationTheme || (doc.documentElement && doc.documentElement.stationTheme) || null;

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

    try {
      const params = new URL(root.location.href).searchParams;
      if (params.get("source") === "demo") sourceMode = source.MODE_DEMO;
      const demo = params.get("demo");
      if (demo && demoLines.DEMO_LINES.some(line => line.id === demo)) selectedDemoId = demo;
    } catch (error) { /* no URL to read; auto and the first demo are the right defaults */ }

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
      /* A ghost - a layer stepped back while another is open - is not a
       * control. The stylesheet makes it inert to the pointer; this is the
       * same rule for a click that reaches here anyway, so a target on a
       * layer that is not the open one changes nothing while one is open.
       * (Anything that resolves to no target at all, such as the editor's
       * blank space, has already returned above.) */
      const bank = hit.closest("[data-role='layer']");
      if (bank && bank.classList.contains("is-dimmed")) return;
      const shown = stage.getState().focusLayer;
      if (shown && layer !== shown) return;
      // The one hopper under the click, when the click is on one.
      const hopperEl = event.target.closest("[data-role='hopper']");
      const hopper = hopperEl ? hopperEl.getAttribute("data-hopper") : null;

      /* A hopper's operational controls - its receiver is the pump
       * toggle, its body the tracking toggle: the toggle, and nothing
       * else - no selection, no focus change. Resolved before anything
       * below because the control's cell sits inside the cluster's
       * target, and the nearest target is what the click means. The two
       * cells never overlap, so a click on the receiver cannot toggle
       * tracking and a click on the body cannot toggle the pump. */
      if (target === "tracking" || target === "pump") {
        toggleHopperControl(hit);
        return;
      }

      /* The header's share: its field, in the slot. Like the controls
       * above, the whole of the click - no selection, no focus change -
       * and open in every mode, Blend Edit included, so the mode's guard
       * below never sees it. */
      if (target === "share") {
        openShareEditor(hit);
        return;
      }
      /* While Blend Edit is on, the train opens nothing: the compact face
       * and the focused editor are two ways to edit the same layer, and
       * the operator is in one of them. The click is the mode's per-layer
       * switch instead - that layer over, or back to its hoppers. */
      if (blendEdit.active && opensLayer(target)) {
        flipLayer(layer);
        return;
      }

      setFocus({ layer, target, hopper });
    });

    /* Hover and keyboard focus link a drawn hopper to its editor row and
     * back: whichever side the pointer is on, both are highlighted. The
     * two sides share data-hopper and data-layer, so one lookup serves
     * both, and nothing is held but the key. */
    mounts.machine?.addEventListener("mouseover", event => highlight(hopperAt(event.target)));
    mounts.machine?.addEventListener("mouseleave", () => highlight(null));
    mounts.machine?.addEventListener("focusin", event => highlight(hopperAt(event.target)));
    mounts.machine?.addEventListener("focusout", event => {
      if (!hopperAt(event.relatedTarget)) highlight(null);
    });

    // Escape leaves whatever is open, which is the exit people try first -
    // including a layer that is still on its way open, which turns around.
    doc.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      if (focus) { clearFocus(); return; }
      // With nothing open, Escape leaves Blend Edit - the same exit Done
      // is, with the same commit of whatever field was being entered.
      if (blendEdit.active) exitBlendEdit();
    });

    let devPanel = null;
    stage = transition.createController({
      mount: mounts.machine,
      render: drawStage,
      reducedMotion: prefersReducedMotion,
      onChange: state => { if (devPanel) devPanel.update(state); syncRail(); }
    });

    if (transitionDebugRequested()) {
      devPanel = root.PolynStationTransitionDev.mount(container, doc, {
        stage,
        open: layer => setFocus({ layer, target: "mixer" }),
        close: clearFocus
      });
    }

    renderAll();

    // Every published change goes through the publish policy above: a
    // value-only change is patched into the stage and the editor in place,
    // a structural one is a full render. The bridge coalesces publishes
    // within a tick, so a burst of edits in the application produces one
    // pass here rather than one per keystroke. This is the only path by
    // which live state reaches Station - there is no polling and no second
    // subscription to anything else.
    bridge?.subscribe(() => { onPublish(); });

    /* The line console, in the header's slot. It subscribes to the
     * connection bridge itself and redraws from each descriptor; a
     * connection change never touches the stage, and a job change never
     * touches the console - the two bridges publish independently. */
    if (syncConsole && mounts.connection) {
      const lineConsole = syncConsole.create(doc, { connection });
      mounts.connection.appendChild(lineConsole.element);
    }

    /* Station's picture, in the header's first slot. */
    if (avatar && mounts.avatar) {
      mounts.avatar.appendChild(avatar.create(doc).element);
    }

    /* The run-down timeline across the foot of the workspace, and the
     * header's job controls that set what it projects from. The timeline
     * keeps the one coarse clock this screen has - and its own 6H | 12H
     * scale, in its Now column; the controls' changeover readout follows
     * the clock through onTick rather than keeping a second. The
     * controls' commands run the same publish policy the editor's do. */
    if (rundownTimeline && mounts.timeline) {
      timeline = rundownTimeline.create(doc, {
        view: root,
        /* One clock for everything that follows it: the header's
         * readout, the calculator's, and the overdue marks on the
         * hoppers, all from the pass the timeline just made. */
        onTick: () => {
          if (jobPanel) jobPanel.refresh();
          if (changeoverPanel) changeoverPanel.refresh();
          applyRundownMarks();
        }
      });
      mounts.timeline.appendChild(timeline.element);
    }
    if (jobControls && mounts.job) {
      jobPanel = jobControls.create(doc, {
        commands: () => commandsFor(current.resolved),
        onCommitted: result => {
          lastOwnRevision = Number.isInteger(result.revision) ? result.revision : null;
          onPublish({ own: true });
        },
        /* The changeover readout launches the calculator when the page
         * has one; without it the readout keeps its own field. */
        onChangeover: changeoverCalculator && changeoverEstimate && mounts.utility
          ? () => { if (changeoverPanel) changeoverPanel.toggle(); }
          : null
      });
      mounts.job.appendChild(jobPanel.element);
    }

    /* The Changeover Calculator, in the utility slot over the stage's
     * upper part. Handed the job controls' apply for the deadline - the
     * one write it makes, and not its own - the offer for what is on
     * screen, and the device's storage for the wizard's records
     * (changeover-estimate.js reads it; this file never names it). */
    if (changeoverCalculator && changeoverEstimate && mounts.utility && jobPanel) {
      changeoverPanel = changeoverCalculator.create(doc, {
        apply: at => jobPanel.apply("changeover", at),
        canApply: () => jobControls.able(commandsFor(current.resolved), "changeover"),
        storage: changeoverEstimate.storageFrom(root),
        anchor: jobPanel.trigger("changeover"),
        mount: mounts.utility,
        reducedMotion: prefersReducedMotion,
        onOpenChange: open => jobPanel.setLaunched(open)
      });
      if (changeoverPanel) mounts.utility.appendChild(changeoverPanel.element);
    }

    /* The machine utility rail, in its own slot over the stage: Blend
     * Edit's switch and Reset Tracking. Handed the two callbacks and
     * nothing else; told what to show by syncRail, and where to stand by
     * placeRail after each render of the normal layout and whenever the
     * stage's cell changes size. */
    if (machineRail && mounts.rail) {
      railPanel = machineRail.create(doc, {
        onBlendEdit: toggleBlendEdit,
        onResetTracking: resetTracking,
        setTimeout: typeof root.setTimeout === "function" ? root.setTimeout.bind(root) : null,
        clearTimeout: typeof root.clearTimeout === "function" ? root.clearTimeout.bind(root) : null
      });
      mounts.rail.appendChild(railPanel.element);
      if (typeof root.ResizeObserver === "function" && mounts.machine) {
        try {
          new root.ResizeObserver(() => placeRail()).observe(mounts.machine);
        } catch (error) { /* the resize listener below stands in */ }
      } else if (typeof root.addEventListener === "function") {
        root.addEventListener("resize", () => placeRail());
      }
      // The stage was drawn before the rail existed: told and placed now.
      syncRail();
      placeRail();
    }

    /* The Operator Handbook, in the slot laid over the stage. Built once
     * with its sections - the Recipe Book, Resin Totals, Appearance, Sudo - and
     * handed what they may use: the recipes bridge (read and request;
     * never the global reached for from inside). The book redraws from
     * the recipes bridge's own notifications, as the line console does
     * from the connection bridge's. Blend Edit is not the Handbook's:
     * closing it, or turning its pages, leaves the mode as it is. */
    if (handbook && mounts.handbook) {
      const handbookSections = [];
      if (recipeBook) handbookSections.push(recipeBook.section);
      if (resinTotalsSection) handbookSections.push(resinTotalsSection.section);
      if (appearance) handbookSections.push(appearance.section);
      if (sudo) handbookSections.push(sudo.section);
      handbookPanel = handbook.create(doc, {
        sections: handbookSections,
        context: {
          recipes,
          /* Sudo reads administrator access and asks for admin actions
           * through this bridge alone; handed in, never reached for. Its
           * Line Configuration reads which line this desktop is on from
           * the connection bridge, the same way. */
          admin,
          connection,
          /* A saved recipe's layer, accented by the side it sits on for
           * the line the stage shows: the line model's own role for that
           * letter, so the book and the banks above agree about Layer A. */
          layerRole: name => {
            const layer = current.model ? current.model.layers.find(entry => entry.id === name) : null;
            return layer ? layer.role : "";
          },
          /* Resin Totals reads the same resolved state the stage draws
           * from - through a function, since `current` is replaced on
           * every render - and the shared calculation to run over it. */
          resolved: () => current.resolved,
          resinTotals,
          /* Its two fields (production and scrap pounds) write through
           * the same offer and the same publish policy as the header's
           * job controls: the bridge for what is on screen, and the
           * answer re-run as the operator's own publish. */
          commands: () => commandsFor(current.resolved),
          onCommitted: result => {
            lastOwnRevision = Number.isInteger(result.revision) ? result.revision : null;
            onPublish({ own: true });
          },
          theme: themeController,
          themes: theme ? theme.THEMES : [],
          families: theme ? theme.FAMILIES : [],
          /* The Appearance gallery's miniatures: a picture per theme,
           * drawn under that theme's own tokens. Presentation only. */
          preview: themePreview
        },
        mount: mounts.handbook,
        reducedMotion: prefersReducedMotion
      });
      mounts.handbook.appendChild(handbookPanel.element);
      recipes?.subscribe(() => { if (handbookPanel) handbookPanel.update(); });
      admin?.subscribe(() => { if (handbookPanel) handbookPanel.update(); });
    }
    feedJob(current.model, current.resolved);
  }

  if (root.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
