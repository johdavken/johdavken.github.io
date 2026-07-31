(function (root, factory) {
  const data = factory();
  if (typeof module === "object" && module.exports) module.exports = data;
  if (root) root.RESIN_DESCRIPTION_INFORMATION = data;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  return Object.freeze({
    "Anti Block": Object.freeze({
      exact: Object.freeze(["Anti Block", "Antiblock"]),
      keywords: Object.freeze(["anti block", "antiblock", "a/b"]),
      information: "Anti-block additives help prevent film layers from sticking together by creating microscopic surface roughness. This improves film opening, handling, and unwind performance."
    }),
    "Slip": Object.freeze({
      exact: Object.freeze(["Slip"]),
      keywords: Object.freeze(["slip", "oleamide"]),
      information: "Slip additives lower surface friction and help film move across equipment or against other film surfaces. They can improve winding, converting, and package-opening performance."
    }),
    "Process Aid": Object.freeze({
      exact: Object.freeze(["Process Aid"]),
      keywords: Object.freeze(["process aid", "fluoropolymer", "flouropolymer"]),
      information: "Process aids improve polymer flow and processing behavior. Depending on the formulation, they may reduce melt fracture, die buildup, and visible surface defects."
    }),
    "UV Stabilizer": Object.freeze({
      exact: Object.freeze(["UV Stabilizer", "UVI"]),
      keywords: Object.freeze(["uv stabilizer", "uv stabilization", "uvi"]),
      information: "UV stabilizers protect plastic from degradation caused by ultraviolet exposure. They help preserve appearance and physical performance during outdoor use."
    }),
    "Talc": Object.freeze({
      exact: Object.freeze(["Talc"]),
      keywords: Object.freeze(["talc"]),
      information: "Talc is a mineral filler that may add stiffness and improve dimensional stability. Depending on the formulation, it can also serve as an antiblocking additive."
    }),
    "EVA": Object.freeze({
      exact: Object.freeze(["EVA", "Ethylene-Vinyl Acetate"]),
      keywords: Object.freeze(["eva", "ethylene vinyl acetate", "ethylene-vinyl acetate"]),
      information: "Ethylene-vinyl acetate is commonly used to improve softness, flexibility, sealing performance, and impact resistance. Its behavior varies with vinyl-acetate content and blend level."
    }),
    "LLDPE": Object.freeze({
      exact: Object.freeze(["LLDPE", "Linear Low-Density Polyethylene"]),
      keywords: Object.freeze(["lldpe", "linear low density polyethylene", "linear low-density polyethylene"]),
      information: "Linear low-density polyethylene commonly provides toughness, puncture resistance, and improved film strength. It is widely used in flexible-film structures and blends."
    }),
    "LDPE": Object.freeze({
      exact: Object.freeze(["LDPE", "Low-Density Polyethylene"]),
      keywords: Object.freeze(["ldpe", "low density polyethylene", "low-density polyethylene"]),
      information: "Low-density polyethylene is flexible, easy to process, and commonly used for film and sealing layers. It also offers good clarity and melt strength in many extrusion applications."
    }),
    "HDPE": Object.freeze({
      exact: Object.freeze(["HDPE", "High-Density Polyethylene"]),
      keywords: Object.freeze(["hdpe", "high density polyethylene", "high-density polyethylene"]),
      information: "High-density polyethylene is generally stiffer and denser than LDPE or LLDPE. It commonly provides improved moisture-barrier performance and strength, with less flexibility."
    })
  });
});
