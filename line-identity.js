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

  const LINE_CONFIGURATION_CACHE_KEY = "polyn.lineConfigurations.v1";

  const BUILT_IN_LINE_CONFIGURATIONS = Object.freeze([
    ...[1,2,3,4].map(lineNumber => ({ lineNumber, displayName:`Line ${lineNumber}`, aliases:[], layerCount:1, layerAPosition:null, hopperGeometry:"volume", hopperNamingMode:"standard", isActive:true, metadata:{} })),
    ...[5,6].map(lineNumber => ({ lineNumber, displayName:`Line ${lineNumber}`, aliases:[], layerCount:3, layerAPosition:"inside", hopperGeometry:"cylindrical", hopperNamingMode:"standard", isActive:true, metadata:{} })),
    ...[7,8].map(lineNumber => ({ lineNumber, displayName:`Line ${lineNumber}`, aliases:[], layerCount:3, layerAPosition:"inside", hopperGeometry:"volume", hopperNamingMode:"standard", isActive:true, metadata:{} })),
    { lineNumber:9, displayName:"Line 9", aliases:[], layerCount:3, layerAPosition:"outside", hopperGeometry:"cylindrical", hopperNamingMode:"main-plus-five", isActive:true, metadata:{} },
    ...[10,11].map(lineNumber => ({ lineNumber, displayName:`Line ${lineNumber}`, aliases:[], layerCount:5, layerAPosition:"outside", hopperGeometry:"cylindrical", hopperNamingMode:"standard", isActive:true, metadata:{} })),
    ...[12,13,14].map(lineNumber => ({ lineNumber, displayName:`Line ${lineNumber}`, aliases:[], layerCount:3, layerAPosition:"outside", hopperGeometry:"cylindrical", hopperNamingMode:"standard", isActive:true, metadata:{} })),
    { lineNumber:15, displayName:"Line 15", aliases:[], layerCount:5, layerAPosition:"outside", hopperGeometry:"cylindrical", hopperNamingMode:"standard", isActive:true, metadata:{} }
  ].map(Object.freeze));

  let configuredDefinitions = [];

  function normalizedDefinition(value){
    const lineNumber = Number(value?.lineNumber ?? value?.line_number);
    const displayName = String(value?.displayName ?? value?.display_name ?? "").trim();
    const aliases = Array.isArray(value?.aliases) ? value.aliases.map(alias=>String(alias).trim()).filter(Boolean) : [];
    const layerCount = Number(value?.layerCount ?? value?.layer_count);
    const layerAPosition = value?.layerAPosition ?? value?.layer_a_position ?? null;
    const hopperGeometry = value?.hopperGeometry ?? value?.hopper_geometry;
    const hopperNamingMode = value?.hopperNamingMode ?? value?.hopper_naming_mode;
    return { id:value?.id || null, lineNumber, displayName, aliases, layerCount,
      layerAPosition:layerAPosition === "n/a" ? null : layerAPosition,
      hopperGeometry, hopperNamingMode, isActive:value?.isActive ?? value?.is_active ?? true,
      metadata:value?.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) ? value.metadata : {},
      createdAt:value?.createdAt ?? value?.created_at ?? null, updatedAt:value?.updatedAt ?? value?.updated_at ?? null };
  }

  function validateLineConfigurations(values){
    const definitions = Array.isArray(values) ? values.map(normalizedDefinition) : [];
    const numbers = new Set();
    const activeNames = new Map();
    for (const definition of definitions){
      if (!Number.isInteger(definition.lineNumber) || definition.lineNumber < 1 || definition.lineNumber > 999) return { valid:false, message:"Line number must be between 1 and 999." };
      if (numbers.has(definition.lineNumber)) return { valid:false, message:`Line ${definition.lineNumber} is defined more than once.` };
      numbers.add(definition.lineNumber);
      if (!definition.displayName || definition.displayName.length > 80) return { valid:false, message:"Display name is required and must be 80 characters or fewer." };
      if (!Number.isInteger(definition.layerCount) || definition.layerCount < 1 || definition.layerCount > 9) return { valid:false, message:"Layers must be a whole number from 1 to 9." };
      if (![null,"inside","outside"].includes(definition.layerAPosition)) return { valid:false, message:"Layer A must be Inside, Outside, or N/A." };
      if (definition.layerCount === 1 && definition.layerAPosition !== null) return { valid:false, message:"A single-layer line must use N/A for Layer A." };
      if (definition.layerCount > 1 && definition.layerAPosition === null) return { valid:false, message:"A multilayer line needs a Layer A orientation." };
      if (!["cylindrical","volume"].includes(definition.hopperGeometry)) return { valid:false, message:"Choose a valid hopper geometry." };
      if (!["standard","main-plus-five"].includes(definition.hopperNamingMode)) return { valid:false, message:"Choose a valid hopper naming mode." };
      if (definition.aliases.some(alias=>alias.length > 80)) return { valid:false, message:"Additional names must be 80 characters or fewer." };
      if (!definition.isActive) continue;
      for (const name of [definition.displayName, ...definition.aliases]){
        const normalized = normalizeLineName(name);
        if (!normalized) continue;
        const owner = activeNames.get(normalized);
        if (owner && owner !== definition.lineNumber) return { valid:false, message:`“${name}” belongs to more than one active line.` };
        activeNames.set(normalized, definition.lineNumber);
      }
    }
    return { valid:true, definitions };
  }

  function setConfiguredLineConfigurations(values, { storage } = {}){
    const checked = validateLineConfigurations(values);
    if (!checked.valid) return checked;
    configuredDefinitions = checked.definitions;
    const target = storage === undefined ? (typeof localStorage !== "undefined" ? localStorage : null) : storage;
    try{ target?.setItem?.(LINE_CONFIGURATION_CACHE_KEY, JSON.stringify(configuredDefinitions)); }catch(error){}
    return { valid:true, definitions:getLineConfigurations() };
  }

  function loadCachedLineConfigurations(storage){
    const target = storage === undefined ? (typeof localStorage !== "undefined" ? localStorage : null) : storage;
    try{
      const raw = target?.getItem?.(LINE_CONFIGURATION_CACHE_KEY);
      if (!raw) return { valid:true, definitions:getLineConfigurations(), source:"built-in" };
      const result = setConfiguredLineConfigurations(JSON.parse(raw), { storage:null });
      return { ...result, source:result.valid ? "cache" : "built-in" };
    }catch(error){ return { valid:false, message:"Cached line configuration was invalid.", definitions:getLineConfigurations(), source:"built-in" }; }
  }

  function getLineConfigurations(){
    const configured = new Map(configuredDefinitions.map(item=>[item.lineNumber,item]));
    const merged = BUILT_IN_LINE_CONFIGURATIONS.map(item=>configured.get(item.lineNumber) || item);
    configuredDefinitions.forEach(item=>{ if (!BUILT_IN_LINE_CONFIGURATIONS.some(base=>base.lineNumber === item.lineNumber)) merged.push(item); });
    return merged.sort((a,b)=>a.lineNumber-b.lineNumber).map(item=>({ ...item, aliases:[...item.aliases], metadata:{...item.metadata}, source:configured.has(item.lineNumber) ? "configured" : "built-in" }));
  }

  function definitionForLine(lineNumber){
    const number = Number(lineNumber);
    return getLineConfigurations().find(item=>item.lineNumber === number) || null;
  }

  function configuredLineNumberForName(name){
    const normalized = normalizeLineName(name);
    if (!normalized) return null;
    const match = configuredDefinitions.find(item=>item.isActive && [item.displayName,...item.aliases].some(candidate=>normalizeLineName(candidate) === normalized))
      || getLineConfigurations().find(item=>item.source === "built-in" && item.isActive && [item.displayName,...item.aliases].some(candidate=>normalizeLineName(candidate) === normalized));
    return match?.lineNumber ?? null;
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
    const configured = configuredLineNumberForName(workspace.name);
    if (configured !== null) return configured;
    const match = EXACT_LINE_LABEL.exec(normalizeLineName(workspace.name));
    if (!match) return null;
    const number = Number(match[1]);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  function requiredLayerCount(lineNumber){
    return definitionForLine(lineNumber)?.layerCount ?? null;
  }

  /* --------------------------------------------------------------------
   *   Physical line identity -> Smart Hopper geometry mode
   * ------------------------------------------------------------------ */

  // Lines 1, 2, 3, 4, 7, and 8 have irregular, non-cylindrical receiver
  // hoppers rated only in usable gallons. Every other identified line has
  // uniform cylindrical hoppers (shared circumference + per-hopper usable
  // height). This is the one place that decision is written down - Smart
  // Hoppers rendering, editing, validation, and calculation in app.js all
  // resolve from here so they can never disagree with each other.
  const VOLUME_GEOMETRY_LINES = Object.freeze({ 1:true, 2:true, 3:true, 4:true, 7:true, 8:true });

  // null means the same thing it does for requiredLayerCount: an unmapped
  // line number, or no line number at all - never guessed at.
  function getSmartHopperGeometryMode(lineNumber){
    return definitionForLine(lineNumber)?.hopperGeometry ?? null;
  }

  function getSmartHopperGeometryModeForSync(syncState){
    return getSmartHopperGeometryMode(linkedLineNumber(syncState));
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
    return definitionForLine(lineNumber)?.layerAPosition ?? null;
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
    const definition = definitionForLine(number) || {
      lineNumber:number, displayName:`Line ${number}`, aliases:[], layerCount:null,
      layerAPosition:Object.prototype.hasOwnProperty.call(LAYER_A_POSITION_BY_LINE, number) ? LAYER_A_POSITION_BY_LINE[number] : null,
      hopperGeometry:null, hopperNamingMode:"standard", isActive:true, metadata:{}, source:"legacy"
    };
    const layerCount = definition.layerCount;
    const position = definition.layerAPosition;
    // A single-layer line has no orientation at all, which is different from
    // a multilayer line whose orientation we happen not to know.
    const singleLayer = layerCount === 1;
    const orientation = singleLayer ? null : position;
    return {
      ...definition, lineNumber: number,
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
    // Naming historically follows the selected workspace even while the
    // operator has deliberately unlinked it; preserve that behavior while
    // sourcing the value from the definition instead of a Line 9 branch.
    const mode = definitionForLine(workspaceLineNumber(syncState?.selectedWorkspace))?.hopperNamingMode;
    return mode === "main-plus-five" ? "main" : "standard";
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
    LAYER_A_POSITION_BY_LINE, layerAPosition, getLineConfiguration, getLineConfigurationForSync,
    VOLUME_GEOMETRY_LINES, getSmartHopperGeometryMode, getSmartHopperGeometryModeForSync,
    LINE_CONFIGURATION_CACHE_KEY, BUILT_IN_LINE_CONFIGURATIONS, normalizedDefinition,
    validateLineConfigurations, setConfiguredLineConfigurations, loadCachedLineConfigurations,
    getLineConfigurations, definitionForLine, configuredLineNumberForName
  };
});
