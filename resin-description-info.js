(function (root, factory) {
  const data = factory();
  if (typeof module === "object" && module.exports) module.exports = data;
  if (root) root.RESIN_DESCRIPTION_INFORMATION = data;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  return Object.freeze({
    "Color Additive": Object.freeze({
      exact: Object.freeze([]),
      keywords: Object.freeze([
        "black", "blue", "brown", "buff", "gold", "gray", "green", "grey",
        "orange", "purple", "red", "silver", "tan", "violet", "white", "yellow"
      ]),
      information: "Color additives in blown film extrusion provide visual identity, opacity, and UV protection, relying heavily on masterbatches or pigments like titanium dioxide.",
      typicalUses: "Branded or color-coded packaging, opaque films, agricultural films, and outdoor film products."
    }),
    "Hexene LLDPE": Object.freeze({
      exact: Object.freeze(["Hexene", "Med. Density Hexene", "Super Hexene"]),
      keywords: Object.freeze(["hexene"]),
      information: "Hexene LLDPE is a linear low-density polyethylene made using hexene as the comonomer. Compared to butene LLDPE, it generally provides higher strength, better puncture and tear resistance, improved toughness, and better performance in demanding film applications.",
      typicalUses: "Heavy-duty sacks, industrial liners, stretch film, shipping bags, and other puncture-resistant films."
    }),
    "Butene LLDPE": Object.freeze({
      exact: Object.freeze(["Butene"]),
      keywords: Object.freeze(["butene"]),
      information: "Butene LLDPE is a linear low-density polyethylene made using butene as the comonomer. It offers good strength, flexibility, and processability while typically costing less than hexene grades. It is commonly used in general-purpose blown film applications.",
      typicalUses: "General-purpose bags, liners, can liners, and blends where balanced performance and cost are important."
    }),
    "Metallocene (mLLDPE)": Object.freeze({
      exact: Object.freeze(["Metallocene"]),
      keywords: Object.freeze(["metallocene", "mlldpe"]),
      information: "Metallocene polyethylene is produced using metallocene catalysts, creating a more uniform polymer structure. It provides excellent toughness, puncture resistance, seal strength, and clarity, allowing thinner films while maintaining performance.",
      typicalUses: "Downgauged films, high-performance sealant layers, stretch film, food packaging, and heavy-duty flexible packaging."
    }),
    "CLR10227 (VCI)": Object.freeze({
      exact: Object.freeze(["CLR10227"]),
      keywords: Object.freeze(["clr10227", "vci", "volatile corrosion inhibitor"]),
      information: "CLR10227 is a volatile corrosion inhibitor (VCI) additive. It slowly releases corrosion-inhibiting molecules that form a protective layer on metal surfaces inside the package, helping prevent rust and corrosion during storage and shipment without leaving a heavy residue.",
      typicalUses: "Protective bags, liners, and wraps for metal parts, tools, machinery components, and automotive or industrial shipments."
    }),
    "A1901 (Anti-Pinkening)": Object.freeze({
      exact: Object.freeze(["Anti-Pinkening", "Anti Pinkening"]),
      keywords: Object.freeze(["a1901", "anti-pinkening", "anti pinkening"]),
      information: "A1901 is an anti-pinkening additive used to reduce or prevent pink discoloration that can develop in certain polyethylene films during processing, storage, or exposure to environmental conditions. It helps maintain the film's intended appearance and color consistency.",
      typicalUses: "Appearance-sensitive polyethylene films where color consistency must be maintained during processing and storage."
    }),
    "A0450 (Process Aid)": Object.freeze({
      exact: Object.freeze(["A0450 Process Aid"]),
      keywords: Object.freeze(["a0450"]),
      information: "A0450 is a polymer processing aid designed to improve resin flow through the extruder and die. It helps reduce melt fracture, die buildup, and surface defects while improving processing stability and allowing smoother operation at higher output rates.",
      typicalUses: "High-output blown film, smooth-surface film, and formulations prone to melt fracture or die buildup."
    }),
    "Anti-Stat Resin": Object.freeze({
      exact: Object.freeze(["Anti Stat", "Anti-Stat", "Ethoxylated Amine", "10% GMS Anti Stat"]),
      keywords: Object.freeze(["anti stat", "anti-stat", "antistat", "a0600", "a0601", "a0605"]),
      information: "Anti-static resins contain additives that reduce the buildup of static electricity on the film surface. This helps minimize dust attraction, improves material handling, and reduces problems caused by electrostatic discharge during processing and packaging.",
      typicalUses: "Electronics packaging, dust-sensitive packaging, material-handling films, and applications where static interferes with converting."
    }),
    "Anti Block": Object.freeze({
      exact: Object.freeze(["Anti Block", "Antiblock"]),
      keywords: Object.freeze(["anti block", "antiblock", "a/b"]),
      information: "Anti-block additives help prevent film layers from sticking together by creating microscopic surface roughness. This improves film opening, handling, and unwind performance.",
      typicalUses: "Bags, liners, packaging films, and roll stock that must open or unwind cleanly."
    }),
    "Slip": Object.freeze({
      exact: Object.freeze(["Slip"]),
      keywords: Object.freeze(["slip", "viten", "oleamide"]),
      information: "Slip additives lower surface friction and help film move across equipment or against other film surfaces. They can improve winding, converting, and package-opening performance.",
      typicalUses: "Packaging films, bags, liners, and roll stock requiring easier handling, winding, or machine travel."
    }),
    "Process Aid": Object.freeze({
      exact: Object.freeze(["Process Aid"]),
      keywords: Object.freeze(["process aid", "fluoropolymer", "flouropolymer"]),
      information: "Process aids improve polymer flow and processing behavior. Depending on the formulation, they may reduce melt fracture, die buildup, and visible surface defects.",
      typicalUses: "High-output extrusion, difficult-to-process blends, and films requiring a smoother surface or more stable production."
    }),
    "UV Stabilizer": Object.freeze({
      exact: Object.freeze(["UV Stabilizer", "UVI"]),
      keywords: Object.freeze(["uv stabilizer", "uv stabilization", "uvi"]),
      information: "UVI is an additive package that helps protect plastic from degradation caused by ultraviolet (UV) sunlight. It extends outdoor service life by reducing discoloration, brittleness, cracking, and loss of mechanical properties.",
      typicalUses: "Agricultural film, construction film, outdoor covers, protective wraps, and other products exposed to sunlight."
    }),
    "Calcium Carbonate": Object.freeze({
      exact: Object.freeze(["Calcium Carbonate", "80% Calcium Carbonat"]),
      keywords: Object.freeze(["calcium carbonate", "calcium carbonat", "a0500", "a0502", "a0503"]),
      information: "Calcium carbonate is a mineral filler commonly added to polyethylene to reduce cost and modify film properties. It increases stiffness and opacity and can improve handling, but excessive amounts may make the film less flexible and more prone to tearing."
    }),
    "Talc": Object.freeze({
      exact: Object.freeze(["Talc"]),
      keywords: Object.freeze(["talc"]),
      information: "Talc is a mineral filler that may add stiffness and improve dimensional stability. Depending on the formulation, it can also serve as an antiblocking additive.",
      typicalUses: "Stiffened films, dimensionally stable products, filled compounds, and formulations requiring antiblocking performance."
    }),
    "EVA": Object.freeze({
      exact: Object.freeze(["EVA", "Ethylene-Vinyl Acetate"]),
      keywords: Object.freeze(["eva", "ethylene vinyl acetate", "ethylene-vinyl acetate"]),
      information: "Ethylene-vinyl acetate is commonly used to improve softness, flexibility, sealing performance, and impact resistance. Its behavior varies with vinyl-acetate content and blend level.",
      typicalUses: "Sealant layers, flexible packaging, shrink film, freezer film, and blends requiring softness or impact resistance."
    }),
    "LLDPE": Object.freeze({
      exact: Object.freeze(["LLDPE", "Linear Low-Density Polyethylene"]),
      keywords: Object.freeze(["lldpe", "linear low density polyethylene", "linear low-density polyethylene"]),
      information: "Linear low-density polyethylene commonly provides toughness, puncture resistance, and improved film strength. It is widely used in flexible-film structures and blends.",
      typicalUses: "Bags, liners, stretch film, flexible packaging, and blends requiring toughness and puncture resistance."
    }),
    "LDPE": Object.freeze({
      exact: Object.freeze(["LDPE", "Low-Density Polyethylene"]),
      keywords: Object.freeze(["ldpe", "low density polyethylene", "low-density polyethylene"]),
      information: "Low-density polyethylene is flexible, easy to process, and commonly used for film and sealing layers. It also offers good clarity and melt strength in many extrusion applications.",
      typicalUses: "General-purpose film, bags, liners, shrink film, extrusion coating, and heat-seal layers."
    }),
    "HDPE": Object.freeze({
      exact: Object.freeze(["HDPE", "High-Density Polyethylene"]),
      keywords: Object.freeze(["hdpe", "high density polyethylene", "high-density polyethylene"]),
      information: "High-density polyethylene is generally stiffer and denser than LDPE or LLDPE. It commonly provides improved moisture-barrier performance and strength, with less flexibility.",
      typicalUses: "Stiff packaging films, grocery and merchandise bags, liners, and moisture-resistant film structures."
    }),
    "Flame Retardant": Object.freeze({
      exact: Object.freeze(["Flame Retardant"]),
      keywords: Object.freeze(["flame", "retardant"]),
      information: "Flame retardants are added to polyolefins, polycarbonate, polyamides, polyester, and other polymers to increase resistance to ignition, reduce flame spread, suppress smoke formation, and prevent a polymer from dripping.",
      typicalUses: "Construction films, electrical or industrial packaging, and specialty products requiring specified flame-performance characteristics."
    })
  });
});
