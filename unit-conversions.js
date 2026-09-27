(function(root, factory){
  const pressure = typeof require === "function"
    ? require("./pressure-conversion.js")
    : (root && root.PolynPressureConversion);
  const api = factory(pressure || null);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynUnitConversions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(pressure){
  "use strict";

  /* The floor's unit conversions: one entry, in the unit it was typed in,
   * read in every other unit of its quantity.
   *
   * Pressure is not converted here: it is pressure-conversion.js's own
   * convert() and format(), so the one psi factor, its roundings and its
   * words stay the application's. When that module did not load, pressure
   * is unavailable and the others still work.
   *
   * Every other quantity is linear through a base unit (the first one
   * listed) except temperature, which is affine. The factors are exact by
   * definition: the inch is 25.4 mm, the foot 0.3048 m, the pound
   * 0.45359237 kg; a mil is a thousandth of an inch and a gauge a
   * hundredth of a mil. Nothing is rounded until display.
   */
  const MAX_ENTRY = 1000000;
  const ABSOLUTE_ZERO_F = -459.67;

  /* A unit: `key` on the wire, `label` on the face, `perBase` how many
   * base units one of it is, `places` the decimals it reads in. */
  const unit = (key, label, perBase, places) => Object.freeze({ key, label, perBase, places });

  const QUANTITIES = Object.freeze([
    Object.freeze({ key: "pressure", label: "Pressure", units: Object.freeze([unit("psi", "PSI", 1, 1), unit("bar", "bar", null, 2)]) }),
    Object.freeze({ key: "temperature", label: "Temperature", signed: true, units: Object.freeze([unit("f", "°F", 1, 1), unit("c", "°C", null, 1)]) }),
    Object.freeze({ key: "thickness", label: "Film thickness", units: Object.freeze([unit("mil", "mil", 1, 2), unit("um", "µm", 1 / 25.4, 1), unit("gauge", "ga", 0.01, 0)]) }),
    Object.freeze({ key: "width", label: "Width", units: Object.freeze([unit("in", "in", 1, 2), unit("mm", "mm", 1 / 25.4, 1)]) }),
    Object.freeze({ key: "length", label: "Length", units: Object.freeze([unit("ft", "ft", 1, 1), unit("m", "m", 1 / 0.3048, 2)]) }),
    Object.freeze({ key: "weight", label: "Weight", units: Object.freeze([unit("lb", "lb", 1, 1), unit("kg", "kg", 1 / 0.45359237, 2)]) }),
    Object.freeze({ key: "rate", label: "Output", units: Object.freeze([unit("lbhr", "lb/hr", 1, 1), unit("kghr", "kg/hr", 1 / 0.45359237, 1)]) })
  ]);

  function quantityOf(key){
    return QUANTITIES.find(one => one.key === key) || null;
  }

  function unitOf(quantity, key){
    return quantity ? quantity.units.find(one => one.key === key) || null : null;
  }

  // Blank is not zero: an empty field is "not entered yet". Leading-decimal
  // entries (".5") and thousands commas parse the way an operator types.
  function numeric(value){
    if (typeof value === "number") return value;
    if (typeof value !== "string" || !value.trim()) return Number.NaN;
    return Number(value.trim().replace(/,/g, ""));
  }

  function temperatures(number, from){
    const f = from === "f" ? number : (number * 9 / 5) + 32;
    return { f, c: from === "c" ? number : (number - 32) * 5 / 9 };
  }

  /**
   * Convert one entry, in the unit it was typed in, to every unit of its
   * quantity.
   *
   * @param {object} entry
   * @param {string} entry.quantity        a QUANTITIES key
   * @param {string|number} entry.value    as typed
   * @param {string} entry.from            a unit key of that quantity
   * @returns {{valid:boolean, errors:string[], quantity?:string, from?:string, values?:object}}
   */
  function convert({ quantity, value, from } = {}){
    const kind = quantityOf(quantity);
    if (!kind) return { valid: false, errors: ["That is not a conversion."] };
    const typed = unitOf(kind, from);
    if (!typed) return { valid: false, errors: [`The unit must be ${kind.units.map(one => one.label).join(" or ")}.`] };

    if (kind.key === "pressure"){
      if (!pressure) return { valid: false, errors: ["Pressure is unavailable: the shared conversion did not load."] };
      const result = pressure.convert({ value, from });
      if (!result.valid) return { valid: false, errors: result.errors };
      return { valid: true, errors: [], quantity: kind.key, from, values: { psi: result.psi, bar: result.bar } };
    }

    const number = numeric(value);
    const errors = [];
    const name = `${kind.label} in ${typed.label}`;
    if (!Number.isFinite(number)) errors.push(`${name} must be a number.`);
    else if (Math.abs(number) > MAX_ENTRY) errors.push(`${name} must be ${MAX_ENTRY.toLocaleString("en-US")} or less.`);
    else if (!kind.signed && number < 0) errors.push(`${name} cannot be negative.`);
    else if (kind.key === "temperature" && temperatures(number, from).f < ABSOLUTE_ZERO_F) errors.push("That is below absolute zero.");
    if (errors.length) return { valid: false, errors };

    let values;
    if (kind.key === "temperature"){
      values = temperatures(number, from);
    } else {
      const base = number * typed.perBase;
      values = {};
      for (const one of kind.units) values[one.key] = one.key === from ? number : base / one.perBase;
    }
    return { valid: true, errors: [], quantity: kind.key, from, values };
  }

  /* A value in its unit's places; under one (and not zero), one place
   * more, so a small figure is not shown as nothing. Pressure reads with
   * the pressure module's own rounding. */
  function format(value, quantity, unitKey){
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    if (quantity === "pressure" && pressure) return pressure.format(number, unitKey);
    const one = unitOf(quantityOf(quantity), unitKey);
    const places = one ? one.places : 2;
    const text = number.toFixed(Math.abs(number) < 1 && number !== 0 ? places + 1 : places);
    return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
  }

  /* Pounds per thousand feet, the floor's two ways.
   *
   *   rolls: max roll weight (lb) x rolls per set / (footage / 1,000)
   *   film:  layflat width (in) x thickness (mil) x 12 / 15
   *
   * The 12: a thousand feet is 12,000 inches, and a mil is 0.001 inch, so
   * each inch of width and each mil is 12 cubic inches of film per
   * thousand feet. The 15: polyethylene near 0.92 density is about 30
   * cubic inches to the pound, and a tube has two walls, so a layflat
   * inch weighs twice that - 30 / 2. Together, 0.8.
   *
   * The film's way takes an optional product density (g/cc). Given one,
   * the 15 is worked out for it instead: a g/cc is 0.0361273 lb per cubic
   * inch (line-rate-estimate.js's factor), so the divisor is
   * 1 / (2 walls x 0.0361273 x density) - 13.84 / density, 15.04 at 0.92.
   * Left empty, it is the floor's 15. Each entry is refused in its own
   * words; nothing is rounded until display. */
  const CUBIC_INCHES = 12;
  const TUBE_DIVISOR = 15;
  const LB_PER_IN3_PER_G_CM3 = 0.0361273;
  const WALLS = 2;
  const MAX_DENSITY = 10;
  function divisorFor(density){
    return 1 / (WALLS * LB_PER_IN3_PER_G_CM3 * density);
  }
  const PER_THOUSAND = Object.freeze({
    rolls: Object.freeze([
      Object.freeze({ key: "rollWeight", label: "Max roll weight", unit: "lb" }),
      Object.freeze({ key: "rolls", label: "Rolls per set", unit: "", whole: true }),
      Object.freeze({ key: "footage", label: "Footage", unit: "ft" })
    ]),
    width: Object.freeze([
      Object.freeze({ key: "width", label: "Layflat width", unit: "in" }),
      Object.freeze({ key: "mil", label: "Thickness", unit: "mil" }),
      Object.freeze({ key: "density", label: "Density", unit: "g/cc", optional: true, max: MAX_DENSITY })
    ])
  });

  /**
   * @param {"rolls"|"width"} method
   * @param {object} entries   the method's fields by key, as typed
   * @returns {{valid:boolean, errors:string[], lbPerThousand?:number, divisor?:number, density?:number|null}}
   */
  function poundsPerThousand(method, entries){
    const fields = PER_THOUSAND[method];
    if (!fields) return { valid: false, errors: ["That is not a way to work out pounds per thousand feet."] };
    const values = {};
    const errors = [];
    for (const field of fields){
      const raw = (entries || {})[field.key];
      if (field.optional && (raw == null || (typeof raw === "string" && !raw.trim()))){ values[field.key] = null; continue; }
      const number = numeric(raw);
      const max = field.max || MAX_ENTRY;
      if (!Number.isFinite(number)) errors.push(`${field.label} must be a number.`);
      else if (number <= 0) errors.push(`${field.label} must be more than zero.`);
      else if (number > max) errors.push(`${field.label} must be ${max.toLocaleString("en-US")} or less.`);
      else if (field.whole && !Number.isInteger(number)) errors.push(`${field.label} must be a whole number.`);
      values[field.key] = number;
    }
    if (errors.length) return { valid: false, errors };
    if (method === "rolls") return { valid: true, errors: [], lbPerThousand: values.rollWeight * values.rolls / (values.footage / 1000) };
    const density = values.density;
    const divisor = density === null ? TUBE_DIVISOR : divisorFor(density);
    return { valid: true, errors: [], lbPerThousand: values.width * values.mil * CUBIC_INCHES / divisor, divisor, density };
  }

  function formatPerThousand(value){
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(2) : "—";
  }

  return Object.freeze({
    MAX_ENTRY, ABSOLUTE_ZERO_F, QUANTITIES, CUBIC_INCHES, TUBE_DIVISOR, LB_PER_IN3_PER_G_CM3, PER_THOUSAND, divisorFor,
    quantityOf, unitOf, convert, format, poundsPerThousand, formatPerThousand,
    available: quantity => quantity !== "pressure" || !!pressure
  });
});
