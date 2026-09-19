(function(root, factory){
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynWindingTension = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  "use strict";

  /* Recommended winding tension for blown film.
   *
   * Tension is expressed as PLI - pounds per linear inch of web width -
   * found from film thickness by linear interpolation inside one of four
   * thickness bands. The curve is continuous through these breakpoints:
   *
   *   0 mil -> 0.15 PLI    1 mil -> 0.20    3 mil -> 0.40
   *   5 mil -> 0.80       20 mil -> 1.00
   *
   * Bands are checked in order and the FIRST match wins, so exactly 1 mil
   * and exactly 3 mil fall in band 1, and exactly 5 mil falls in band 2.
   *
   * WHAT IS OBSERVED AND WHAT IS NOT. This table is deliberately the single
   * place the uncertain numbers live, so a correction is a one-line change:
   *
   *   - Bands 0-2 (under 5 mil) are confirmed against the source calculator
   *     at 0.5, 1, 2.3, 3, 4 and 5 mil.
   *   - Band 3's LINE is confirmed: 8 mil and 12 mil both agree, and both
   *     give the same 0.0133 PLI/mil slope as the 5 mil anchor. It is not
   *     an extrapolation from one point.
   *   - Band 3's TERMINUS is still assumed. 12 mil sits inside the linear
   *     region whatever the line's end, so no observation yet distinguishes
   *     20 mil -> 1.00 PLI from a line that runs further. Correcting it
   *     means changing t1/hi on the last band only.
   *   - The 0 mil -> 0.15 PLI endpoint is still solved from the single
   *     0.5 mil observation.
   *   - Behaviour above 20 mil remains unknown. PLI is CLAMPED to the top
   *     band's high value rather than extrapolated past it. The first
   *     observation above 20 mil would settle both this and the terminus.
   */
  const TENSION_BANDS = Object.freeze([
    Object.freeze({ strictBelow: 1, t0: 0, t1: 1,  lo: 0.15, hi: 0.20, taper: "50%",      wind: "Surface Wind Only" }),
    Object.freeze({ upTo: 3,        t0: 1, t1: 3,  lo: 0.20, hi: 0.40, taper: "30 – 50%", wind: "Surface Wind or Center/Surface" }),
    Object.freeze({ upTo: 5,        t0: 3, t1: 5,  lo: 0.40, hi: 0.80, taper: "20 – 40%", wind: "Surface Wind or Center/Surface" }),
    Object.freeze({ upTo: Infinity, t0: 5, t1: 20, lo: 0.80, hi: 1.00, taper: "20%",      wind: "Surface Wind or Center/Surface" })
  ]);

  const NOTICE = "These are the recommended starting points for this product. "
    + "Make the necessary adjustments based on the product being produced.";

  // Blank is not zero here: an empty field is "not entered yet", which the
  // caller reports as an instruction rather than as an invalid number.
  // Leading-decimal entries (".5") parse the way an operator types them.
  function numeric(value){
    if (typeof value === "number") return value;
    if (typeof value !== "string" || !value.trim()) return Number.NaN;
    return Number(value.trim().replace(/,/g, ""));
  }

  function findTensionBand(mil){
    return TENSION_BANDS.find(band => band.strictBelow !== undefined
      ? mil < band.strictBelow
      : mil <= band.upTo) || null;
  }

  function calculate({ filmThicknessMil, rollWidthIn, ups = 1 } = {}){
    const errors = [];
    const mil = numeric(filmThicknessMil);
    const width = numeric(rollWidthIn);
    const upsCount = numeric(ups);

    if (!Number.isFinite(mil) || mil <= 0){
      errors.push("Film thickness must be a number greater than 0.");
    }
    if (!Number.isFinite(width) || width <= 0){
      errors.push("Roll width must be a number greater than 0.");
    }
    if (!Number.isFinite(upsCount) || !Number.isInteger(upsCount) || upsCount < 1){
      errors.push("Number of ups must be a whole number of 1 or more.");
    }
    if (errors.length) return { valid:false, errors };

    const band = findTensionBand(mil);
    const raw = band.lo + ((mil - band.t0) / (band.t1 - band.t0)) * (band.hi - band.lo);
    // Clamping is what keeps thicknesses above 20 mil at 1.00 PLI; inside
    // every band the interpolation already lands on or below `hi`.
    const pli = Math.min(raw, band.hi);
    const scale = width * upsCount;

    return {
      valid: true,
      errors,
      filmThicknessMil: mil,
      rollWidthIn: width,
      ups: upsCount,
      pli,
      target: pli * scale,
      min: band.lo * scale,
      max: band.hi * scale,
      taper: band.taper,
      wind: band.wind
    };
  }

  // Tension values read in whole tenths of a pound.
  function formatTension(value){
    return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "—";
  }

  // PLI rounds to three decimals and then drops trailing zeros, so the
  // operator sees 0.2, 0.33, 0.175 and 0.84 rather than 0.200 - or the
  // 0.32999999 a binary float would otherwise print. Rounding happens for
  // display only; `calculate` keeps full precision.
  function formatPli(value){
    const number = Number(value);
    return Number.isFinite(number) ? String(Number(number.toFixed(3))) : "—";
  }

  return { TENSION_BANDS, NOTICE, findTensionBand, calculate, formatTension, formatPli };
});
