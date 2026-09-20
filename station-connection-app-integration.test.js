"use strict";

/* The application side of the connection bridge, as source-level checks
 * over app.js, index.html, station-host.js and the harness - the same style
 * as station-bridge-app-integration.test.js, for the same reason: the
 * integration is small enough to describe, and what these guard against is
 * the gradual version. A Station refresh that stops being the floor UI's
 * refresh. A second join-code path. A reload where a reconcile should be.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const app = read("app.js");
const indexHtml = read("index.html");
const harness = read("station/station.html");
const host = read("station-host.js");
const boot = read("station/station.js");
const shell = require("./station/station-shell.js");

function between(startAnchor, endAnchor) {
  const start = app.indexOf(startAnchor);
  assert.ok(start > -1, `anchor not found: ${startAnchor}`);
  const end = app.indexOf(endAnchor, start + startAnchor.length);
  assert.ok(end > start, `end anchor not found: ${endAnchor}`);
  return app.slice(start, end);
}

/* ----------------------------------------------------------------------
 *   Optional, guarded, connected once
 * -------------------------------------------------------------------- */

test("the application treats the connection bridge as optional, connects it once, and swallows a failure to", () => {
  assert.match(app, /const stationConnection = window\.PolynStationConnectionBridge \|\| null;/);
  assert.match(app, /let stationConnectionHandle = null;/);
  assert.match(app, /if \(!stationConnection \|\| stationConnectionHandle\) return;/);
  const connect = between("function connectStationConnection(actions){", "\n  function setupLineSync(){");
  assert.match(connect, /try\{/);
  assert.match(connect, /catch\(error\)\{ stationConnectionHandle = null; \}/);
  assert.equal((app.match(/connectStationConnection\(\{/g) || []).length, 1, "called from exactly one place");
  // Called inside setupLineSync, after the floor UI's own closures exist,
  // and before RT Sync is initialized - so the first sync render already
  // has a subscriber-facing publish site.
  const setup = between("function setupLineSync(){", "void lineSync.initialize()");
  assert.match(setup, /connectStationConnection\(\{/);
  assert.ok(setup.indexOf("const reconnectRtSync =") < setup.indexOf("connectStationConnection({"));
});

test("the descriptor is projected from cloud-sync's public state and the line number PolynLineIdentity resolves - one answer to which line", () => {
  const connect = between("function connectStationConnection(actions){", "\n  function setupLineSync(){");
  assert.match(connect, /const syncState = lineSync\?\.getState\?\.\(\) \|\| null;/);
  assert.match(connect, /window\.PolynLineIdentity\?\.workspaceLineNumber\?\.\(workspace\)/);
  assert.match(connect, /window\.PolynLineIdentity\?\.getLineConfiguration\?\.\(lineNumber\)/);
  assert.match(connect, /stationConnection\.project\(syncState, \{/);
  assert.match(connect, /busy: lineSyncActionInFlight,/);
  assert.match(connect, /busyAction: lineSyncBusyAction,/);
  assert.match(connect, /joinUrl: syncState\?\.generatedCode \? rtSyncLinkUrl\(syncState\.generatedCode\) : ""/);
  // No Station-side line memory: the only workspace identity read here is
  // cloud-sync's selectedWorkspace.
  assert.doesNotMatch(connect, /localStorage|stationLine|stationWorkspace/);
  // The state bridge's line and the connection's line come from the same
  // module, so they cannot name different lines for one workspace.
  assert.match(app, /function derivedLineConfiguration\(syncState = lineSync\?\.getState\?\.\(\)\)\{\s*\n\s*return window\.PolynLineIdentity\?\.getLineConfigurationForSync\(syncState\) \|\| null;/);
});

/* ----------------------------------------------------------------------
 *   The actions are the floor UI's own
 * -------------------------------------------------------------------- */

test("Station's refresh and reconnect ARE the refresh the status bar and Reconnect buttons run; Add device IS Generate Link Code", () => {
  const actions = between("    connectStationConnection({", "    });\n");
  assert.match(actions, /refresh: \(\)=>stationSyncAction\(refreshRtSyncAction, "refresh"\)/);
  assert.match(actions, /reconnect: \(\)=>stationSyncAction\(refreshRtSyncAction, "refresh"\)/);
  assert.match(actions, /generateJoinCode: \(\)=>stationSyncAction\(generateLinkCodeAction, "generate-code"\)/);
  assert.match(actions, /renderJoinQr: async \(\)=>\{/);
  // Exactly the bridge's vocabulary, nothing more.
  const keys = [...actions.matchAll(/^\s{6}(\w+):/gm)].map(match => match[1]);
  assert.deepEqual(keys, ["refresh", "reconnect", "generateJoinCode", "renderJoinQr", "joinWorkspace", "selectWorkspace", "leaveWorkspace", "relabelDevice"]);
  // The same closures the buttons are wired to.
  assert.match(app, /const reconnectRtSync = \(\)=>runLineSyncAction\(refreshRtSyncAction, "refresh"\);/);
  assert.match(app, /const generateLinkCode = \(\)=>runLineSyncAction\(generateLinkCodeAction, "generate-code"\);/);
  assert.match(app, /\$\("lineSyncRefreshStatusBtn"\)\?\.addEventListener\("click",reconnectRtSync\);/);
  assert.match(app, /\$\("lineSyncGenerateCodeBtn"\)\?\.addEventListener\("click",generateLinkCode\);/);
  // refreshSelected when a line is selected, retry otherwise - unchanged.
  assert.match(app, /const refreshRtSyncAction = \(\)=>lineSync\.getState\(\)\.selectedWorkspaceId\s*\n\s*\? lineSync\.refreshSelected\(\)\s*\n\s*: lineSync\.retry\(\);/);
  assert.match(app, /const generateLinkCodeAction = \(\)=>lineSync\.generateLinkCode\(\);/);
});

test("every Station action runs through runLineSyncAction - the same in-flight guard and error path as the buttons - and answers with its message", () => {
  const wrapper = between("    const stationSyncAction = async (run, name)=>{", "    };\n");
  assert.match(wrapper, /if \(lineSyncActionInFlight\) return \{ ok:false, code:"busy"/);
  assert.match(wrapper, /const ok = await runLineSyncAction\(run, name\);/);
  assert.match(wrapper, /message: lastLineSyncErrorMessage \|\| "RT Sync request failed\."/);
  const runner = between("async function runLineSyncAction(action, actionName = \"\"){", "\n  }\n");
  assert.match(runner, /lastLineSyncErrorMessage = "";/);
  assert.match(runner, /lastLineSyncErrorMessage = message;/);
});

test("the phone panel's four actions ARE its own cloud-sync calls, each through stationSyncAction, and the line selector only accepts a remembered line", () => {
  const actions = between("    connectStationConnection({", "    });\n");
  assert.match(actions, /joinWorkspace: \(args\)=>stationSyncAction\(\(\)=>lineSync\.joinWorkspace\(args\.code, args\.label\), "join"\)/);
  assert.match(actions, /leaveWorkspace: \(\)=>stationSyncAction\(\(\)=>lineSync\.leaveWorkspace\(\), "leave"\)/);
  assert.match(actions, /relabelDevice: \(args\)=>stationSyncAction\(\(\)=>lineSync\.updateDeviceLabel\(args\.label\), "relabel"\)/);
  const select = between("      selectWorkspace: (args)=>{", "      },\n");
  assert.match(select, /lineSync\.getState\(\)\.workspaces\.some\(item=>item\.id === args\.id\)/, "an id cloud-sync does not list is refused, not silently ignored");
  assert.match(select, /stationSyncAction\(\(\)=>lineSync\.selectWorkspace\(args\.id\), "connect"\)/);
  // The same calls the panel's own controls make.
  assert.match(app, /runLineSyncAction\(\(\)=>lineSync\.joinWorkspace\(\s*\$\("lineSyncJoinCode"\)\?\.value, \$\("lineSyncDeviceLabel"\)\?\.value\s*\), "join"\)/);
  assert.match(app, /runLineSyncAction\(\(\)=>lineSync\.leaveWorkspace\(\), "leave"\)/);
  assert.match(app, /runLineSyncAction\(\(\)=>lineSync\.selectWorkspace\(event\.target\.value\)\)/);
  assert.match(app, /runLineSyncAction\(\(\)=>lineSync\.updateDeviceLabel\(event\.target\.value\)/);
  // The remembered lines' facts are resolved the way the selected line's are.
  const connect = between("function connectStationConnection(actions){", "\n  function setupLineSync(){");
  assert.match(connect, /workspaces: \(syncState\?\.workspaces \|\| \[\]\)\.map\(item=>\{/);
  assert.match(connect, /window\.PolynLineIdentity\?\.workspaceLineNumber\?\.\(item\)/);
});

test("the Station-facing code never reloads the page, never reaches the client, and never creates, deletes or administers a workspace", () => {
  const stationSide = between("    // Station's line console asks for these same two closures", "    $(\"lineSyncLeaveBtn\")");
  for (const forbidden of [/location\.reload/, /\.reload\s*\(/, /supabase/i, /\.rpc\s*\(/, /\.channel\s*\(/, /createWorkspace|deleteWorkspace|removeMember|transferOwnership|renameWorkspace/]) {
    assert.doesNotMatch(stationSide, forbidden, `the Station adapter does more than hand over existing actions (${forbidden})`);
  }
  // Every closure in the literal is a stationSyncAction, or the QR drawing,
  // or the line-selector guard before one.
  const actions = between("    connectStationConnection({", "    });\n");
  for (const line of actions.split("\n").filter(one => /^\s{6}\w+: /.test(one))) {
    assert.match(line, /stationSyncAction\(|renderJoinQr: async|selectWorkspace: \(args\)=>\{/, `${line.trim()} bypasses the shared runner`);
  }
  const connect = between("function connectStationConnection(actions){", "\n  function setupLineSync(){");
  assert.doesNotMatch(connect, /location\.reload|supabase|\.rpc\s*\(/i);
});

/* ----------------------------------------------------------------------
 *   One join code, one QR drawing
 * -------------------------------------------------------------------- */

test("Station's QR is drawn by the same function as the RT Sync panel's, over the same join URL - there is one QR implementation", () => {
  assert.equal((app.match(/async function linkCodeQrSvg\(code\)\{/g) || []).length, 1);
  assert.equal((app.match(/QRCode\?\.toString/g) || []).length, 1, "one call into the QR library");
  const draw = between("async function linkCodeQrSvg(code){", "\n  }\n");
  assert.match(draw, /const url = rtSyncLinkUrl\(code\);/);
  assert.match(draw, /window\.QRCode\?\.toString\?\.\(url, \{/);
  const panel = between("async function renderLinkCodeQr(code){", "\n  }\n");
  assert.match(panel, /await linkCodeQrSvg\(code\)/);
  const qr = between("      renderJoinQr: async ()=>{", "      }\n");
  assert.match(qr, /const code = lineSync\.getState\(\)\.generatedCode \|\| "";/, "the code is cloud-sync's, never minted here");
  assert.match(qr, /await linkCodeQrSvg\(code\)/);
  assert.doesNotMatch(qr, /rtSyncCode|Math\.random|crypto/);
  // No Station file draws a QR of its own or knows the join URL's shape.
  for (const file of fs.readdirSync(path.join(ROOT, "station")).filter(name => name.endsWith(".js"))) {
    const source = read(path.join("station", file));
    assert.doesNotMatch(source, /\bQRCode\b|rtSyncCode|qrcode\.min|errorCorrectionLevel/, `${file} has its own QR path`);
  }
});

/* ----------------------------------------------------------------------
 *   Loading: both hosts, same modules, bridge before app.js
 * -------------------------------------------------------------------- */

test("index.html loads the connection bridge once, after the state bridge and before app.js; the host and the harness load the console", () => {
  const scripts = [...indexHtml.matchAll(/<script\b[^>]*src="([^"?]+)/g)].map(match => match[1]);
  assert.equal(scripts.filter(name => name === "station-connection-bridge.js").length, 1);
  assert.ok(scripts.indexOf("station-state-bridge.js") < scripts.indexOf("station-connection-bridge.js"));
  assert.ok(scripts.indexOf("station-connection-bridge.js") < scripts.indexOf("app.js"));
  assert.match(host, /"station\/station-sync-console\.js"/);
  assert.match(host, /"station\/styles\/components\/sync-console\.css"/);
  assert.match(harness, /src="station-sync-console\.js\?v=/);
  assert.match(harness, /href="styles\/components\/sync-console\.css\?v=/);
  assert.match(harness, /src="\.\.\/station-connection-bridge\.js\?v=/);
  // Loaded before the boot file, which mounts it; after the shell it mounts into.
  assert.ok(host.indexOf("station-shell.js") < host.indexOf("station-sync-console.js"));
  assert.ok(host.indexOf("station-sync-console.js") < host.indexOf("station/station.js"));
});

test("the shell reserves one header slot for the console, and the boot file mounts it there and nowhere else", () => {
  assert.ok(shell.MOUNTS.includes("connection"));
  const doc = { createElement: name => ({ name, attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; } }) };
  const root = shell.createShell(doc);
  const header = root.children.find(node => node.attrs.class === "station-shell").children.find(node => node.attrs.class === "station-header");
  const slot = header.children.find(node => node.attrs["data-station-mount"] === "connection");
  assert.ok(slot, "the header carries the connection slot");
  assert.equal(slot.attrs.class, "station-header__connection");
  assert.match(boot, /const syncConsole = root\.PolynStationSyncConsole \|\| null;/);
  assert.match(boot, /const connection = root\.PolynStationConnectionBridge \|\| null;/);
  assert.match(boot, /if \(syncConsole && mounts\.connection\) \{\s*\n\s*const lineConsole = syncConsole\.create\(doc, \{ connection \}\);\s*\n\s*mounts\.connection\.appendChild\(lineConsole\.element\);/);
  assert.equal((boot.match(/syncConsole\.create\(/g) || []).length, 1);
  // The boot file hands the bridge over and reads nothing from it itself.
  assert.doesNotMatch(boot, /connection\.(getStatus|request|subscribe)/);
});
