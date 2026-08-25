const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const adminUi = fs.readFileSync("resin-admin-ui.js", "utf8");

test("Sudo access is a Workspace & Support destination, not a footer account menu", () => {
  assert.match(html, /id="workspaceNavSudo"[^>]*data-workspace-target="sudoAccessBlock"/);
  assert.match(html, /<details class="block card workspacePanel sudoAccessPanel" id="sudoAccessBlock">/);
  assert.match(html, /id="sudoAccessBlock"[\s\S]*?id="adminLoginButton"[\s\S]*?Admin Login/);
  assert.match(html, /id="sudoAccessBlock"[\s\S]*?id="resinDatabaseButton"[\s\S]*?id="workspaceManagementButton"[\s\S]*?id="betaApplicantsButton"[\s\S]*?id="databaseHealthButton"/);
  assert.doesNotMatch(html, /id="appFooterAccount"|id="footerAccountMenu"/);
});

test("only notifications retain the desktop nonmodal popover behavior", () => {
  assert.match(app, /function isDesktopNotificationsPopover\(name = activeFooterSheetName\)\{\s*\n\s*return name === "notifications" && isDesktopLayout\(\);/);
  assert.match(app, /function isDesktopPopover\(name = activeFooterSheetName\)\{\s*\n\s*return isDesktopNotificationsPopover\(name\);/);
  assert.doesNotMatch(app, /isDesktopAccountPopover|footerAccountMenu|appFooterAccount/);
});

test("all administrator actions remain gated and navigate to their workspace panel", () => {
  assert.match(app, /\.footerAdminDestination/);
  assert.match(adminUi, /resinDatabaseButton"\)\.hidden = !adminAccess/);
  assert.match(adminUi, /const sudoStatus = \$\("sudoAccessStatus"\);/);
  assert.match(adminUi, /sudoStatus\) sudoStatus\.textContent = initializing/);
});

test("successful login and ordinary dismissal share complete dialog cleanup", () => {
  assert.match(adminUi, /function closeLoginDialog/);
  assert.match(adminUi, /\[data-admin-close\][\s\S]+closeLoginDialog\(\)/);
  assert.match(adminUi, /if \(!result\.ok\)[\s\S]+closeLoginDialog\(\{ reset:true \}\)/);
  assert.match(adminUi, /requestAnimationFrame\(\(\) => \$\("workspaceNavSudo"\)\?\.focus\(\)\)/);
});
