"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const manifest = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
const assetLinks = JSON.parse(fs.readFileSync(".well-known/assetlinks.json", "utf8"));
const app = fs.readFileSync("app.js", "utf8");

test("Android claims the existing verified resin.tools HTTPS root URL", () => {
  assert.match(manifest, /<intent-filter android:autoVerify="true">/);
  assert.match(manifest, /android:name="android\.intent\.action\.VIEW"/);
  assert.match(manifest, /android:name="android\.intent\.category\.BROWSABLE"/);
  assert.match(manifest, /android:scheme="https"/);
  assert.match(manifest, /android:host="resin\.tools"/);
  assert.match(manifest, /android:path="\/"/);
});

test("Digital Asset Links delegates resin.tools URLs to the Resin Tools package", () => {
  assert.equal(assetLinks.length, 1);
  assert.deepEqual(assetLinks[0].relation, ["delegate_permission/common.handle_all_urls"]);
  assert.equal(assetLinks[0].target.namespace, "android_app");
  assert.equal(assetLinks[0].target.package_name, "tools.resin.app");
  assert.ok(assetLinks[0].target.sha256_cert_fingerprints.includes("A7:84:64:75:A6:D1:BD:2B:B0:6C:89:88:8A:32:68:90:38:83:52:25:16:BF:65:30:4E:D3:78:E5:77:8D:12:AD"));
  assert.ok(assetLinks[0].target.sha256_cert_fingerprints.includes("30:64:8C:5E:B5:7B:4E:2F:AA:66:3B:06:50:E3:67:4D:76:B9:F8:AA:19:9D:D6:9D:4C:50:2C:E5:4D:36:CC:35"));
});

test("cold and warm native URLs feed the existing RT Sync join-confirmation path", () => {
  assert.match(app, /addListener\?\.\("appUrlOpen", event=>queueOrOpenNativeRtSyncUrl\(event\?\.url\)\)/);
  assert.match(app, /const launchUrlRequest = nativeApp\.getLaunchUrl\?\.\(\)/);
  assert.match(app, /launchUrlRequest\.then\(result=>queueOrOpenNativeRtSyncUrl\(result\?\.url\)\)/);
  assert.match(app, /openRtSyncJoinFromUrl\(url, true\)/);
  assert.match(app, /sourceUrl\.searchParams\.get\("rtSyncCode"\)/);
  assert.match(app, /lineSync\.joinWorkspace\(\s*joiningCode/);
  assert.match(app, /sourceUrl\.protocol !== "https:" \|\| sourceUrl\.hostname !== "resin\.tools" \|\| sourceUrl\.pathname !== "\/"/);
});

test("the QR stays the existing HTTPS URL with only rtSyncCode", () => {
  assert.match(app, /url\.search = "";/);
  assert.match(app, /url\.hash = "";/);
  assert.match(app, /url\.searchParams\.set\("rtSyncCode", code\)/);
  assert.doesNotMatch(app, /resintools:\/\//i);
});
