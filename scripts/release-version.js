"use strict";

// Turns a release tag into the Android version the release workflow builds
// with (.github/workflows/android-release.yml). The versionCode is derived
// from the tag, not kept in a file or counter, so the same tag always builds
// the same version and a later tag always builds a higher one:
//
//   v1.1.27  ->  versionName "1.1.27", versionCode 10127
//
// (major * 10000 + minor * 100 + patch). That only stays monotonic while
// minor and patch are below 100, so anything else is refused rather than
// silently producing a code that could go backwards. The lowest it can yield
// for the current 1.x line (10000+) is far above the hand-built APKs' 37, so
// the first release updates them.
//
// The tag must name the version android/app/build.gradle already carries
// (its versionName is what index.html shows the operator), so a release can
// never ship one number on the label and another in Android's settings.
// Ship a version the way it is bumped today, then tag that commit.

const fs = require("node:fs");
const path = require("node:path");

const LATEST_HAND_BUILT_CODE = 37;
const GRADLE = path.resolve(__dirname, "..", "android", "app", "build.gradle");

function gradleVersionName(source) {
  const match = /^\s*versionName "([^"]+)"/m.exec(source);
  if (!match) throw new Error("release-version: android/app/build.gradle has no versionName.");
  return match[1];
}

function releaseVersion(tag) {
  const match = /^v(\d{1,3})\.(\d{1,2})\.(\d{1,2})$/.exec(String(tag || ""));
  if (!match) {
    throw new Error(`release-version: "${tag}" is not a release tag like v1.1.27 (vMAJOR.MINOR.PATCH, minor and patch below 100).`);
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  const versionCode = major * 10000 + minor * 100 + patch;
  if (versionCode <= LATEST_HAND_BUILT_CODE) {
    throw new Error(`release-version: ${tag} gives versionCode ${versionCode}, not above the hand-built ${LATEST_HAND_BUILT_CODE}; phones would refuse it.`);
  }
  return { versionName: `${major}.${minor}.${patch}`, versionCode };
}

function checkedReleaseVersion(tag, gradleSource = fs.readFileSync(GRADLE, "utf8")) {
  const version = releaseVersion(tag);
  const declared = gradleVersionName(gradleSource);
  if (declared !== version.versionName) {
    throw new Error(`release-version: tag ${tag} but build.gradle (and the app's label) say ${declared}. Bump the version first, then tag that commit.`);
  }
  return version;
}

if (require.main === module) {
  const { versionName, versionCode } = checkedReleaseVersion(process.argv[2]);
  // GitHub Actions step-output format.
  process.stdout.write(`versionName=${versionName}\nversionCode=${versionCode}\n`);
}

module.exports = { releaseVersion, checkedReleaseVersion, gradleVersionName, LATEST_HAND_BUILT_CODE };
