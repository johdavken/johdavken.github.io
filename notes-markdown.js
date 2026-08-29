(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynNotesMarkdown = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // -------------------------------------------------------------------------
  //  RT Notes — bounded Markdown <-> HTML converters  (TipTap EXPERIMENT)
  // -------------------------------------------------------------------------
  //
  //  Deliberately small and dependency-free. It covers ONLY the syntax the RT
  //  Notes toolbar has ever produced:
  //
  //      # ..###### headings      **bold**  __bold__   *italic*  _italic_
  //      - / * / + bullet lists   1. numbered lists
  //      - [ ] / - [x] task lists paragraphs / blank lines
  //
  //  markdownToHtml() is used once, lazily, when a legacy Markdown note is
  //  opened in the TipTap editor (the stored note is NOT rewritten until the
  //  user actually edits it). htmlToMarkdown() is the emergency reverse path
  //  for rollback / export tooling and is not user-facing.
  //
  //  Neither function throws: on any internal error markdownToHtml() falls back
  //  to the escaped raw text in <p> tags so the note stays readable, and
  //  htmlToMarkdown() falls back to tag-stripped plain text.
  // -------------------------------------------------------------------------

  function str(value) {
    return value == null ? "" : String(value);
  }

  function escapeHtml(text) {
    return str(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function decodeEntities(text) {
    return str(text)
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&"); // last, so "&amp;lt;" does not become "<"
  }

  /* ---------------------------------------------------------------------
   *   Markdown -> HTML  (for loading a legacy note into TipTap)
   * ------------------------------------------------------------------- */

  function inlineMarkdown(text) {
    let s = escapeHtml(text);
    s = s
      .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_\n]+?)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/(^|[^_])_(?!\s)([^_\n]+?)_(?!_)/g, "$1<em>$2</em>");
    return s;
  }

  const RE_HEADING = /^(#{1,6})\s+(.*)$/;
  const RE_TASK = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
  const RE_BULLET = /^\s*[-*+]\s+(.*)$/;
  const RE_NUMBER = /^\s*(\d+)\.\s+(.*)$/;

  function classify(line) {
    if (RE_TASK.test(line)) return "task";
    if (RE_BULLET.test(line)) return "bullet";
    if (RE_NUMBER.test(line)) return "number";
    return null;
  }

  function markdownToHtml(md) {
    try {
      const lines = str(md).replace(/\r\n?/g, "\n").split("\n");
      const out = [];
      let para = [];

      const flushPara = () => {
        if (!para.length) return;
        const joined = para.join(" ").trim();
        if (joined) out.push("<p>" + inlineMarkdown(joined) + "</p>");
        para = [];
      };

      let i = 0;
      while (i < lines.length) {
        const line = lines[i];

        if (line.trim() === "") {
          flushPara();
          i += 1;
          continue;
        }

        const heading = line.match(RE_HEADING);
        if (heading) {
          flushPara();
          const level = heading[1].length;
          out.push("<h" + level + ">" + inlineMarkdown(heading[2].trim()) + "</h" + level + ">");
          i += 1;
          continue;
        }

        const kind = classify(line);
        if (kind) {
          flushPara();
          const items = [];
          while (i < lines.length && classify(lines[i]) === kind) {
            if (kind === "task") {
              const m = lines[i].match(RE_TASK);
              const checked = m[1].toLowerCase() === "x";
              items.push(
                '<li data-type="taskItem" data-checked="' +
                  (checked ? "true" : "false") +
                  '"><p>' +
                  inlineMarkdown(m[2].trim()) +
                  "</p></li>"
              );
            } else if (kind === "bullet") {
              items.push("<li><p>" + inlineMarkdown(lines[i].match(RE_BULLET)[1].trim()) + "</p></li>");
            } else {
              items.push("<li><p>" + inlineMarkdown(lines[i].match(RE_NUMBER)[2].trim()) + "</p></li>");
            }
            i += 1;
          }
          if (kind === "task") out.push('<ul data-type="taskList">' + items.join("") + "</ul>");
          else if (kind === "bullet") out.push("<ul>" + items.join("") + "</ul>");
          else out.push("<ol>" + items.join("") + "</ol>");
          continue;
        }

        para.push(line.trim());
        i += 1;
      }
      flushPara();
      return out.join("");
    } catch (error) {
      return "<p>" + escapeHtml(str(md)).replace(/\n/g, "<br>") + "</p>";
    }
  }

  /* ---------------------------------------------------------------------
   *   HTML -> Markdown  (emergency rollback / export helper, not user-facing)
   *
   *   Understands exactly the HTML this TipTap configuration emits: <p>,
   *   <h1..3>, <strong>/<em>/<s>, flat <ul>/<ol>, and task lists as
   *   <ul data-type="taskList"><li data-checked="..."> ... </li></ul>.
   *   Nested lists (only reachable by pressing Tab in the editor) are
   *   flattened. Anything unrecognised degrades to its text content.
   * ------------------------------------------------------------------- */

  function inlineToMarkdown(html) {
    let s = str(html)
      .replace(/<\s*(strong|b)\s*>/gi, "**")
      .replace(/<\s*\/\s*(strong|b)\s*>/gi, "**")
      .replace(/<\s*(em|i)\s*>/gi, "*")
      .replace(/<\s*\/\s*(em|i)\s*>/gi, "*")
      .replace(/<\s*(s|del|strike)\s*>/gi, "~~")
      .replace(/<\s*\/\s*(s|del|strike)\s*>/gi, "~~")
      .replace(/<\s*br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, "");
    s = decodeEntities(s).replace(/[ \t\n]+/g, " ").trim();
    return s;
  }

  function unwrapItem(inner) {
    // Task items serialise as <label>..</label><div><p>text</p></div>; plain
    // list items as <p>text</p>. Drop the checkbox label, then flatten.
    return inner.replace(/<label\b[\s\S]*?<\/label>/gi, "");
  }

  function listItems(listHtml) {
    const items = [];
    const re = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
    let m;
    while ((m = re.exec(listHtml))) items.push({ attrs: m[1] || "", inner: m[2] || "" });
    return items;
  }

  function htmlToMarkdown(html) {
    try {
      const src = str(html).replace(/\r?\n/g, "").trim();
      if (!src) return "";
      const blockRe = /<(h[1-6]|p|ul|ol)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
      const out = [];
      let lastIndex = 0;
      let m;
      while ((m = blockRe.exec(src))) {
        // Any stray text between recognised blocks -> its plain text.
        const between = src.slice(lastIndex, m.index);
        const strayText = inlineToMarkdown(between);
        if (strayText) out.push(strayText);
        lastIndex = blockRe.lastIndex;

        const tag = m[1].toLowerCase();
        const attrs = m[2] || "";
        const inner = m[3] || "";

        if (tag[0] === "h") {
          const level = Math.min(6, Math.max(1, parseInt(tag.slice(1), 10) || 1));
          out.push("#".repeat(level) + " " + inlineToMarkdown(inner));
        } else if (tag === "p") {
          const text = inlineToMarkdown(inner);
          if (text) out.push(text);
        } else if (tag === "ul" && /data-type\s*=\s*["']taskList["']/i.test(attrs)) {
          listItems(inner).forEach((it) => {
            const checked = /data-checked\s*=\s*["']true["']/i.test(it.attrs);
            out.push((checked ? "- [x] " : "- [ ] ") + inlineToMarkdown(unwrapItem(it.inner)));
          });
        } else if (tag === "ul") {
          listItems(inner).forEach((it) => out.push("- " + inlineToMarkdown(unwrapItem(it.inner))));
        } else if (tag === "ol") {
          let n = 0;
          listItems(inner).forEach((it) => {
            n += 1;
            out.push(n + ". " + inlineToMarkdown(unwrapItem(it.inner)));
          });
        }
      }
      const tail = inlineToMarkdown(src.slice(lastIndex));
      if (tail) out.push(tail);
      return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    } catch (error) {
      return inlineToMarkdown(html);
    }
  }

  /* ---------------------------------------------------------------------
   *   HTML -> plain text  (list previews / title fallback; never rendered
   *   as markup). Block boundaries become newlines so the caller's own
   *   first-line / whitespace-collapsing logic still works.
   * ------------------------------------------------------------------- */

  function htmlToPlainText(html) {
    const withBreaks = str(html)
      .replace(/<\s*(br|\/p|\/h[1-6]|\/li|\/div|\/tr)\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]*>/g, "");
    return decodeEntities(withBreaks);
  }

  return {
    escapeHtml,
    decodeEntities,
    markdownToHtml,
    htmlToMarkdown,
    htmlToPlainText
  };
});
