(function(root, factory){
  // Layer *names* stay owned by the payload module - this file resolves which
  // physical side each end layer is on, never what the layers are called.
  const dependency = typeof require === "function" ? require("./workspace-configuration-payloads.js") : (root && root.PolynWorkspaceConfigurationPayloads);
  const api = factory(dependency);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynLineIdentity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(payloads){
  "use strict";

  function normalizeLineName(value){
    return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  }

  function structuredLineNumber(workspace){
    const candidates = [
      workspace?.line_number,
      workspace?.lineNumber,
      workspace?.metadata?.line_number,
      workspace?.metadata?.lineNumber
    ];
    for (const candidate of candidates){
      if (candidate === null || candidate === undefined || candidate === "") continue;
      const number = Number(candidate);
      if (Number.isInteger(number) && number > 0) return number;
    }
    return null;
  }

  function isExactLineWorkspace(workspace, lineNumber){
    if (!workspace || !workspace.id || !Number.isInteger(Number(lineNumber))) return false;
    const structured = structuredLineNumber(workspace);
    if (structured !== null) return structured === Number(lineNumber);
    return normalizeLineName(workspace.name) === `line ${Number(lineNumber)}`;
  }

  function isCurrentLineWorkspace(syncState, lineNumber){
    const selectedWorkspace = syncState?.selectedWorkspace;
    return !!(
      syncState?.selectedWorkspaceId &&
      selectedWorkspace?.id === syncState.selectedWorkspaceId &&
      isExactLineWorkspace(selectedWorkspace, lineNumber)
    );
  }

  /* --------------------------------------------------------------------
   *   Physical line identity -> required layer count
   * ------------------------------------------------------------------ */

  // Physical configuration of each line on the floor. Lines 1-15 are four
  // separate identities per row of the source table, never a single
  // "Line 1-4" workspace.
  const LAYER_COUNT_BY_LINE = Object.freeze({
    1:1, 2:1, 3:1, 4:1,
    5:3, 6:3, 7:3, 8:3, 9:3,
    10:5, 11:5,
    12:3, 13:3, 14:3,
    15:5
  });

  // Anchored match on the fully normalized name, so "Line 1" can never be
  // read out of "Line 10", "Line 1-4", or "Production Line 1 backup", and no
  // unrelated number elsewhere in a workspace name is ever treated as a line.
  const EXACT_LINE_LABEL = /^line (\d+)$/;

  function workspaceLineNumber(workspace){
    if (!workspace || !workspace.id) return null;
    const structured = structuredLineNumber(workspace);
    if (structured !== null) return structured;
    const match = EXACT_LINE_LABEL.exec(normalizeLineName(workspace.name));
    if (!match) return null;
    const number = Number(match[1]);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  function requiredLayerCount(lineNumber){
    const number = Number(lineNumber);
    if (!Number.isInteger(number)) return null;
    return Object.prototype.hasOwnProperty.call(LAYER_COUNT_BY_LINE, number)
      ? LAYER_COUNT_BY_LINE[number]
      : null;
  }

  /* --------------------------------------------------------------------
   *   Physical line identity -> layer orientation
   * ------------------------------------------------------------------ */

  // Which physical side of the film Layer A sits on. Lines 1-4 are single
  // layer and are deliberately absent rather than mapped to a meaningless
  // value - there is no inside/outside decision to make on a line that
  // extrudes one layer. This is the only place the rule is written down; the
  // Line Setup Overview and both document scanners read it from here.
  const LAYER_A_POSITION_BY_LINE = Object.freeze({
    5:"inside", 6:"inside", 7:"inside", 8:"inside",
    9:"outside", 10:"outside", 11:"outside", 12:"outside",
    13:"outside", 14:"outside", 15:"outside", 16:"outside"
  });

  const OPPOSITE_POSITION = Object.freeze({ inside:"outside", outside:"inside" });

  function layerAPosition(lineNumber){
    const number = Number(lineNumber);
    if (!Number.isInteger(number)) return null;
    return Object.prototype.hasOwnProperty.call(LAYER_A_POSITION_BY_LINE, number)
      ? LAYER_A_POSITION_BY_LINE[number]
      : null;
  }

  // The two end layers, outermost pair first. Derived rather than tabulated:
  // the layers are a physical stack, so once Layer A's side is known the
  // opposite end is the last layer, whatever the line's layer count names it
  // (C on a 3-layer line, E on a 5-layer line). buildRecipePayloadFromScan
  // already reverses the whole printed order on exactly this basis.
  function layerOrderRows(layerCount, position){
    if (!position || !(layerCount > 1)) return null;
    const names = payloads?.expectedLayerNames?.(layerCount);
    if (!names || names.length < 2) return null;
    return [
      { layer: names[0], position },
      { layer: names[names.length - 1], position: OPPOSITE_POSITION[position] }
    ];
  }

  /**
   * The one place line-specific physical facts are resolved. `layerCount`
   * stays sourced from LAYER_COUNT_BY_LINE, so this never second-guesses the
   * existing derived-layer-count behavior.
   *
   * A field is null whenever the answer is genuinely unknown - an unmapped
   * line number, or a line whose layer count this app does not know - so
   * callers fail clearly instead of guessing.
   */
  function getLineConfiguration(lineNumber){
    const number = Number(lineNumber);
    if (!Number.isInteger(number) || number <= 0) return null;
    const layerCount = requiredLayerCount(number);
    const position = layerAPosition(number);
    // A single-layer line has no orientation at all, which is different from
    // a multilayer line whose orientation we happen not to know.
    const singleLayer = layerCount === 1;
    const orientation = singleLayer ? null : position;
    return {
      lineNumber: number,
      layerCount,
      singleLayer,
      layerAPosition: orientation,
      layerOrder: layerOrderRows(layerCount, orientation)
    };
  }

  // null means the same thing it does for the layer count: no linked line, or
  // a linked workspace that cannot be mapped confidently to a known line.
  function getLineConfigurationForSync(syncState){
    return getLineConfiguration(linkedLineNumber(syncState));
  }

  // "Deliberately linked", not "currently reachable". cloud-sync's `connected`
  // flag tracks disconnectedWorkspaceIds - the operator's own unlink action -
  // and is unaffected by network state, so a transient outage, a reconnecting
  // session, and a launch with no connectivity all stay linked here. Only
  // disconnectLocal/leaveWorkspace/deleteWorkspace clear it.
  function linkedWorkspace(syncState){
    const workspace = syncState?.selectedWorkspace;
    if (!syncState?.selectedWorkspaceId) return null;
    if (workspace?.id !== syncState.selectedWorkspaceId) return null;
    if (!syncState.connected) return null;
    return workspace;
  }

  function linkedLineNumber(syncState){
    return workspaceLineNumber(linkedWorkspace(syncState));
  }

  // null means "the operator keeps manual control": unlinked, or linked to a
  // workspace that cannot be mapped confidently to a known line.
  function requiredLayerCountForSync(syncState){
    return requiredLayerCount(linkedLineNumber(syncState));
  }

  function hopperNamingMode(syncState){
    return isCurrentLineWorkspace(syncState, 9) ? "main" : "standard";
  }

  function hopperPositionLabel(index, syncState){
    const position = Number(index);
    if (!Number.isInteger(position) || position < 0 || position > 5) return "";
    if (hopperNamingMode(syncState) === "main") return position === 0 ? "Main" : String(position);
    return String(position + 1);
  }

  function hopperBadgeLabel(layerName, index, syncState){
    const position = hopperPositionLabel(index, syncState);
    if (!position) return String(layerName || "");
    return `${String(layerName || "")}${position === "Main" ? "M" : position}`;
  }

  return {
    normalizeLineName, structuredLineNumber, isExactLineWorkspace, isCurrentLineWorkspace,
    hopperNamingMode, hopperPositionLabel, hopperBadgeLabel,
    LAYER_COUNT_BY_LINE, workspaceLineNumber, requiredLayerCount,
    linkedWorkspace, linkedLineNumber, requiredLayerCountForSync,
    LAYER_A_POSITION_BY_LINE, layerAPosition, getLineConfiguration, getLineConfigurationForSync
  };
});
