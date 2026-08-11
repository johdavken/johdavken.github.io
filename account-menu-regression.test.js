const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = `${fs.readFileSync("styles.css", "utf8")}\n${fs.readFileSync("desktop.css", "utf8")}`;
const adminUi = fs.readFileSync("resin-admin-ui.js", "utf8");

test("desktop Account is portalled outside the inert desktop workspace", () => {
  assert.match(html, /id="appOverlayRoot" class="appOverlayRoot"/);
  assert.match(html, /id="appFooterAccount"[^>]+aria-controls="footerAccountMenu"[^>]+aria-haspopup="dialog"/);
  assert.match(app, /overlayRoot\.append\(accountMenu\)/);
  assert.match(css, /\.appOverlayRoot\{position:fixed;inset:0;z-index:70;pointer-events:none\}/);
  assert.match(css, /\.appOverlayRoot > \.footerAccountMenu\{pointer-events:auto\}/);
});

test("desktop Account uses a nonmodal popover while mobile retains the sheet", () => {
  assert.match(app, /const desktopAccountPopover = isDesktopAccountPopover\(name\)/);
  assert.match(app, /sheet\.setAttribute\("aria-modal", String\(!desktopAccountPopover\)\)/);
  assert.match(app, /backdrop\.hidden = desktopAccountPopover/);
  assert.match(app, /main\.inert = !desktopAccountPopover/);
  assert.match(app, /if \(isDesktopAccountPopover\(\)\) return;/);
});

test("desktop Account supports viewport anchoring and nonmodal dismissal", () => {
  assert.match(app, /function positionDesktopAccountPopover/);
  assert.match(app, /Math\.min\(triggerRect\.right - width, window\.innerWidth - width - viewportMargin\)/);
  assert.match(app, /document\.addEventListener\("pointerdown"/);
  assert.match(app, /window\.addEventListener\("resize"/);
  assert.match(app, /event\.key === "Escape"/);
});

test("successful login and ordinary dismissal share complete dialog cleanup", () => {
  assert.match(adminUi, /function closeLoginDialog/);
  assert.match(adminUi, /\[data-admin-close\][\s\S]+closeLoginDialog\(\)/);
  assert.match(adminUi, /if \(!result\.ok\)[\s\S]+closeLoginDialog\(\{ reset:true \}\)/);
  assert.match(adminUi, /requestAnimationFrame\(\(\) => \$\("appFooterAccount"\)\?\.focus\(\)\)/);
});
