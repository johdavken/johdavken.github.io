(function(root, factory){
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynProductDensity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  "use strict";

  /* A recipe's product density, from its resins' densities in the catalog.
   *
   * Recipe percentages are by weight - each hopper's blend within its
   * layer, each layer's share of the film - and blended resins add by
   * volume, so the density is the weighted HARMONIC mean:
   *
   *   density = sum(w) / sum(w / resin density),   w = layer% x hopper%
   *
   * It is all or nothing: a recipe with one resin the catalog has no
   * density for has no product density, and the resins it lacks are
   * named. Nothing is guessed and nothing is left out of the average.
   */

  function code(value){
    return String(value == null ? "" : value).trim().replace(/\s+/g, " ").toUpperCase();
  }

  function positive(value){
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  /**
   * A recipe's hoppers as weighted items, each with its resin's density
   * from the catalog, or null where the catalog has none. A hopper with no
   * resin or no blend, or in a layer with no share, weighs nothing and is
   * not an item.
   *
   * @param {object} hoppers   by "layer:index" -> { resinName, pct }
   * @param {object} layers    by layer name -> { layerPct }
   * @param {Array} catalog    [{ resin_code, density_g_cm3 }]
   * @returns {Array<{code:string, weight:number, density:number|null}>}
   */
  function itemsFrom(hoppers, layers, catalog){
    const densities = new Map();
    for (const resin of Array.isArray(catalog) ? catalog : []){
      const key = code(resin && (resin.resin_code != null ? resin.resin_code : resin.code));
      const density = positive(resin && (resin.density_g_cm3 != null ? resin.density_g_cm3 : resin.density));
      if (key && density !== null) densities.set(key, density);
    }
    const items = [];
    const byLayer = layers && typeof layers === "object" ? layers : {};
    for (const [slot, hopper] of Object.entries(hoppers && typeof hoppers === "object" ? hoppers : {})){
      const key = code(hopper && hopper.resinName);
      const pct = positive(hopper && hopper.pct);
      const share = positive((byLayer[String(slot).split(":")[0]] || {}).layerPct);
      if (!key || pct === null || share === null) continue;
      items.push({ code: key, weight: (share / 100) * (pct / 100), density: densities.has(key) ? densities.get(key) : null });
    }
    return items;
  }

  /**
   * @param {Array<{code:string, weight:number, density:number|null}>} items
   * @returns {{density:number|null, missing:string[], empty:boolean}}
   *   `empty` when there is no recipe to weigh; `missing` the resins (once
   *   each, in recipe order) with no density - either leaves density null.
   */
  function productDensity(items){
    const list = Array.isArray(items) ? items.filter(item => item && positive(item.weight) !== null) : [];
    if (!list.length) return { density: null, missing: [], empty: true };
    const missing = [];
    for (const item of list) if (positive(item.density) === null && !missing.includes(item.code)) missing.push(item.code);
    if (missing.length) return { density: null, missing, empty: false };
    let weight = 0;
    let volume = 0;
    for (const item of list){
      weight += item.weight;
      volume += item.weight / item.density;
    }
    return { density: weight / volume, missing: [], empty: false };
  }

  /** "0.923" - three places, as densities are written. */
  function format(value){
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(3) : "—";
  }

  return Object.freeze({ itemsFrom, productDensity, format });
});
