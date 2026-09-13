/* Resin Totals - the arithmetic behind the application's Resin Totals
 * section, as one pure module.
 *
 * WHAT IT IS
 *
 * How many pounds of each resin a job consumed: the production and scrap
 * pounds the operator entered, split across the recipe by each layer's share
 * of the film and each hopper's share of its layer, then gathered by resin
 * code. This is the application's own calculation, moved here verbatim from
 * app.js's renderResinCalculator so that the floor UI (Legacy) and the
 * Station Operator Handbook run the SAME function over the same inputs -
 * one interpretation of Resin Totals, not two that happen to agree today.
 *
 * WHAT IT PRESERVES, DELIBERATELY
 *
 *   - clampNum / normName / keyName are the application's own helpers,
 *     copied character for character. keyName is what the application
 *     buckets by AND what it re-keys scanned lots by (rekeyLotMap), so a
 *     lot stored against a code is found here under the same key. Note
 *     that normName's regex is written `\\s+` in the application - a
 *     literal backslash followed by s's, not whitespace - so it does not
 *     collapse inner spaces; that is what the application does, and what
 *     this module does. Changing it would change which hoppers group
 *     together, a data-semantics change that belongs to the application,
 *     not to a presentation layer.
 *   - Hoppers with no resin name, a non-positive percentage, or a
 *     non-positive share of the total are skipped, exactly as before.
 *   - Rows keep the first-seen spelling of a code as their display name
 *     and are sorted by pounds, descending (a stable sort over insertion
 *     order, so equal pounds keep recipe order).
 *   - Pounds are truncated, never rounded, when shown as whole pounds -
 *     the application's fmtLb - because the operator enters and tracks
 *     whole pounds.
 *
 * It reads nothing but its arguments and returns fresh plain objects. It
 * knows nothing of the DOM, storage, or the bridge.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynResinTotals = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* The application's helpers, verbatim (app.js). */
  function clampNum(x){
    if (x === null || x === undefined) return 0;
    const s = String(x).trim();
    if (s === "") return 0;
    const cleaned = s.replace(/,/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  function normName(s){ return String(s || "").trim().replace(/\\s+/g, " "); }
  function keyName(s){ return normName(s).toUpperCase(); }

  /* Whole pounds as the application shows them: truncated, so 534.6 reads
   * as 534. Null for anything that is not a finite number. */
  function wholePounds(n) {
    return Number.isFinite(n) ? Math.floor(n) : null;
  }

  /**
   * Compute Resin Totals.
   *
   * @param {object} input
   * @param {*}      input.prodResinLb   production pounds, as stored (number or string)
   * @param {*}      input.scrapResinLb  scrap pounds, as stored
   * @param {Array}  input.layers        [{ layerPct, hoppers: [{ pct, resinName }] }]
   *        in recipe order - the application's state.layers or the state
   *        bridge's projection of them; only these three fields are read
   * @param {object} [input.lots]        resin code -> scanned lot, keyed by
   *        keyName (the application's state.resinLots)
   * @returns {{ prod:number, scrap:number, total:number,
   *            rows: Array<{ key:string, displayName:string, lbs:number, lot:string }> }}
   */
  function compute(input) {
    const settings = input || {};
    const prod = clampNum(settings.prodResinLb);
    const scrap = clampNum(settings.scrapResinLb);
    const total = prod + scrap;
    const layers = Array.isArray(settings.layers) ? settings.layers : [];
    const lots = settings.lots && typeof settings.lots === "object" && !Array.isArray(settings.lots) ? settings.lots : {};

    const div = 100;
    const totals = new Map();

    layers.forEach((L)=>{
      if (!L) return;
      const layerFrac = clampNum(L.layerPct) / div;
      (Array.isArray(L.hoppers) ? L.hoppers : []).forEach((h)=>{
        if (!h) return;
        const name = normName(h.resinName);
        if (!name) return;
        const hopperFrac = clampNum(h.pct) / div;
        if (hopperFrac <= 0) return;
        const lbs = total * layerFrac * hopperFrac;
        if (!Number.isFinite(lbs) || lbs <= 0) return;

        const k = keyName(name);
        if (!totals.has(k)) totals.set(k, { key: k, displayName: name, lbs: 0 });
        totals.get(k).lbs += lbs;
      });
    });

    const rows = Array.from(totals.values()).sort((a,b)=>b.lbs - a.lbs).map(row => {
      const lot = lots[row.key];
      return { key: row.key, displayName: row.displayName, lbs: row.lbs, lot: typeof lot === "string" ? lot : "" };
    });

    return { prod, scrap, total, rows };
  }

  return Object.freeze({ clampNum, normName, keyName, wholePounds, compute });
});
