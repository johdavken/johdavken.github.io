"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const cloudSync = fs.readFileSync("cloud-sync.js", "utf8");
const desktopCss = fs.readFileSync("desktop.css", "utf8");

test("desktop has one line identity and no permanent line selector", () => {
  assert.match(html, /id="desktopLineSyncName"/);
  assert.match(html, /id="desktopLineSyncState"/);
  assert.doesNotMatch(html, /id="lineSyncWorkspaceSelect"[^>]*desktopSyncOnly/);
  assert.match(html, /id="lineSyncWorkspaceSelect"[^>]*>\s*<option value="">No linked lines/);
  assert.match(html, /id="desktopLineSyncWorkspaceSelect"/);
});

test("desktop recovery hides the dashboard until a line is connected and can recover a known line", () => {
  assert.match(html, /This desktop is not connected/);
  assert.match(html, /id="desktopLineSyncSetupBtn"/);
  assert.match(app, /Reconnect this desktop to \$\{selected\.name\}\?/);
  assert.match(app, /button\.textContent = `Reconnect to \$\{selected\.name\}`/);
  assert.match(app, /setup\.hidden = !!selected && !!syncState\.connected && !adminRequired/);
  assert.match(app, /main\.hidden = !desktopConnected/);
  assert.match(app, /metrics\.hidden = !desktopConnected/);
  assert.match(app, /const desktopConnected = !!selected && connected && !adminRequired/);
  assert.match(app, /reconnect\.hidden = !desktopConnected \|\| !\["Error", "Offline", "Conflict"\]\.includes\(status\)/);
  assert.match(app, /syncPanel\.classList\.toggle\("desktopDisconnected", !desktopConnected\)/);
  assert.match(desktopCss, /\.lineSyncPanel\.desktopDisconnected > #lineSyncMessage\{display:none\}/);
});

test("reconnect refreshes the existing assignment without leaving, removing, or reassigning it", () => {
  const reconnect = app.slice(app.indexOf("const reconnectRtSync ="), app.indexOf("void lineSync.initialize()"));
  assert.match(reconnect, /lineSync\.refreshSelected\(\)/);
  assert.doesNotMatch(reconnect, /leaveWorkspace|removeMember|selectWorkspace/);
  const refresh = cloudSync.slice(cloudSync.indexOf("async function refreshSelected(){"), cloudSync.indexOf("function getWorkspaceConfigurationTransport(){"));
  assert.match(refresh, /await reconcileSelected\(\{ forceRemote: true \}\)/);
});

test("QR links use only the short-lived join code and feed the existing join path", () => {
  assert.match(app, /url\.search = "";/);
  assert.match(app, /url\.searchParams\.set\("rtSyncCode", code\)/);
  assert.match(app, /QRCode\?\.toString\?\.\(rtSyncLinkUrl\(code\)/);
  assert.match(app, /lineSync\.joinWorkspace\(\s*joiningCode/);
  assert.match(app, /clearRtSyncLinkCodeFromUrl\(\);/);
  assert.match(html, /id="lineSyncQrJoinDialog"/);
});

test("desktop connected devices render only membership facts already provided by RT Sync", () => {
  assert.match(html, /id="desktopLineSyncDevicesList"/);
  const render = app.slice(app.indexOf("function renderDesktopLineSyncDevices"), app.indexOf("function renderDesktopLineSyncSetup"));
  assert.match(render, /member\.device_label/);
  assert.match(render, /member\.last_seen_at/);
  assert.match(render, /member\.device_id === syncState\.deviceId/);
  assert.doesNotMatch(render, /online|presence/i);
});

test("desktop CSS does not resurrect the retired RT Sync control grid", () => {
  assert.doesNotMatch(desktopCss, /\.lineSyncPanel\{display:grid;grid-template-columns:minmax\(0,1\.1fr\)/);
  assert.match(desktopCss, /\.desktopLineSyncMain\{display:grid;grid-template-columns:minmax\(320px,1\.1fr\) minmax\(280px,\.9fr\)/);
  assert.doesNotMatch(desktopCss, /\.lineSyncMembers\{grid-column:2;grid-row:5/);
});
