/* The demo line: what Slate shows when no application is connected.
 *
 * One three-layer line, in the state bridge's own snapshot shape, so the
 * rest of Slate cannot tell demo from live. Unlike Station's demo lines it
 * carries a job - an output rate, a changeover a few hours out, a couple
 * of tracked hoppers and one pumped off - so the run-down summary and the
 * job's cards have something to show on the standalone harness. Nothing
 * here is persisted, and a demo is never writable (slate.js hands the
 * command bridge only to a live source).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateDemo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const HOUR = 60 * 60 * 1000;

  function hopper(index, resinName, pct, weight, options) {
    const settings = options || {};
    return {
      index, pct, resinName,
      weight, usableHeight: 0, usableGallons: 0,
      effectiveWeight: weight, smartWeight: null,
      track: !!settings.track,
      pumpOff: !!settings.pumpOff
    };
  }

  function empty(index) {
    return hopper(index, "", 0, 0);
  }

  function clock(at) {
    const date = new Date(at);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  /**
   * @param {number} [now]  epoch ms; the changeover is set five hours out
   */
  function snapshot(now) {
    const at = Number.isFinite(now) ? now : Date.now();
    const changeover = at + 5 * HOUR;
    return {
      revision: 0,
      line: {
        lineNumber: 5,
        displayName: "Line 5 (demo)",
        layerCount: 3,
        layerAPosition: "inside",
        hopperNamingMode: "standard",
        hopperGeometry: null,
        hopperManufacturer: "plast-control",
        hopperCounts: [6, 4, 6],
        linked: false
      },
      job: {
        lineRate: 850,
        gauge: 0,
        changeoverTime: clock(changeover),
        changeoverSetAt: at,
        prodResinLb: 12400,
        scrapResinLb: 310
      },
      lots: {},
      sources: { current: {}, next: {} },
      nextRecipe: null,
      history: { current: { canUndo: false, canRedo: false }, next: { canUndo: false, canRedo: false } },
      smartHoppers: { enabled: false, geometryMode: null, circumference: 0 },
      layers: [
        {
          name: "A", layerPct: 25,
          hoppers: [
            hopper(0, "HX204", 60, 400, { track: true }),
            hopper(1, "LD105", 30, 380, { track: true }),
            hopper(2, "AB120", 10, 120),
            empty(3), empty(4), empty(5)
          ]
        },
        {
          name: "B", layerPct: 50,
          hoppers: [
            hopper(0, "LL318", 70, 620, { track: true }),
            hopper(1, "HD622", 20, 260, { track: true, pumpOff: true }),
            hopper(2, "SL710", 10, 140),
            empty(3), empty(4), empty(5)
          ]
        },
        {
          name: "C", layerPct: 25,
          hoppers: [
            hopper(0, "EVA340", 80, 500),
            hopper(1, "AB120", 20, 90, { track: true }),
            empty(2), empty(3), empty(4), empty(5)
          ]
        }
      ]
    };
  }

  return Object.freeze({ snapshot });
});
