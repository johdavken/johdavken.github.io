"use strict";

// The desktop side rail folds RT Sync / Tools / the Play Store banner / Sudo
// access away behind a labelled divider under Resin Totals, so first contact
// with the app is four numbered sections rather than seven rows.
//
// Two properties carry the whole design and are what this file guards:
//
//   Desktop uses the divider as a compact More pill. Mobile deliberately
//   reuses the same disclosure state as its full-width Workspace & support
//   row beneath the connected four-step production rail.
//
//   The active section is never hidden. A rail that folds away the row you
//   are standing on leaves no "you are here", so the collapse rule exempts
//   .active. That exemption is also why no JS force-expands on navigation:
//   doing so would silently undo a collapse the operator asked for.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

const DESKTOP_QUERY = "@media (min-width: 901px) and (pointer: fine){";
const FOLDED = [
  ["lineSyncBlock", "workspaceNavLineSync"],
  ["toolsBlock", "workspaceNavTools"],
  ["changelogBlock", "workspaceNavChangelog"],
  ["sudoAccessBlock", "workspaceNavSudo"]
];
const PINNED = ["lineSetupBlock", "splitsBlock", "resultsBlock", "productionSummaryBlock"];

function enclosingAtRule(needle){
  const at = styles.indexOf(needle);
  assert.notEqual(at, -1, `Expected to find ${needle}`);
  let depth = 0;
  for (let i = at; i > 0; i--){
    const ch = styles[i - 1];
    if (ch === "}") depth++;
    else if (ch === "{"){
      if (depth === 0){
        const start = styles.lastIndexOf("\n", i - 1);
        return styles.slice(start + 1, i).trim();
      }
      depth--;
    }
  }
  return null;
}

function ruleBody(selector){
  const at = styles.indexOf(selector);
  assert.notEqual(at, -1, `Expected rule ${selector}`);
  return styles.slice(at, styles.indexOf("}", at) + 1);
}

/* ----------------------------------------------------------------------
 *   Markup
 * -------------------------------------------------------------------- */

test("the divider sits between Resin Totals and the first folded section", () => {
  const resin = html.indexOf('data-workspace-target="productionSummaryBlock"');
  const divider = html.indexOf('<div class="workspaceNavDivider">');
  const sync = html.indexOf('data-workspace-target="lineSyncBlock"');
  assert.ok(resin < divider && divider < sync, "divider must fall between Resin Totals and RT Sync");
});

test("it is a real disclosure button, naming the sections it controls", () => {
  const block = html.slice(html.indexOf('<div class="workspaceNavDivider">'),
                           html.indexOf('data-workspace-target="lineSyncBlock"'));
  assert.match(block, /id="workspaceNavMore"/);
  assert.match(block, /aria-expanded="false"/);
  // An IDREF list, not a wrapper: the four buttons stay direct children of
  // the nav grid, which is what lets the .active exemption below reveal one
  // of them on its own.
  assert.match(block, /aria-controls="workspaceNavLineSync workspaceNavNotes workspaceNavTools helpBetaAccess workspaceNavChangelog workspaceNavSudo"/);
  assert.match(block, /id="workspaceNavMoreLabel">More</);
  assert.match(block, /aria-hidden="true"/);
});

test("exactly the last four sections are marked foldaway, and the numbered four are not", () => {
  FOLDED.forEach(([target, id]) => {
    const re = new RegExp(`<button class="workspaceNavButton workspaceNavExtra" id="${id}" type="button" data-workspace-target="${target}">`);
    assert.match(html, re, `${target} should be foldaway`);
  });
  PINNED.forEach(target => {
    const button = html.slice(html.indexOf(`data-workspace-target="${target}"`));
    assert.doesNotMatch(button.slice(0, button.indexOf(">")), /workspaceNavExtra/);
  });
});

// The Google Play banner took Help's old nav slot, but it isn't a plain
// single-target nav button - it's three mutually exclusive states (request /
// pending / invited), so it only shares the workspaceNavExtra class (for the
// same fold/active-exemption behavior) rather than the full button pattern
// above.
test("the Play Store banner host sits beside (not instead of) the Changelog button, and Help itself is gone", () => {
  assert.match(html, /<div class="helpPlayBannerHost workspaceNavExtra" id="helpBetaAccess" data-beta-state="loading">/);
  assert.doesNotMatch(html, /id="workspaceNavHelp"/);
  assert.doesNotMatch(html, /id="helpBlock"/);
  // Both the banner and Changelog now sit where Help's single nav button
  // used to be - Changelog is the only one that targets changelogBlock.
  assert.equal((html.match(/data-workspace-target="changelogBlock"/g) || []).length, 1);
});

/* ----------------------------------------------------------------------
 *   Scope: desktop rail only
 * -------------------------------------------------------------------- */

