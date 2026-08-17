const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
  test(`${name} keeps the wordmark inside the adaptive-icon safe zone`, () => {
    const icon = fs.readFileSync(`android/app/src/main/res/mipmap-anydpi-v26/${name}`, "utf8");
    assert.match(icon, /android:drawable="@mipmap\/ic_launcher_foreground" android:inset="12%"/);
  });
}
