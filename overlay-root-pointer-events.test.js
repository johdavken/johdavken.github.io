"use strict";

// Regression: the notification centre's action buttons ("Open Recipe",
// "Review Setup", ...) did nothing when tapped on mobile, while working
// normally on desktop.
//
// #footerNotificationsMenu lives permanently inside #appOverlayRoot, which is
// pointer-events:none so the full-viewport root never blocks the page beneath
// it. Nothing restored pointer events for its children at mobile widths, so
// the dialog inherited pointer-events:none and every click inside it - title,
// all action buttons - fell through to .footerSheetBackdrop underneath, which
// only closes the sheet. Hence "clicking does nothing".
//
// Desktop worked purely by accident: desktop.css sets pointer-events:auto on
// .desktopNotificationsMenu itself, and that whole file sits behind
// @media (min-width:901px) and (pointer: fine).
//
// The fix restores pointer events for overlay children at the root, at every
// width, so this cannot recur for any current or future overlay child.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

// Returns the @media condition a rule sits inside, or null when the rule is
// unconditional. Tracks @media blocks specifically rather than raw brace
// depth: styles.css carries one stray closing brace (line ~3383, pre-existing
// and harmless - CSS error recovery ignores it), which throws a naive depth
// count permanently negative. Popping an already-empty stack is a no-op here,
// so that stray brace cannot skew the answer.
function enclosingMedia(css, index){
  assert.notEqual(index, -1, "expected the rule to exist");
  const before = css.slice(0, index).replace(/\/\*[\s\S]*?\*\//g, "");
  const stack = [];
  const token = /@media[^{]*\{|\{|\}/g;
  let match;
  while ((match = token.exec(before))){
    if (match[0].startsWith("@media")) stack.push(match[0].replace(/\s+/g, " ").trim());
    else if (match[0] === "{") stack.push(null);
    else stack.pop();
  }
  return stack.filter(Boolean).pop() || null;
}

test("the overlay root stays click-through, so it never blocks the page beneath it", () => {
  assert.match(styles, /\.appOverlayRoot\{[^}]*pointer-events:none[^}]*\}/);
});

test("overlay children take pointer events back - otherwise they inherit none and every click falls through", () => {
  assert.match(styles, /\.appOverlayRoot > \*\{pointer-events:auto\}/);
});

test("that restore is unconditional, not scoped to a breakpoint - the mobile bug was precisely a desktop-only restore", () => {
  assert.equal(enclosingMedia(styles, styles.indexOf(".appOverlayRoot > *{pointer-events:auto}")), null,
    "the rule must not be nested inside an @media block");
  assert.equal(enclosingMedia(styles, styles.indexOf(".appOverlayRoot{")), null,
    "sanity: the root rule it pairs with is itself unconditional");
});

test("the notifications dialog really is hosted inside the overlay root, which is why it needed this", () => {
  const rootStart = html.indexOf('<div id="appOverlayRoot"');
  assert.notEqual(rootStart, -1, "expected the overlay root element");
  const rootEnd = html.indexOf("</div>", html.indexOf('id="footerNotificationsMenu"'));
  assert.ok(html.indexOf('id="footerNotificationsMenu"') > rootStart && rootEnd !== -1,
    "#footerNotificationsMenu must sit inside #appOverlayRoot");
});

test("desktop.css's own pointer-events:auto is breakpoint-scoped, so it could never have covered mobile on its own", () => {
  const index = desktop.indexOf("pointer-events:auto");
  assert.notEqual(index, -1);
  assert.notEqual(enclosingMedia(desktop, index), null,
    "desktop.css rules are nested in a desktop-only media query - documents why the root-level fix is required");
});

test("the stylesheet cache-bust version moved, so the fix reaches returning browsers", () => {
  const version = html.match(/href="styles\.css\?v=([\d.]+)"/);
  assert.ok(version, "expected a versioned styles.css link");
  assert.notEqual(version[1], "0.61.0", "styles.css changed - its ?v= must move with it");
});
