"use strict";

/* Finding a rule by the media query it lives in, rather than by where it
 * happens to sit in the file.
 *
 * WHY THIS EXISTS
 *
 * A lot of tests here need to say "this rule applies only on phones". They
 * were written when there was exactly one @media (max-width: 700px) block, so
 * they said it like this:
 *
 *     const mobile = styles.slice(styles.indexOf("@media (max-width: 700px){"));
 *     assert.match(mobile, /.thing{ ... }/);
 *
 * That is two guesses stacked on each other: that the first phone block is the
 * only one, and that indexOf lands on the phone override rather than on the
 * base rule of the same name earlier in the file. Both guesses have since
 * failed. There are three such blocks now, and a slice starting at the first
 * one reaches the top-level base rule long before it reaches the phone
 * override - so the assertion reads the wrong rule and reports the feature
 * broken when the feature is fine.
 *
 * The claim those tests are making is not positional. It is "there is a rule
 * for this selector, and it is inside a phone media query". So that is what
 * these helpers answer, by walking braces rather than by trusting offsets.
 *
 * The rule found is the one that actually applies: where a selector appears
 * both at top level and again inside the media query, ruleIn() returns the
 * media one, which is the override the test means.
 */

const PHONE = /max-width:\s*700px/;

/* Walk to `index`, tracking the open blocks. Returns the innermost enclosing
 * @media condition, whitespace-normalised, or null at top level. Comments and
 * quoted strings are skipped so a brace inside either cannot shift the depth. */
function enclosingMedia(css, index) {
  let depth = 0, i = 0;
  const open = [];
  while (i < index && i < css.length) {
    if (css.startsWith("/*", i)) { const e = css.indexOf("*/", i + 2); i = (e === -1 ? css.length : e + 2); continue; }
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const q = ch; i++;
      while (i < css.length && css[i] !== q) { if (css[i] === "\\") i++; i++; }
      i++; continue;
    }
    if (ch === "{") {
      const head = css.slice(css.lastIndexOf("}", i - 1) + 1, i);
      const at = head.lastIndexOf("@media");
      open.push(depth === 0 && at !== -1 ? head.slice(at).replace(/\s+/g, " ").trim() : null);
      depth++;
    } else if (ch === "}") { depth--; open.pop(); }
    i++;
  }
  for (let k = open.length - 1; k >= 0; k--) if (open[k]) return open[k];
  return null;
}

/** Every occurrence of `anchor`, with the media condition each sits under. */
function occurrences(css, anchor) {
  const found = [];
  let i = -1;
  while ((i = css.indexOf(anchor, i + 1)) !== -1) {
    found.push({ index: i, condition: enclosingMedia(css, i), body: blockBodyAt(css, i) });
  }
  return found;
}

/* The declarations of the rule starting at `index`, brace-matched rather than
 * read to the next "}" - so a nested block does not truncate it. */
function blockBodyAt(css, index) {
  const start = css.indexOf("{", index);
  if (start === -1) return "";
  let depth = 0, i = start;
  while (i < css.length) {
    if (css.startsWith("/*", i)) { const e = css.indexOf("*/", i + 2); i = (e === -1 ? css.length : e + 2); continue; }
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      // url("a{b") - a brace in a string is not a block
      const q = ch; i++;
      while (i < css.length && css[i] !== q) { if (css[i] === "\\") i++; i++; }
      i++; continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return css.slice(start, i + 1); }
    i++;
  }
  return css.slice(start);
}

/** The occurrence of `anchor` inside a media query matching `condition`. */
function ruleIn(css, anchor, condition = PHONE) {
  return occurrences(css, anchor).find(o => o.condition && condition.test(o.condition)) || null;
}

/** The whole media block that contains `anchor`, for "and not X" assertions. */
function blockContaining(css, anchor, condition = PHONE) {
  const hit = ruleIn(css, anchor, condition);
  if (!hit) return null;
  let depth = 0, i = 0, blockStart = -1;
  while (i < css.length) {
    if (css.startsWith("/*", i)) { const e = css.indexOf("*/", i + 2); i = (e === -1 ? css.length : e + 2); continue; }
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const q = ch; i++;
      while (i < css.length && css[i] !== q) { if (css[i] === "\\") i++; i++; }
      i++; continue;
    }
    if (ch === "{") { if (depth === 0) blockStart = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && blockStart < hit.index && hit.index < i) {
        return { condition: hit.condition, body: css.slice(blockStart, i + 1) };
      }
    }
    i++;
  }
  return null;
}

/* Every media block matching `condition`, concatenated.
 *
 * This is what "the phone rules" means once there is more than one phone
 * block: all of them, not whichever happens to come first. Tests asserting a
 * rule IS phone-scoped and tests asserting one is NOT both stay correct
 * against this, and neither has to know how many blocks there are or what
 * order they sit in. */
function rulesUnder(css, condition = PHONE) {
  const parts = [];
  let depth = 0, i = 0, blockStart = -1;
  while (i < css.length) {
    if (css.startsWith("/*", i)) { const e = css.indexOf("*/", i + 2); i = (e === -1 ? css.length : e + 2); continue; }
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const q = ch; i++;
      while (i < css.length && css[i] !== q) { if (css[i] === "\\") i++; i++; }
      i++; continue;
    }
    if (ch === "{") { if (depth === 0) blockStart = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && blockStart !== -1) {
        const head = css.slice(css.lastIndexOf("}", blockStart - 1) + 1, blockStart);
        const at = head.lastIndexOf("@media");
        if (at !== -1) {
          const cond = head.slice(at).replace(/\s+/g, " ").trim();
          if (condition.test(cond)) parts.push(css.slice(blockStart, i + 1));
        }
        blockStart = -1;
      }
    }
    i++;
  }
  return parts.join("\n");
}

module.exports = { PHONE, enclosingMedia, occurrences, ruleIn, blockContaining, blockBodyAt, rulesUnder };
