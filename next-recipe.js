(function (root, factory) {
  const dependency = typeof require === "function" ? require("./workspace-configuration-payloads.js") : (root && root.PolynWorkspaceConfigurationPayloads);
  const api = factory(dependency);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynNextRecipe = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (payloads) {
  "use strict";

  // The planned recipe for the upcoming changeover.
  //
  // Deliberately stored as an ordinary recipe payload - the exact schema
  // createRecipePayload() produces and applyRecipePayload() consumes, the same
  // one saved recipes and scan results already use. That is what keeps this a
  // small extension rather than a second recipe system:
  //
  //   saved recipe -> nextRecipe            (just store the payload)
  //   scan result  -> nextRecipe            (just store the payload)
  //   nextRecipe   -> current               (applyRecipePayload, so loading
  //                                          Next behaves exactly like loading
  //                                          a saved recipe: recipe fields are
  //                                          replaced, and weight / track /
  //                                          pumpOff / Smart Hopper dimensions
  //                                          are carried forward from the
  //                                          hopper already in that position)
  //
  // A recipe payload carries no operational or physical state at all, so the
  // planned recipe structurally cannot hold its own tracking, pump-off,
  // receiver weights or hopper dimensions. Those belong to the line.

  const HOPPERS_PER_LAYER = 6;

  function isPlainObject(value){
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  /** The planned recipe as it stands, or null when nothing is planned. */
  function fromState(state){
    return normalize(state?.nextRecipe);
  }

  /** A recipe payload snapshotted from the live recipe. */
  function fromCurrent(state){
    return payloads.createRecipePayload(state);
  }

  function clampPct(value){
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return 0;
    return number > 100 ? 100 : number;
  }

  /**
   * Structural normalization for storage. Deliberately lenient about
   * completeness: a plan is built up over minutes, so for most of its life its
   * layer percentages do not total 100 and full recipe validation would reject
   * it. Requiring validity here would silently discard the operator's
   * half-finished plan on every autosave.
   *
   * What is enforced is shape - a known line type, the right layers by name,
   * six hoppers each, numbers in range - so nothing malformed reaches the
   * grid. Whether a plan is complete enough to become the live recipe is a
   * separate question, answered by isPromotable() at promotion time.
   */
  function normalize(raw){
    if (!isPlainObject(raw)) return null;
    const names = payloads.expectedLayerNames(raw.line_type);
    if (!names) return null;
    if (!Array.isArray(raw.layers) || raw.layers.length !== names.length) return null;

    const layers = names.map(name=>{
      const layer = raw.layers.find(item=>isPlainObject(item) && item.name === name);
      if (!layer) return null;
      const hoppers = Array.from({ length: HOPPERS_PER_LAYER }, (_, index)=>{
        const hopper = Array.isArray(layer.hoppers) ? layer.hoppers[index] : null;
        const resin = isPlainObject(hopper) && typeof hopper.resin_name === "string" ? hopper.resin_name.trim() : "";
        return { resin_name: resin || null, pct: clampPct(isPlainObject(hopper) ? hopper.pct : 0) };
      });
      return { name, layer_pct: clampPct(layer.layer_pct), hoppers };
    });
    if (layers.some(layer=>layer === null)) return null;

    return {
      schema_version: payloads.SCHEMA_VERSION,
      line_type: Number(raw.line_type),
      hopper_naming_mode: raw.hopper_naming_mode === "main" ? "main" : "standard",
      layers
    };
  }

  /**
   * Whether a plan is complete enough to become the live recipe. This is the
   * full recipe contract - the same validation a saved recipe must pass - and
   * is what gates Load Next Recipe.
   */
  function isPromotable(payload){
    const recipe = normalize(payload);
    if (!recipe) return false;
    return payloads.validateRecipePayload(recipe).valid;
  }

  /**
   * Whether a planned recipe is worth telling the operator about.
   *
   * An empty recipe still has a full structure - every layer, six hoppers,
   * H1 sitting at its calculated 100% - so structure alone means nothing. What
   * counts is an operator actually having assigned something: a resin name
   * anywhere, or a percentage on a hopper other than H1 (H1 is derived, so it
   * is non-zero even in a blank recipe and can never be the signal).
   */
  function isMeaningful(payload){
    const recipe = normalize(payload);
    if (!recipe) return false;
    return recipe.layers.some(layer=>
      layer.hoppers.some((hopper, index)=>
        (typeof hopper.resin_name === "string" && hopper.resin_name.trim() !== "") ||
        (index > 0 && Number(hopper.pct) > 0)
      )
    );
  }

  /**
   * A compact description of what promoting Next would change, for the
   * confirmation dialog. Deliberately counts rather than rendering a full
   * diff: the operator needs to grasp the scale of the change, and the grid
   * itself is where the detail belongs.
   */
  function summarizeChange(currentPayload, nextPayload){
    const current = normalize(currentPayload);
    const next = normalize(nextPayload);
    if (!next) return null;

    const layerChanges = [];
    let resinChanges = 0;
    let percentageChanges = 0;

    next.layers.forEach(layer=>{
      const before = current?.layers?.find(item=>item.name === layer.name);
      const beforePct = before ? Number(before.layer_pct) : null;
      const afterPct = Number(layer.layer_pct);
      if (beforePct === null || beforePct !== afterPct){
        layerChanges.push({ name: layer.name, from: beforePct, to: afterPct });
      }
      layer.hoppers.forEach((hopper, index)=>{
        const previous = before?.hoppers?.[index];
        const beforeName = (previous?.resin_name || "").trim();
        const afterName = (hopper.resin_name || "").trim();
        if (beforeName !== afterName) resinChanges += 1;
        if (Number(previous?.pct ?? -1) !== Number(hopper.pct)) percentageChanges += 1;
      });
    });

    return {
      layerChanges,
      resinChanges,
      percentageChanges,
      lineTypeChanged: Number(current?.line_type) !== Number(next.line_type),
      unchanged: layerChanges.length === 0 && resinChanges === 0 && percentageChanges === 0
    };
  }

  return {
    HOPPERS_PER_LAYER,
    fromState,
    fromCurrent,
    normalize,
    isPromotable,
    isMeaningful,
    summarizeChange
  };
});
