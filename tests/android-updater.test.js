"use strict";

// Source-level contract for the GitHub-release updater. The pieces live in
// four languages (workflow YAML, Gradle, Java, the manifest) and only work
// if they agree: the workflow must build and name the APK exactly the way
// UpdateRelease.java looks for it, for the package and key already on the
// phones. The decision logic itself is JUnit-tested (UpdateReleaseTest).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = p => fs.readFileSync(p, "utf8");
const JAVA = "android/app/src/main/java/tools/resin/app/";
const workflow = read(".github/workflows/android-release.yml");
const gradle = read("android/app/build.gradle");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const strings = read("android/app/src/main/res/values/strings.xml");
const mainActivity = read(JAVA + "MainActivity.java");
const updater = read(JAVA + "AppUpdater.java");
const release = read(JAVA + "UpdateRelease.java");

const env = name => {
  const m = workflow.match(new RegExp(`^  ${name}: (.+)$`, "m"));
  assert.ok(m, `workflow env ${name}`);
  return m[1].trim();
};

test("the workflow builds the package the Fold runs, signed with the installed key", () => {
  assert.equal(env("APP_ID_SUFFIX"), ".slatepreview");
  assert.equal(env("APP_NAME"), "Slate Preview");
  assert.equal(env("BOOT_VIEW"), "slate");
  // Certificate digest (not a file hash) of ~/.config/.android/debug.keystore,
  // read off the installed APK with apksigner 2026-11-11.
  assert.equal(env("EXPECTED_CERT_SHA256"), "1b0c01400d249ae4be4231a69e59a94e87df061185d5be4da10bbd174bc5d026");
  assert.match(workflow, /\[ "\$CERT" = "\$EXPECTED_CERT_SHA256" \] \|\| \{[^}]*exit 1; \}/);
  assert.match(workflow, /name='\$APP_ID' versionCode='\$CODE'/);
});

test("the workflow runs only on version tags and passes the tag through env, never inline", () => {
  assert.match(workflow, /on:\n  push:\n    tags: \["v\*"\]\n/);
  assert.doesNotMatch(workflow, /pull_request|workflow_run|issue/);
  assert.doesNotMatch(workflow, /\$\{\{\s*github\.(ref_name|event)/);
  assert.match(workflow, /node scripts\/release-version\.js "\$GITHUB_REF_NAME"/);
  assert.match(workflow, /permissions:\n  contents: write\n/);
});

test("the release asset is named the way UpdateRelease matches it", () => {
  assert.match(workflow, /NAME="\$APP_ID-\$CODE\.apk"/);
  assert.match(release, /Pattern\.compile\("\^\(\.\+\)-\(\\\\d\{1,9\}\)\\\\.apk\$"\)/);
  assert.match(release, /packageName\.equals\(m\.group\(1\)\)/);
  assert.match(release, /Pattern\.compile\("\^v\(\\\\d\+\\\\\.\\\\d\+\\\\\.\\\\d\+\)\$"\)/);
});

test("the workflow feeds Gradle the properties build.gradle reads", () => {
  for (const prop of ["resinAppIdSuffix", "resinAppName", "resinVersionCode"]) {
    assert.match(workflow, new RegExp(`-P${prop}=`), prop);
    assert.match(gradle, new RegExp(`findProperty\\('${prop}'\\)`), prop);
  }
  assert.match(workflow, /node scripts\/build-www\.js --boot-view "\$BOOT_VIEW"/);
  assert.match(workflow, /testDebugUnitTest assembleDebug/);
  // The version NAME is never overridden: build.gradle's is the label's.
  assert.doesNotMatch(workflow + gradle, /resinVersionName/);
});

test("a local build keeps today's identity: tools.resin.app, Resin Tools, versionCode 37", () => {
  assert.match(gradle, /applicationId "tools\.resin\.app"/);
  assert.match(gradle, /^\s*versionCode 37$/m);
  assert.match(gradle, /^\s*versionName "\d+\.\d+\.\d+"$/m);
  assert.match(gradle, /if \(project\.findProperty\('resinVersionCode'\)\) \{\s*versionCode\(project\.findProperty\('resinVersionCode'\) as int\)/);
  assert.match(gradle, /resValue "string", "app_name", \(project\.findProperty\('resinAppName'\) \?: 'Resin Tools'\)/);
  assert.match(gradle, /if \(project\.findProperty\('resinAppIdSuffix'\)\)/);
  // app_name moved to a resValue; defining it twice fails the resource merge.
  assert.doesNotMatch(strings, /name="app_name"/);
  assert.match(strings, /name="title_activity_main">Resin Tools</);
});

test("the app checks on resume and may ask to install packages", () => {
  assert.match(mainActivity, /public void onResume\(\) \{\s*super\.onResume\(\);\s*AppUpdater\.onResume\(this\);/);
  assert.match(manifest, /android:name="android\.permission\.REQUEST_INSTALL_PACKAGES"/);
  assert.match(manifest, /android:authorities="\$\{applicationId\}\.fileprovider"/);
});

test("the updater reads this repo's latest release over HTTPS and decides through UpdateRelease", () => {
  assert.match(updater, /"https:\/\/api\.github\.com\/repos\/johdavken\/johdavken\.github\.io\/releases\/latest"/);
  assert.match(updater, /UpdateRelease\.pick\(context\.getPackageName\(\), installedVersionCode\(context\)/);
  assert.match(updater, /optBoolean\("draft"\) \|\| release\.optBoolean\("prerelease"\)/);
});

test("the downloaded APK is checked before Android's installer is opened", () => {
  assert.match(updater, /getPackageArchiveInfo\(apk\.getAbsolutePath\(\), 0\)/);
  assert.match(updater, /context\.getPackageName\(\)\.equals\(info\.packageName\)/);
  assert.match(updater, /versionCodeOf\(info\) == candidate\.versionCode/);
  const download = updater.slice(updater.indexOf("private static void download("), updater.indexOf("private interface Progress"));
  assert.ok(download.indexOf("isExpectedApk(") < download.indexOf("openInstaller("), "check before install");
  // Downloads land in cache/updates, which file_paths.xml's cache-path exposes.
  assert.match(read("android/app/src/main/res/xml/file_paths.xml"), /<cache-path name="[^"]+" path="\." \/>/);
  assert.match(updater, /new File\(context\.getCacheDir\(\), DOWNLOAD_DIR\)/);
});

test("the updater stays native: no web file mentions it", () => {
  for (const file of ["app.js", "slate-host.js", "station-host.js", "index.html"]) {
    assert.doesNotMatch(read(file), /AppUpdater|releases\/latest/, file);
  }
});
