"use strict";

/* Mobile workspace-panel visibility: a ratchet, not a description.
 *
 * The tangle this guards against: mobile panel visibility had grown three
 * competing `display:none!important` rules on `.workspaceContent >
 * .workspacePanel` - an unconditional one plus `[data-mobile-workspace="home"]`
 * and `[data-mobile-workspace="panel"] :not(.mobile-active)`. All three said
 * the same thing about the same elements. Measuring every reachable mobile
 * state (2 workspace modes x 3 isolation modes x 15 active-panel choices = 90)
 * showed removing the two conditional ones changed nothing at all, and
 * removing all three broke 30 states by exposing every panel on the tile home.
 * They were not a fallback for each other: nothing sits between them in
 * specificity, so a rule that outranked the survivor outranked them too.
 *
 * Each one was individually harmless. That is exactly how the pile got to
 * three, and why the guard is a count rather than a review note.
 *
 * The shape to keep: ONE unconditional hide, and reveals that carry the
 * condition. A new mode adds a reveal. It does not add a fourth hide.
 *
 * These are source-level assertions, so they cannot see the cascade. The
 * cascade claim above was established by measurement in the browser; what
 * these tests do is stop the structure from drifting back afterwards.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
const desktop = fs.readFileSync(path.join(__dirname, "desktop.css"), "utf8");

// Comments are stripped before any structural check. The rules this file
// guards are DESCRIBED in a styles.css comment, verbatim and by name, so a
// scan that reads comment text would find the very selectors it is asserting
// are gone - and report the documentation as a regression.
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, "");
const code = strip(styles);
// Both stylesheets, so a new hide cannot simply be added to the other file.
const allCode = code + "\n" + strip(desktop);

// Every declaration block in the file, as { selector, body }. Walking braces
// rather than pattern-matching the file keeps at-rule preludes (@media, and
// the bare `{` of a nested block) out of the selector text; a greedy `[^{}]*`
// silently absorbs whatever precedes the rule instead.
function rules(src){
  const out = [];
  let buf = "", i = 0;
  while (i < src.length){
    const ch = src[i];
    if (ch === "{"){
      const selector = buf.trim();
      // Find this block's matching close brace.
      let depth = 1, j = i + 1;
      while (j < src.length && depth > 0){
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      const inner = src.slice(i + 1, j - 1);
      if (selector.startsWith("@")) out.push(...rulesIn(inner));
      else out.push({ selector, body: inner });
      buf = ""; i = j; continue;
    }
    if (ch === "}"){ buf = ""; i++; continue; }
    buf += ch; i++;
  }
  return out;
}

// Same walk, over a nested at-rule body. Kept separate so `rules()` stays the
// entry point that reads the whole file.
function rulesIn(src){
  const out = [];
  let buf = "", i = 0;
  while (i < src.length){
    const ch = src[i];
    if (ch === "{"){
      const selector = buf.trim();
      let depth = 1, j = i + 1;
      while (j < src.length && depth > 0){
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      const inner = src.slice(i + 1, j - 1);
      if (selector.startsWith("@")) out.push(...rulesIn(inner));
      else out.push({ selector, body: inner });
      buf = ""; i = j; continue;
    }
    if (ch === "}"){ buf = ""; i++; continue; }
    buf += ch; i++;
  }
  return out;
}

const ALL_RULES = rules(allCode);

// Rules that set `display` on the PANEL itself, not on its summary or other
// descendants. A selector qualifies only if it ENDS at `.workspacePanel`,
// allowing attribute/class/:not() qualifiers on that same compound selector -
// anything after a space or `>` is a descendant, which is how the legitimate
// `> summary .pill.summaryStatus` and `> summary .layerMeta` rules stay out.
const PANEL_TAIL = /\.workspacePanel(?:\[[^\]]*\]|\.[a-zA-Z-]+|:not\([^)]*\))*\s*$/;

function panelDisplayRules(){
  return ALL_RULES.filter(r =>
    r.selector.split(",").some(s => PANEL_TAIL.test(s.trim())) &&
    /(^|;)\s*display\s*:/.test(";" + r.body)
  ).map(r => ({ selector: r.selector.trim(), body: r.body.trim() }));
}

test("panel-level display rules are limited to the known set", () => {
  const rules = panelDisplayRules();
  const hides = rules.filter(r => /display\s*:\s*none/.test(r.body));
  const shows = rules.filter(r => !/display\s*:\s*none/.test(r.body));

  // Exactly one unconditional mobile hide. Its whole job is that nothing is
  // visible until something is deliberately revealed.
  const unconditional = hides.filter(
    r => r.selector === ".workspaceContent > .workspacePanel");
  assert.equal(unconditional.length, 1,
    "expected exactly one unconditional `.workspaceContent > .workspacePanel` " +
    `display:none rule, found ${unconditional.length}:\n` +
    unconditional.map(r => "  " + r.selector).join("\n"));

  // No conditional hide may be added back on data-mobile-workspace. The
  // unconditional rule already covers every element such a rule could select.
  const workspaceModeHides = hides.filter(
    r => /data-mobile-workspace/.test(r.selector));
  assert.deepEqual(workspaceModeHides.map(r => r.selector), [],
    "a [data-mobile-workspace] rule may REVEAL a panel, never hide one - the " +
    "unconditional hide already covers everything it could match, so this is " +
    "redundant on arrival:\n" +
    workspaceModeHides.map(r => "  " + r.selector).join("\n"));

  // The two isolation modes are the only conditional hides, and each narrows
  // to one panel by ID rather than restating the blanket hide.
  const isolationHides = hides.filter(
    r => /data-mobile-(timeline|recipe)-only/.test(r.selector));
  assert.equal(isolationHides.length, 2,
    "expected exactly the timeline-only and recipe-only isolation hides, found " +
    isolationHides.length + ":\n" +
    isolationHides.map(r => "  " + r.selector).join("\n"));
  for (const r of isolationHides){
    assert.match(r.selector, /:not\(#(resultsBlock|splitsBlock)\)/,
      `an isolation hide must exempt the panel it isolates: ${r.selector}`);
  }

  // Every hide must be accounted for: the unconditional one, the two
  // isolation ones, and the desktop `:not(.desktop-active)` equivalent.
  const known = new Set([
    ".workspaceContent > .workspacePanel",
    'body[data-mobile-timeline-only="true"] .workspaceContent > .workspacePanel:not(#resultsBlock)',
    'body[data-mobile-recipe-only="true"] .workspaceContent > .workspacePanel:not(#splitsBlock)',
    ".workspaceContent > .workspacePanel:not(.desktop-active)",
  ]);
  const unexpected = hides.filter(r => !known.has(r.selector));
  assert.deepEqual(unexpected.map(r => r.selector), [],
    "a new panel-level display:none appeared. Add a reveal for a new mode, " +
    "not another hide - and if this one is genuinely needed, measure the " +
    "mobile state matrix before widening this list:\n" +
    unexpected.map(r => "  " + r.selector).join("\n"));

  // One reveal per shell, and no more: mobile's tile-selected panel and
  // desktop's active panel. Both are load-bearing - measurement showed
  // removing the mobile one leaves 13 states with nothing on screen.
  assert.deepEqual(shows.map(r => r.selector).sort(), [
    '.workspaceContent > .workspacePanel.desktop-active',
    'body[data-mobile-workspace="panel"] .workspaceContent > .workspacePanel.mobile-active',
  ], "the reveals are the load-bearing half of this pair; a change here is a " +
     "behaviour change, not a cleanup");
});

test("the mobile reveal is what carries the workspace-mode condition", () => {
  assert.match(code,
    /body\[data-mobile-workspace="panel"\] \.workspaceContent > \.workspacePanel\.mobile-active\{ display:block!important; \}/,
    "the tile-selected panel is revealed by a [data-mobile-workspace=\"panel\"] " +
    "rule; without it the unconditional hide leaves mobile with no panels at all");
});

test("each isolation mode pairs its narrowing hide with an explicit reveal", () => {
  // :not(#panel) beats the mobile-active reveal on specificity, so the mode
  // also has to say which panel it wants. Both halves or neither.
  assert.match(code,
    /body\[data-mobile-timeline-only="true"\] #resultsBlock\{ display:block !important; \}/);
  assert.match(code,
    /body\[data-mobile-recipe-only="true"\] #splitsBlock\{ display:block !important; \}/);
});

test("the two deleted hiders have not come back", () => {
  assert.doesNotMatch(code,
    /body\[data-mobile-workspace="home"\] \.workspaceContent > \.workspacePanel\{/,
    "the unconditional hide already covers the tile home");
  assert.doesNotMatch(code,
    /body\[data-mobile-workspace="panel"\] \.workspaceContent > \.workspacePanel:not\(\.mobile-active\)\{/,
    "the unconditional hide already covers every non-active panel");
});

test("#lineSetupBlock stays retired independently of the panel rules", () => {
  // Measurement turned this up: lineSetupBlock is display:none in all 90
  // mobile states, including the one where it is the selected panel. That is
  // deliberate - Line Setup folded into Recipe and the panel remains only as a
  // DOM host - and it is an ID rule, so it outranks everything above. A future
  // reader comparing the matrix against the rules needs to know this is why.
  assert.match(code,
    /\.workspaceNavButton\[data-workspace-target="lineSetupBlock"\],\s*\n#lineSetupBlock\{ display:none!important; \}/,
    "the retirement rule for #lineSetupBlock is what keeps it hidden even when " +
    "selected; the panel-visibility rules never get a say");
});
