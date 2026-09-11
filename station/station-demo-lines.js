/* Demo line configurations for the Station shell.
 *
 * These exist to prove one thing: that the rendering layer accepts a layer
 * count and a hopper count as configuration, and that 1, 3 and 5 layers are
 * the same code path rather than three page implementations.
 *
 * They are NOT a second line catalog. Two of the four entries below resolve a
 * REAL line through PolynLineIdentity, so what Station draws for Line 5 and
 * Line 11 is what the existing app already believes about those lines. The
 * two literal entries cover the single-layer case and an off-catalog hopper
 * count, which is the case a hard-coded six would quietly break.
 *
 * Nothing here is persisted, synced, or written anywhere.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationDemoLines = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_DEMO_HOPPERS = 6;

  // Only the two catalog-resolved demos need this; it mirrors what
  // PolynLineIdentity says about those lines, and the fixture is demo-only.
  const LINE_LAYER_COUNTS = Object.freeze({ 5: 3, 11: 5 });

  const DEMO_LINES = Object.freeze([
    Object.freeze({
      id: "one-layer",
      label: "1 layer",
      note: "Literal config - single layer, no inside/outside orientation to make.",
      config: Object.freeze({
        lineNumber: 2,
        displayName: "Line 2 (demo)",
        layerCount: 1,
        layerAPosition: null,
        hopperNamingMode: "standard",
        hopperGeometry: "volume"
      })
    }),
    Object.freeze({
      id: "three-layer",
      label: "3 layers",
      note: "Resolved from the real line catalog - Layer A is on the inside here.",
      lineNumber: 5
    }),
    Object.freeze({
      id: "five-layer",
      label: "5 layers",
      note: "Resolved from the real line catalog - Layer A is on the outside here.",
      lineNumber: 11
    }),
    Object.freeze({
      id: "mixed-hoppers",
      label: "3 layers, mixed hopper counts",
      note: "Literal config - per-layer hopper counts, so six is a default and not a rule.",
      config: Object.freeze({
        lineNumber: 0,
        displayName: "Demo line (mixed hoppers)",
        layerCount: 3,
        layerAPosition: "outside",
        hopperNamingMode: "standard",
        hopperGeometry: "cylindrical",
        layers: Object.freeze([
          Object.freeze({ id: "A", hopperCount: 4 }),
          Object.freeze({ id: "B", hopperCount: 6 }),
          Object.freeze({ id: "C", hopperCount: 3 })
        ])
      })
    })
  ]);

  /* --------------------------------------------------------------------
   *   Demo recipe fixture
   * ------------------------------------------------------------------ */

  /* A plausible blend so the machine can be developed and reviewed with
   * something in it. Generated rather than tabulated, so it stays correct for
   * any layer and hopper count - including the mixed-hopper demo - instead of
   * going stale the first time one of those changes.
   *
   * Shaped as a bridge snapshot, so station-source.js reads it with exactly
   * the functions it reads live state with. Nothing here is persisted, synced,
   * or written anywhere, and it is only ever reached in demo mode. */
  const DEMO_RESINS = Object.freeze(["HX204", "LD105", "EVA340", "MB711", "LLD82", "HD960"]);

  // Most hoppers on a real line are empty. Three active per layer, the rest
  // unassigned, which is also what exercises the unassigned state.
  const DEMO_BLEND = Object.freeze([60, 30, 10]);

  /* Usable heights in inches, cycled across each bank. Real banks are not all
   * one size, and a fixture where every hopper is identical would make the
   * height-to-scale drawing look like it does nothing. The spread deliberately
   * covers both ends of the clamp. */
  const DEMO_HEIGHTS = Object.freeze([30, 22, 34, 26, 36, 28]);

  // Pump off on one hopper per bank, so the receiver's two states are both
  // visible without anyone having to go and set one.
  const DEMO_PUMP_OFF_INDEX = 1;

  /* Hookup sources on some hoppers and not others, because "present" and
   * "absent" are two different presentations and both need to be reviewable
   * side by side: a labelled hopper, and a quiet one with no placeholder. */
  const DEMO_SOURCES = Object.freeze(["SILO 3", "", "BOX 12"]);

  // Layer shares by layer count. A core-heavy structure reads as a real
  // recipe; an even split reads as a placeholder.
  const DEMO_LAYER_SPLITS = Object.freeze({
    1: Object.freeze([100]),
    3: Object.freeze([25, 50, 25]),
    5: Object.freeze([15, 20, 30, 20, 15])
  });

  function layerShares(count) {
    const known = DEMO_LAYER_SPLITS[count];
    if (known) return known.slice();
    const even = Math.floor(100 / count);
    const shares = Array.from({ length: count }, () => even);
    shares[Math.floor(count / 2)] += 100 - even * count;
    return shares;
  }

  /* Layer names in RECIPE order (A, B, C...), which is what a recipe is keyed
   * by. The machine puts them in physical order itself. */
  function demoSnapshotFor(demo) {
    if (!demo) return null;
    const config = demo.config || null;
    const layerCount = config
      ? Number(config.layerCount)
      : Number(LINE_LAYER_COUNTS[demo.lineNumber]);
    if (!Number.isInteger(layerCount) || layerCount < 1) return null;

    const names = Array.from({ length: layerCount }, (_, index) => String.fromCharCode(65 + index));
    const shares = layerShares(layerCount);
    const declared = config && Array.isArray(config.layers) ? config.layers : null;
    const defaultHoppers = Number(config && config.hopperCount) || DEFAULT_DEMO_HOPPERS;

    const sources = {};
    return {
      sources,
      layers: names.map((name, layerIndex) => {
        const layerConfig = declared ? declared.find(entry => (entry.id || entry.name) === name) : null;
        const hopperCount = Number(layerConfig && layerConfig.hopperCount) || defaultHoppers;
        return {
          name,
          layerPct: shares[layerIndex],
          hoppers: Array.from({ length: hopperCount }, (_, index) => {
            const active = index < DEMO_BLEND.length && index < hopperCount;
            const resinName = active ? DEMO_RESINS[(layerIndex * 2 + index) % DEMO_RESINS.length] : "";
            const source = active ? DEMO_SOURCES[index % DEMO_SOURCES.length] : "";
            // Keyed and shaped exactly as hookup-sources.js stores them, so
            // station-source.js resolves them through that module's own helper.
            if (source) sources[`${name}:${index}`] = { resin: resinName, source };
            return {
              index,
              // Rotated per layer so neighbouring layers do not all show the
              // same three codes.
              resinName,
              pct: active ? DEMO_BLEND[index] : 0,
              weight: active ? 400 : 0,
              effectiveWeight: active ? 400 : 0,
              usableHeight: DEMO_HEIGHTS[(layerIndex + index) % DEMO_HEIGHTS.length],
              track: false,
              pumpOff: index === DEMO_PUMP_OFF_INDEX
            };
          })
        };
      })
    };
  }

  function demoById(id) {
    return DEMO_LINES.find(demo => demo.id === id) || null;
  }

  /* What a demo entry hands to buildLineModel: either its literal config or
   * the line number to resolve. Kept here so the boot file never has to know
   * which kind it is holding. */
  function modelInputFor(demo) {
    if (!demo) return null;
    return demo.config || demo.lineNumber || null;
  }

  return { DEMO_LINES, DEMO_RESINS, DEMO_HEIGHTS, demoById, modelInputFor, demoSnapshotFor, layerShares };
});
