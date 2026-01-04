#!/usr/bin/env python3
import re
import sys
from pathlib import Path

def split_css(in_path: Path, out_html: Path, out_css: Path):
    html = in_path.read_text(encoding="utf-8")

    # Find the first <style>...</style> block
    m = re.search(r"<style\b[^>]*>(.*?)</style>", html, flags=re.S | re.I)
    if not m:
        raise SystemExit("No <style>...</style> block found.")

    css = m.group(1).strip() + "\n"

    # Replace the style block with a link tag (insert at same position)
    link_tag = f'<link rel="stylesheet" href="{out_css.name}">'
    new_html = html[:m.start()] + link_tag + html[m.end():]

    out_css.write_text(css, encoding="utf-8")
    out_html.write_text(new_html, encoding="utf-8")

    print(f"Wrote: {out_html}")
    print(f"Wrote: {out_css}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: split_css.py input.html [output.html] [styles.css]")
        sys.exit(2)

    in_path = Path(sys.argv[1])
    out_html = Path(sys.argv[2]) if len(sys.argv) > 2 else in_path.with_name(in_path.stem + ".linked.html")
    out_css  = Path(sys.argv[3]) if len(sys.argv) > 3 else in_path.with_name("styles.css")

    split_css(in_path, out_html, out_css)
