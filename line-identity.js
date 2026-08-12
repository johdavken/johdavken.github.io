(function(root, factory){
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynLineIdentity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
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
    linkedWorkspace, linkedLineNumber, requiredLayerCountForSync
  };
});
