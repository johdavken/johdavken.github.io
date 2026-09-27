"use strict";

/* product-density.js: a recipe's product density from its resins' densities
 * - the weighted harmonic mean, all or nothing. */

const test = require("node:test");
const assert = require("node:assert/strict");

const pd = require("./product-density.js");

const catalog = [
  { resin_code: "LL318", density_g_cm3: 0.918 },
  { resin_code: "hd622", density_g_cm3: 0.962 },
  { resin_code: "WHITE-MB", density_g_cm3: 1.9 },
  { resin_code: "AB120", density_g_cm3: null }
];

test("itemsFrom weighs each hopper by its blend and its layer's share, with its resin's density from the catalog", () => {
  const items = pd.itemsFrom(
    { "A:1": { resinName: " ll318 ", pct: 80 }, "A:2": { resinName: "HD622", pct: 20 }, "B:1": { resinName: "AB120", pct: 100 }, "B:2": { resinName: "", pct: 0 }, "C:1": { resinName: "LL318", pct: 100 } },
    { A: { layerPct: 60 }, B: { layerPct: 40 }, C: { layerPct: 0 } },
    catalog
  );
  assert.deepEqual(items, [
    { code: "LL318", weight: 0.48, density: 0.918 },
    { code: "HD622", weight: 0.12, density: 0.962 },
    { code: "AB120", weight: 0.4, density: null }
  ]);
  assert.deepEqual(pd.itemsFrom(null, null, null), []);
});

test("the product density is the weighted harmonic mean - volumes add - not the plain average", () => {
  const items = [{ code: "LL318", weight: 0.95, density: 0.918 }, { code: "WHITE-MB", weight: 0.05, density: 1.9 }];
  const result = pd.productDensity(items);
  const harmonic = 1 / (0.95 / 0.918 + 0.05 / 1.9);
  assert.ok(Math.abs(result.density - harmonic) < 1e-12);
  assert.ok(result.density < 0.95 * 0.918 + 0.05 * 1.9, "the plain average is not the harmonic one");
  assert.deepEqual(result.missing, []);
  assert.equal(pd.productDensity([{ code: "LL318", weight: 1, density: 0.918 }]).density, 0.918);
  assert.equal(pd.format(result.density), result.density.toFixed(3));
});

test("all or nothing: one resin without a density leaves none, and names each missing resin once, in recipe order", () => {
  const result = pd.productDensity([
    { code: "AB120", weight: 0.2, density: null },
    { code: "LL318", weight: 0.5, density: 0.918 },
    { code: "XYZ", weight: 0.1, density: null },
    { code: "AB120", weight: 0.2, density: null }
  ]);
  assert.deepEqual(result, { density: null, missing: ["AB120", "XYZ"], empty: false });
  assert.deepEqual(pd.productDensity([]), { density: null, missing: [], empty: true });
  assert.deepEqual(pd.productDensity(null), { density: null, missing: [], empty: true });
});
