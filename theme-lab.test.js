"use strict";

/* Tests for the developer-only Theme Lab theme.css parser / conservative
 * rewriter (tools/theme-lab/theme-parser.js). These run in the normal
 * `node --test *.test.js` sweep even though the tool itself is never shipped. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  parseThemeCss,
  renderUpdatedBlock,
  applyChangesToCss,
} = require("./tools/theme-lab/theme-parser.js");

const THEME_CSS = fs.readFileSync(
  path.join(__dirname, "theme.css"),
  "utf8"
);

test("parses every data-theme palette block in the real theme.css", () => {
  const themes = parseThemeCss(THEME_CSS);
  const names = themes.map((t) => t.name);
  // A representative spread from the app's <select id="themeSel">.
  for (const expected of [
    "industrial-slate",
    "industrial-slate-dark",
    "gruvbox-dark",
    "ayu-light",
    "nord",
    "green-team",
    "red-team",
  ]) {
    assert.ok(names.includes(expected), `missing palette: ${expected}`);
  }
});

test("each block has a sane line range and non-empty token set", () => {
  for (const t of parseThemeCss(THEME_CSS)) {
    assert.ok(t.openLine >= 1, `${t.name} openLine`);
    assert.ok(t.closeLine > t.openLine, `${t.name} closeLine after openLine`);
    assert.ok(t.tokens.length > 0, `${t.name} has tokens`);
    for (const tok of t.tokens) {
      assert.ok(/^--[A-Za-z0-9_-]+$/.test(tok.name), `${t.name} ${tok.name}`);
      assert.ok(tok.value.length > 0, `${t.name} ${tok.name} value`);
      assert.ok(
        tok.line > t.openLine && tok.line < t.closeLine,
        `${t.name} ${tok.name} line inside block`
      );
    }
  }
});

test("industrial-slate exposes the core token vocabulary", () => {
  const t = parseThemeCss(THEME_CSS).find((x) => x.name === "industrial-slate");
  const names = t.tokens.map((x) => x.name);
  for (const tok of ["--bg", "--panel", "--text", "--title", "--border", "--ok", "--bad"]) {
    assert.ok(names.includes(tok), `industrial-slate missing ${tok}`);
  }
});

test("renderUpdatedBlock rewrites only the changed declaration line", () => {
  const themes = parseThemeCss(THEME_CSS);
  const t = themes.find((x) => x.name === "ayu-light");
  const target = t.tokens.find((x) => x.name === "--bad");
  const { block, changedLines, newTokens } = renderUpdatedBlock(
    THEME_CSS,
    "ayu-light",
    { "--bad": "#abcabc" }
  );
  assert.equal(newTokens.length, 0);
  assert.equal(changedLines.length, 1);
  assert.equal(changedLines[0].line, target.line);
  assert.match(block, /--bad:\s*#abcabc;/);
  // The old value is gone from the block.
  assert.doesNotMatch(block, new RegExp(`--bad:\\s*${target.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};`));
});

test("rgba() / color-mix() values survive a rewrite untouched", () => {
  const themes = parseThemeCss(THEME_CSS);
  const t = themes.find((x) => x.name === "industrial-slate");
  // pick a token whose value is an rgba()
  const rgbaTok = t.tokens.find((x) => /^rgba\(/.test(x.value));
  assert.ok(rgbaTok, "expected an rgba() token in industrial-slate");
  const newVal = "rgba(1,2,3,.5)";
  const { css } = applyChangesToCss(THEME_CSS, "industrial-slate", {
    [rgbaTok.name]: newVal,
  });
  const reparsed = parseThemeCss(css).find((x) => x.name === "industrial-slate");
  assert.equal(
    reparsed.tokens.find((x) => x.name === rgbaTok.name).value,
    newVal
  );
  // Every other token in the block is byte-identical.
  for (const tok of t.tokens) {
    if (tok.name === rgbaTok.name) continue;
    assert.equal(
      reparsed.tokens.find((x) => x.name === tok.name).value,
      tok.value,
      `${tok.name} must be unchanged`
    );
  }
});

test("applyChangesToCss leaves all other palette blocks byte-for-byte", () => {
  const before = parseThemeCss(THEME_CSS);
  const { css } = applyChangesToCss(THEME_CSS, "nord", { "--bg": "#010203" });
  const after = parseThemeCss(css);
  for (const b of before) {
    if (b.name === "nord") continue;
    const a = after.find((x) => x.name === b.name);
    assert.ok(a, `${b.name} still present`);
    assert.deepEqual(
      a.tokens.map((x) => `${x.name}:${x.value}`),
      b.tokens.map((x) => `${x.name}:${x.value}`),
      `${b.name} tokens unchanged`
    );
  }
  // Total line count only grows if a token was appended; here it must be equal.
  assert.equal(css.split("\n").length, THEME_CSS.split("\n").length);
});

test("a brand-new token is appended just before the block's closing brace", () => {
  const { css, newTokens } = applyChangesToCss(THEME_CSS, "nord", {
    "--themelab-probe": "#123456",
  });
  assert.deepEqual(newTokens, ["--themelab-probe"]);
  const t = parseThemeCss(css).find((x) => x.name === "nord");
  const probe = t.tokens.find((x) => x.name === "--themelab-probe");
  assert.ok(probe, "probe token present after apply");
  assert.equal(probe.value, "#123456");
  assert.equal(probe.line, t.closeLine - 1);
});

test("unknown theme name is rejected, file untouched", () => {
  assert.throws(
    () => applyChangesToCss(THEME_CSS, "no-such-theme", { "--bg": "#000" }),
    /not found/
  );
});

test("no-op change produces no changed lines", () => {
  const t = parseThemeCss(THEME_CSS).find((x) => x.name === "ayu-light");
  const tok = t.tokens[0];
  const { changedLines, newTokens } = renderUpdatedBlock(THEME_CSS, "ayu-light", {
    [tok.name]: tok.value,
  });
  assert.equal(changedLines.length, 0);
  assert.equal(newTokens.length, 0);
});
