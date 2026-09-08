"use strict";

/* ---------------------------------------------------------------------------
 * Theme Lab — theme.css parser
 *
 * Developer-only tooling. Not shipped with the production app, not referenced
 * by index.html, not copied into www/ by scripts/build-www.js.
 *
 * Reads the REAL resin.tools theme architecture: each palette is a block of
 * the exact shape
 *
 *     :where(html, body)[data-theme="<name>"]{
 *        --token: value;   // one declaration per line, 2-space indent
 *        ...
 *     }
 *
 * in theme.css. This module locates those blocks and extracts their custom
 * properties together with the source line number of each declaration, so a
 * conservative line-level rewrite is possible later without reformatting the
 * file.
 *
 * It deliberately ignores every other rule in theme.css (per-theme
 * .resinToolsLogo colour overrides, @media tweaks, descendant selectors such
 * as `body[data-theme="ayu-light"] #splitsBlock ...`). Only the palette root
 * block for a theme is considered editable.
 * ------------------------------------------------------------------------- */

// Matches a line that opens a palette root block. Accepts the canonical
// single-selector form and the comma form used by mono/monochrome.
const BLOCK_OPEN_RE =
  /^\s*:where\(html,\s*body\)\[data-theme="([^"]+)"\](?:\s*,\s*:where\(html,\s*body\)\[data-theme="([^"]+)"\])?\s*\{\s*$/;

// A single custom-property declaration line inside a block.
//   group 1: leading whitespace + name + ": "
//   group 2: the value
//   group 3: trailing "; ..." (semicolon plus any trailing comment)
const DECL_RE = /^(\s*(--[A-Za-z0-9_-]+)\s*:\s*)([^;]+?)\s*(;.*)$/;

/**
 * Parse theme.css source text into an ordered list of theme descriptors.
 *
 * @param {string} css  full contents of theme.css
 * @returns {Array<{
 *   name: string,
 *   aliases: string[],
 *   openLine: number,       // 1-based line of the `:where(...)` opener
 *   closeLine: number,      // 1-based line of the closing `}`
 *   colorScheme: string|null,
 *   tokens: Array<{ name: string, value: string, line: number }>,
 *   tokenOrder: string[]
 * }>}
 */
function parseThemeCss(css) {
  const lines = String(css).split("\n");
  const themes = [];
  let current = null;
  let depth = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;

    if (!current) {
      const open = line.match(BLOCK_OPEN_RE);
      if (open) {
        const names = [open[1], open[2]].filter(Boolean);
        current = {
          name: names[0],
          aliases: names.slice(1),
          openLine: lineNo,
          closeLine: -1,
          colorScheme: null,
          tokens: [],
          tokenOrder: [],
          _seen: new Set(),
        };
        depth = 1;
      }
      continue;
    }

    // Inside a block. Track nested braces defensively even though palette
    // blocks contain none today.
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;

    const decl = line.match(DECL_RE);
    if (decl) {
      const name = decl[2];
      const value = decl[3].trim();
      if (current._seen.has(name)) {
        // Last declaration wins, matching CSS cascade within one block.
        const existing = current.tokens.find((t) => t.name === name);
        existing.value = value;
        existing.line = lineNo;
      } else {
        current._seen.add(name);
        current.tokens.push({ name, value, line: lineNo });
        current.tokenOrder.push(name);
      }
    } else {
      const cs = line.match(/^\s*color-scheme\s*:\s*([^;]+);/);
      if (cs) current.colorScheme = cs[1].trim();
    }

    depth += opens - closes;
    if (depth <= 0) {
      current.closeLine = lineNo;
      delete current._seen;
      themes.push(current);
      current = null;
    }
  }

  return themes;
}

/**
 * Reconstruct the CSS text of a single palette block with a set of value
 * overrides applied. Used for "copy block" / "download snippet" export and as
 * the basis for the conservative file rewrite.
 *
 * Existing declaration lines are rewritten in place (indent, name, spacing,
 * trailing `;` and any trailing comment preserved). Tokens that are not
 * already present in the block are appended as `  --token: value;` lines
 * immediately before the closing brace.
 *
 * @param {string} css                full theme.css text
 * @param {string} themeName          palette name
 * @param {Record<string,string>} changes  token -> new value
 * @returns {{ block: string, newTokens: string[], changedLines: Array<{line:number, before:string, after:string}> }}
 */
function renderUpdatedBlock(css, themeName, changes) {
  const lines = String(css).split("\n");
  const themes = parseThemeCss(css);
  const theme = themes.find(
    (t) => t.name === themeName || t.aliases.includes(themeName)
  );
  if (!theme) throw new Error(`Theme "${themeName}" not found in theme.css`);

  const blockLines = lines.slice(theme.openLine - 1, theme.closeLine); // includes opener + closer
  const byLine = new Map(theme.tokens.map((t) => [t.line, t.name]));
  const changedLines = [];
  const handled = new Set();

  for (let idx = 0; idx < blockLines.length; idx += 1) {
    const absLine = theme.openLine + idx;
    const tokenOnLine = byLine.get(absLine);
    if (!tokenOnLine || !(tokenOnLine in changes)) continue;
    const m = blockLines[idx].match(DECL_RE);
    if (!m) continue;
    const nextValue = String(changes[tokenOnLine]).trim();
    if (nextValue === m[3].trim()) {
      handled.add(tokenOnLine);
      continue;
    }
    const rebuilt = `${m[1]}${nextValue}${m[4]}`;
    changedLines.push({ line: absLine, before: blockLines[idx], after: rebuilt });
    blockLines[idx] = rebuilt;
    handled.add(tokenOnLine);
  }

  const newTokens = Object.keys(changes).filter((t) => !handled.has(t));
  if (newTokens.length) {
    const insertion = newTokens.map(
      (t) => `  ${t}: ${String(changes[t]).trim()};`
    );
    // blockLines' last entry is the closing `}` line.
    blockLines.splice(blockLines.length - 1, 0, ...insertion);
  }

  return { block: blockLines.join("\n"), newTokens, changedLines };
}

/**
 * Produce a new full theme.css string with the given overrides applied to one
 * palette block. Everything outside the block is byte-for-byte identical.
 */
function applyChangesToCss(css, themeName, changes) {
  const lines = String(css).split("\n");
  const themes = parseThemeCss(css);
  const theme = themes.find(
    (t) => t.name === themeName || t.aliases.includes(themeName)
  );
  if (!theme) throw new Error(`Theme "${themeName}" not found in theme.css`);

  const { block, newTokens, changedLines } = renderUpdatedBlock(
    css,
    themeName,
    changes
  );
  const before = lines.slice(0, theme.openLine - 1);
  const after = lines.slice(theme.closeLine); // from line after original closer
  const next = [...before, ...block.split("\n"), ...after].join("\n");
  return { css: next, newTokens, changedLines };
}

module.exports = {
  BLOCK_OPEN_RE,
  DECL_RE,
  parseThemeCss,
  renderUpdatedBlock,
  applyChangesToCss,
};
