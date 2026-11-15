#!/usr/bin/env python3
"""Write the text in content/ into the site's pages.

    python3 tools/build_content.py

Each content file fills the part of a page between <!-- content:NAME --> and <!-- /content:NAME --> markers.
The Pages workflow runs this before every deploy; run it locally to preview your edits.
"""
import html, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT, SITE = ROOT / "content", ROOT / "site"


def read(name):
    text = (CONTENT / name).read_text(encoding="utf-8")
    return re.sub(r"<!--.*?-->", "", text, flags=re.S)  # comments are notes to yourself


def inline(text):
    """*italic*, **bold**, `code` and [text](url); everything else is escaped."""
    out, pos = [], 0
    for m in re.finditer(r"`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)", text):
        out.append(emphasis(html.escape(text[pos:m.start()], quote=False)))
        if m.group(1) is not None:
            out.append("<code>%s</code>" % html.escape(m.group(1), quote=False))
        else:
            out.append('<a href="%s">%s</a>' % (html.escape(m.group(3)), emphasis(html.escape(m.group(2), quote=False))))
        pos = m.end()
    out.append(emphasis(html.escape(text[pos:], quote=False)))
    return "".join(out)


def emphasis(s):
    s = re.sub(r"\*\*(?=\S)(.+?)(?<=\S)\*\*", r"<strong>\1</strong>", s)
    return re.sub(r"(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])", r"<em>\1</em>", s)


def paragraphs(text):
    return [" ".join(l.strip() for l in block.splitlines() if l.strip()) for block in re.split(r"\n\s*\n", text) if block.strip()]


def intro():
    ps = paragraphs(read("intro.md"))
    if not ps:
        return ['<p data-lorem="s3"></p>', '<p data-lorem="s4"></p>']
    return ["<p>%s</p>" % inline(p) for p in ps]


def projects():
    lines = []
    for block in re.split(r"^##[ \t]+", read("projects.md"), flags=re.M)[1:]:
        name, _, rest = block.partition("\n")
        link = re.search(r"^link:[ \t]*(\S+)[ \t]*$", rest, flags=re.M)
        about = " ".join(paragraphs(re.sub(r"^link:.*$", "", rest, flags=re.M)))
        dt = '<a href="%s">%s</a>' % (html.escape(link.group(1)), inline(name.strip())) if link else inline(name.strip())
        dd = "<dd>%s</dd>" % inline(about) if about else '<dd data-lorem="s1"></dd>'
        lines.append("<dt>%s</dt>%s" % (dt, dd))
    return lines


def fill(page, name, lines):
    path = SITE / page
    s = path.read_text(encoding="utf-8")
    pat = re.compile(r"([ \t]*)<!-- content:%s -->\n.*?<!-- /content:%s -->" % (name, name), re.S)
    m = pat.search(s)
    if not m:
        sys.exit("%s: no <!-- content:%s --> markers" % (page, name))
    ind = m.group(1)
    block = "%s<!-- content:%s -->\n%s\n%s<!-- /content:%s -->" % (ind, name, "\n".join(ind + l for l in lines), ind, name)
    path.write_text(s[:m.start()] + block + s[m.end():], encoding="utf-8")


fill("index.html", "intro", intro())
fill("index.html", "projects", projects())
print("content written into site/index.html")