test("the divider defaults hidden, then desktop and mobile opt into their own presentations", () => {
  assert.equal(enclosingAtRule(".workspaceNavDivider{ display: none; }"), null);
  assert.equal(enclosingAtRule("  .workspaceNavDivider{\n    position: relative;"), DESKTOP_QUERY);
  assert.match(styles, /body\[data-mobile-workspace="home"\] \.workspaceNavDivider\{[\s\S]*?display:grid;/);
});

test("the desktop collapse rule remains scoped to the rail and exempts the active section", () => {
  const rule = ".workspaceNav:not(.navExpanded) .workspaceNavExtra:not(.active){ display: none; }";
  assert.match(styles, new RegExp(rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(enclosingAtRule(rule), DESKTOP_QUERY);
});

test("the label pill paints over the rule rather than sitting beside it", () => {
  assert.match(ruleBody("  .workspaceNavDivider::before{"), /border-top: 1px solid var\(--border\);/);
  const pill = ruleBody("  .workspaceNavMore{");
  assert.match(pill, /border-radius: 999px;/);
  assert.match(pill, /background: var\(--panel\);/);
  assert.match(pill, /position: relative;/);
});

test("the control is keyboard-reachable and respects reduced motion", () => {
  assert.match(styles, /\.workspaceNavMore:focus-visible\{\s*\n\s*outline: 2px solid var\(--focus-border\);/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)\{[\s\S]*?\.workspaceNavMoreChev\{ transition: none; \}/);
});

test("mobile's Workspace & support chevron is theme-aware, not a hardcoded black arrowhead", () => {
  // Desktop's own .workspaceNavMoreChev (901+pointer:fine) declares
  // fill:none/stroke:currentColor so the bare <path d="m6 9 6 6 6-6"/> (no
  // fill/stroke attributes of its own in index.html) draws as a themed
  // outline chevron. The mobile override under body[data-mobile-workspace=
  // "home"] used to only set size/color/transition and never redeclared
  // fill/stroke - with neither set anywhere, the SVG spec default
  // (fill:black, no stroke) applied uncontested, so it rendered solid black
  // on every theme, looking like a filled arrowhead rather than the line-
  // drawn chevrons beside it.
  const start = styles.indexOf('body[data-mobile-workspace="home"] .workspaceNavMoreChev{');
  assert.notEqual(start, -1, "expected the mobile chevron rule");
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /fill:none;/);
  assert.match(rule, /stroke:currentColor;/);
  assert.match(rule, /stroke-linecap:round;/);
  assert.match(rule, /stroke-linejoin:round;/);
  // color:var(--muted) still drives currentColor per-theme.
  assert.match(rule, /color:var\(--muted\);/);
});

/* ----------------------------------------------------------------------
 *   State
 * -------------------------------------------------------------------- */

test("the open/shut choice survives a reload under its own versioned key", () => {
  assert.match(app, /const LS_NAV_EXPANDED_KEY = "resinTimer\.navExpanded\.v0\.01";/);
  assert.match(app, /localStorage\.setItem\(LS_NAV_EXPANDED_KEY, expanded \? "1" : "0"\);/);
  assert.match(app, /return localStorage\.getItem\(LS_NAV_EXPANDED_KEY\) === "1";/);
  // Default shut: an unset key is the collapsed rail, which is the point.
  assert.match(app, /function loadNavExpandedPreference\(\)\{[\s\S]*?catch\(e\)\{\s*\n\s*return false;/);
});

test("a failed write stays quiet - it costs one click, not an operator warning", () => {
  const fn = app.slice(app.indexOf("function saveNavExpandedPreference("));
  const body = fn.slice(0, fn.indexOf("\n    }") + 6);
  assert.doesNotMatch(body, /showStorageWarning/);
});

test("toggling drives the class, the label and the accessible state together", () => {
  const fn = app.slice(app.indexOf("function setWorkspaceNavExpanded("));
  const body = fn.slice(0, fn.indexOf("\n    }") + 6);
  assert.match(body, /classList\.toggle\("navExpanded", workspaceNavExpanded\)/);
  assert.match(body, /setAttribute\("aria-expanded", String\(workspaceNavExpanded\)\)/);
  assert.match(body, /label\.textContent = workspaceNavExpanded \? "Less" : "More"/);
  assert.match(body, /if \(persist\) saveNavExpandedPreference\(workspaceNavExpanded\);/);
});

test("desktop restores stored state while mobile starts with its disclosure collapsed", () => {
  assert.match(app, /setWorkspaceNavExpanded\(isDesktopLayout\(\) \? loadNavExpandedPreference\(\) : false, \{ persist: false \}\);/);
  assert.match(app, /\n    hookWorkspaceNavMore\(\);/);
});

test("mobile disclosure state is transient and collapses again on return Home", () => {
  assert.match(app, /setWorkspaceNavExpanded\(!workspaceNavExpanded, \{ persist: isDesktopLayout\(\) \}\)/);
  assert.match(app, /function showMobileWorkspaceHome\(\)\{[\s\S]*?setWorkspaceNavExpanded\(false, \{ persist: false \}\);/);
});

test("navigation never force-expands, which would undo a deliberate collapse", () => {
  const fn = app.slice(app.indexOf("function setWorkspacePanel("));
  const body = fn.slice(0, fn.indexOf("\n    }") + 6);
  assert.doesNotMatch(body, /setWorkspaceNavExpanded/);
});
