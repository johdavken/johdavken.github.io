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

  return { normalizeLineName, structuredLineNumber, isExactLineWorkspace, isCurrentLineWorkspace, hopperNamingMode, hopperPositionLabel, hopperBadgeLabel };
});
