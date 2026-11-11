"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const { releaseVersion, checkedReleaseVersion, gradleVersionName, LATEST_HAND_BUILT_CODE } = require("../scripts/release-version.js");

test("a release tag maps to a versionName and a derived versionCode", () => {
  assert.deepEqual(releaseVersion("v1.1.27"), { versionName: "1.1.27", versionCode: 10127 });
  assert.deepEqual(releaseVersion("v1.2.0"), { versionName: "1.2.0", versionCode: 10200 });
  assert.deepEqual(releaseVersion("v2.0.0"), { versionName: "2.0.0", versionCode: 20000 });
});

test("versionCode only ever goes up as tags go up", () => {
  const tags = ["v1.1.27", "v1.1.28", "v1.1.99", "v1.2.0", "v1.10.0", "v1.99.99", "v2.0.0", "v10.0.0"];
  const codes = tags.map(t => releaseVersion(t).versionCode);
  for (let i = 1; i < codes.length; i++) assert.ok(codes[i] > codes[i - 1], `${tags[i]} should be above ${tags[i - 1]}`);
});

test("the first release is above the hand-built APKs, so it updates them", () => {
  assert.ok(releaseVersion("v1.1.27").versionCode > LATEST_HAND_BUILT_CODE);
  assert.throws(() => releaseVersion("v0.0.1"), /not above the hand-built/);
});

test("anything that is not vMAJOR.MINOR.PATCH (minor/patch < 100) is refused", () => {
  for (const bad of ["1.1.27", "v1.1", "v1.1.27a", "v1.1.24a", "v1.100.0", "v1.1.100", "v1.1.27-rc1", "", null, undefined, "v1.1.27\nversionCode=99999"]) {
    assert.throws(() => releaseVersion(bad), /not a release tag/, String(bad));
  }
});

test("the tag must match build.gradle's versionName, the version the app's label shows", () => {
  const gradle = 'defaultConfig {\n        versionCode 37\n        versionName "1.1.27"\n    }';
  assert.equal(gradleVersionName(gradle), "1.1.27");
  assert.deepEqual(checkedReleaseVersion("v1.1.27", gradle), { versionName: "1.1.27", versionCode: 10127 });
  assert.throws(() => checkedReleaseVersion("v1.1.28", gradle), /build\.gradle \(and the app's label\) say 1\.1\.27/);
  assert.throws(() => checkedReleaseVersion("v1.1.27", "android {}"), /no versionName/);
  // The real file: today's version is the one a tag would have to name.
  const current = gradleVersionName(fs.readFileSync("android/app/build.gradle", "utf8"));
  assert.match(fs.readFileSync("index.html", "utf8"), new RegExp(`class="desktopRailVersion"[^>]*>v${current.replace(/\./g, "\\.")}<`));
});

test("the CLI writes GitHub step outputs for the tag build.gradle names, and fails otherwise", () => {
  const current = gradleVersionName(fs.readFileSync("android/app/build.gradle", "utf8"));
  const { versionCode } = releaseVersion(`v${current}`);
  const out = execFileSync(process.execPath, ["scripts/release-version.js", `v${current}`], { encoding: "utf8" });
  assert.equal(out, `versionName=${current}\nversionCode=${versionCode}\n`);
  assert.throws(() => execFileSync(process.execPath, ["scripts/release-version.js", "nightly"], { stdio: "pipe" }));
  assert.throws(() => execFileSync(process.execPath, ["scripts/release-version.js", "v9.9.9"], { stdio: "pipe" }));
});
