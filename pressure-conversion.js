(function(root, factory){
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynPressureConversion = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  "use strict";

  /* Pressure, in pounds per square inch and in bar.
   *
   * One exact factor, both ways. A pound-force per square inch is
   * 6894.757293168 pascals by definition (the pound-force and the inch are
   * both exact), and a bar is 100 000 pascals, so:
   *
   *   1 psi = 0.06894757293168 bar
   *   1 bar = 14.503773773 psi
   *
   * Everything here derives from PSI_PER_BAR; BAR_PER_PSI is its
   * reciprocal, not a second constant that could drift from it. Nothing
   * is rounded until display.
   */
  const PSI_PER_BAR = 14.503773773;
  const BAR_PER_PSI = 1 / PSI_PER_BAR;

  /* The two units, as the converter names them: `key` on the wire, `label`
   * on the face. Psi first, bar second, both ways. */
  const UNITS = Object.freeze([
    Object.freeze({ key: "psi", label: "PSI", name: "pounds per square inch" }),
    Object.freeze({ key: "bar", label: "bar", name: "bar" })
  ]);

  /* Above this, in either unit, an entry is refused rather than drawn: a
   * gauge face with a seven-figure scale is not a reading anyone takes. */
  const MAX_ENTRY = 1000000;

  /* Common line pressures, in psi, for a reference strip: plant air and
   * pneumatics at the low end, hydraulics and melt pressure at the high. */
  const REFERENCE_PSI = Object.freeze([15, 30, 60, 100, 250, 500, 1000, 3000]);

  const NOTICE = "Gauge pressure, either way: type in one unit and read the other.";

  // Blank is not zero here: an empty field is "not entered yet", which the
  // caller reports as an instruction rather than as an invalid number.
  // Leading-decimal entries (".5") parse the way an operator types them.
  function numeric(value){
    if (typeof value === "number") return value;
    if (typeof value !== "string" || !value.trim()) return Number.NaN;
    return Number(value.trim().replace(/,/g, ""));
  }

  function psiToBar(psi){ return Number(psi) * BAR_PER_PSI; }
  function barToPsi(bar){ return Number(bar) * PSI_PER_BAR; }

  function isUnit(unit){ return UNITS.some(one => one.key === unit); }

  /**
   * Convert one entry, in the unit it was typed in, to both.
   *
   * @param {object} entry
   * @param {string|number} entry.value  the pressure as typed
   * @param {string} entry.from          "psi" or "bar"
   * @returns {{valid:boolean, errors:string[], from?:string, psi?:number, bar?:number}}
   */
  function convert({ value, from } = {}){
    const errors = [];
    if (!isUnit(from)){
      errors.push("The unit must be psi or bar.");
      return { valid:false, errors };
    }
    const number = numeric(value);
    const unit = UNITS.find(one => one.key === from);
    if (!Number.isFinite(number)){
      errors.push(`Pressure in ${unit.label} must be a number.`);
    } else if (number < 0){
      errors.push(`Pressure in ${unit.label} cannot be negative.`);
    } else if (number > MAX_ENTRY){
      errors.push(`Pressure in ${unit.label} must be ${MAX_ENTRY.toLocaleString("en-US")} or less.`);
    }
    if (errors.length) return { valid:false, errors };
    return {
      valid: true,
      errors,
      from,
      psi: from === "psi" ? number : barToPsi(number),
      bar: from === "bar" ? number : psiToBar(number)
    };
  }

  /* Psi reads in tenths; under one psi, in hundredths, so a small pressure
   * is not shown as 0.0. */
  function formatPsi(value){
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return number.toFixed(Math.abs(number) < 1 && number !== 0 ? 2 : 1);
  }

  /* Bar reads in hundredths; under one bar, in thousandths, so one psi
   * (0.069 bar) is not shown as 0.07. */
  function formatBar(value){
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return number.toFixed(Math.abs(number) < 1 && number !== 0 ? 3 : 2);
  }

  function format(value, unit){
    return unit === "bar" ? formatBar(value) : formatPsi(value);
  }

  /* The full scale of a gauge face for a reading: the first round number
   * at or above it on the ladder 15, 30, 60, 100, 150, 300, 600, 1000...
   * (1.5, 3, 6, 10 by powers of ten), so the needle always has room past
   * the reading and the face's ticks fall on round numbers. Never under
   * 15, so a zero or a small reading still has a face. */
  const LADDER = Object.freeze([1.5, 3, 6, 10]);
  function scaleFor(value){
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 15;
    let power = 10;
    for (;;){
      for (const step of LADDER){
        const scale = step * power;
        if (scale >= number) return Number(scale.toPrecision(12));
      }
      power *= 10;
    }
  }

  /* The reference strip: each common psi with its bar. */
  function reference(){
    return REFERENCE_PSI.map(psi => ({ psi, bar: psiToBar(psi) }));
  }

  return {
    PSI_PER_BAR, BAR_PER_PSI, UNITS, MAX_ENTRY, REFERENCE_PSI, NOTICE,
    psiToBar, barToPsi, convert, format, formatPsi, formatBar, scaleFor, reference
  };
});
