"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");

// Mobile RT logo (.resinToolsLogo, inside .mobileBrand - hidden entirely on
// desktop via .mobileBrand{display:none} at >=901px) reduced 25%: 280px -> 210px.
// The desktop sidebar icon (.resinToolsSidebarIcon) is a separate element/rule
// and must stay untouched.

test("the mobile logo's max width is 210px (280px reduced by 25%), still capped to the container via min(100%, ...)", () => {
  assert.match(styles, /\.resinToolsLogo\{display:block;width:min\(100%,210px\);height:auto\}/);
});

test("the desktop sidebar icon is untouched", () => {
  assert.match(styles, /\.resinToolsSidebarIcon\{display:block;width:137\.5px;height:auto\}/);
});

test(".resinToolsLogo lives inside .mobileBrand, which is hidden on desktop - confirms this change is mobile-only by construction, not by a separate media query on the logo itself", () => {
  const desktopMediaStart = styles.indexOf("@media (min-width: 901px)");
  assert.notEqual(desktopMediaStart, -1);
  const desktopMediaBody = styles.slice(desktopMediaStart, styles.indexOf("\n}\n", desktopMediaStart));
  assert.match(desktopMediaBody, /\.mobileBrand\{ display: none; \}/);
});
