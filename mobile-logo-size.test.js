"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles } = require("./css-source");

const styles = readStyles();

// Mobile RT logo (.resinToolsLogo, inside .mobileBrand - hidden entirely on
// desktop via .mobileBrand{display:none} at >=901px) reduced 25%: 280px -> 210px.
// The desktop sidebar icon (.resinToolsSidebarIcon) is a separate element/rule
// and is independently enlarged by 25%: 137.5px -> 171.875px.

test("the mobile logo's max width is 210px (280px reduced by 25%), still capped to the container via min(100%, ...)", () => {
  assert.match(styles, /\.resinToolsLogo\{display:block;width:min\(100%,210px\);height:auto\}/);
});

test("the desktop sidebar icon is 25% larger", () => {
  assert.match(styles, /\.resinToolsSidebarIcon\{display:block;width:171\.875px;height:auto\}/);
});

test(".resinToolsLogo lives inside .mobileBrand, which is hidden on desktop - confirms this change is mobile-only by construction, not by a separate media query on the logo itself", () => {
  const desktopMediaStart = styles.indexOf("@media (min-width: 901px)");
  assert.notEqual(desktopMediaStart, -1);
  const desktopMediaBody = styles.slice(desktopMediaStart, styles.indexOf("\n}\n", desktopMediaStart));
  assert.match(desktopMediaBody, /\.mobileBrand\{ display: none; \}/);
});

test("the mobile RT logo is exclusive to the Main screen", () => {
  assert.match(styles, /body:not\(\[data-mobile-workspace="home"\]\) \.mobileBrand\{ display:none; \}/);
});
