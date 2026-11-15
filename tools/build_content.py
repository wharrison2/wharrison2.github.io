#!/usr/bin/env python3
"""Write the site's text, kept in content/, into its pages.

    python3 tools/build_content.py

Each page has one text file in content/ (content/shared.toml is for what's on every page). In the HTML, an element
with data-t="some.key" gets that string as its contents, and data-t-ATTR="some.key" sets the attribute ATTR. Every
string also goes into site/strings/PAGE.js for the page's scripts. The Pages workflow runs this before every deploy;
run it locally to see your edits. Name pages to do only those: python3 tools/build_content.py markov qr
"""
import html, json, re, sys, tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT, SITE = ROOT / "content", ROOT / "site"

# Which pages each text file is for. shared.toml is for all of them.
PAGES = {
    "home": ["index.html"],
    "markov": ["markov/index.html"],
    "qr": ["qr/index.html"],
    "transcription": ["transcription/index.html"],
}
ALL_PAGES = sorted(str(p.relative_to(SITE)) for p in [*SITE.glob("*.html"), *SITE.glob("*/index.html")])


def load(name):
    with open(CONTENT / (name + ".toml"), "rb") as f:
        return tomllib.load(f)


def flat(table, prefix=""):
    out = {}
    for k, v in table.items():
        if isinstance(v, dict):
            out.update(flat(v, prefix + k + "."))
        else:
            out[prefix + k] = v
    return out


# ---------- turning a string into HTML ----------

def inline(text):
    """*italic*, **bold**, `code`, [text](url) and {slot}; everything else is escaped."""
    out, pos = [], 0
    for m in re.finditer(r"`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\{(\w+)\}", text):
        out.append(emphasis(html.escape(text[pos:m.start()], quote=False)))
        if m.group(1) is not None:
            out.append("<code>%s</code>" % html.escape(m.group(1), quote=False))
        elif m.group(4) is not None:
            out.append('<span id="%s"></span>' % m.group(4))  # the page's script fills it in
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


def render(value, tag, indent):
    """A string as an element's contents: paragraphs if it has blank lines in it, otherwise one line."""
    ps = paragraphs(value)
    if not ps:  # nothing written yet: placeholder text
        if tag in ("section", "div"):
            return '\n%s  <p data-lorem="s3"></p>\n%s  <p data-lorem="s4"></p>\n%s' % (indent, indent, indent)
        return '<span data-lorem="s2"></span>'
    if len(ps) == 1 and tag not in ("section", "div"):
        return inline(ps[0])
    return "".join("\n%s  <p>%s</p>" % (indent, inline(p)) for p in ps) + "\n" + indent


def projects(items, indent):
    lines = []
    for p in items:
        name = inline(p["name"])
        dt = '<a href="%s">%s</a>' % (html.escape(p["link"]), name) if p.get("link") else name
        dd = "<dd>%s</dd>" % inline(" ".join(paragraphs(p.get("about", "")))) if p.get("about", "").strip() else '<dd data-lorem="s1"></dd>'
        lines.append("<dt>%s</dt>%s" % (dt, dd))
    return "".join("\n%s  %s" % (indent, l) for l in lines) + "\n" + indent


# ---------- writing strings into a page ----------

OPEN = re.compile(r'<([a-zA-Z][\w-]*)\b[^>]*?\sdata-t="([^"]+)"[^>]*>')


def close_of(s, tag, start):
    """Where the element whose opening tag ends at `start` closes, counting nested ones of the same tag."""
    depth, pat = 1, re.compile(r"<(/?)%s\b[^>]*>" % tag, re.I)
    for m in pat.finditer(s, start):
        depth += -1 if m.group(1) else 1
        if depth == 0:
            return m.start()
    raise ValueError("no </%s>" % tag)


def fill_page(page, strings, raw):
    path = SITE / page
    s = path.read_text(encoding="utf-8")
    used, pos = set(), 0
    while (m := OPEN.search(s, pos)):
        tag, key = m.group(1).lower(), m.group(2)
        if key not in raw:
            sys.exit("%s: data-t=\"%s\" isn't in its content file" % (page, key))
        line_start = s.rfind("\n", 0, m.start()) + 1
        indent = re.match(r"[ \t]*", s[line_start:]).group(0)
        end = close_of(s, tag, m.end())
        inner = projects(raw[key], indent) if key == "projects" else render(raw[key], tag, indent)
        s = s[:m.end()] + inner + s[end:]
        used.add(key)
        pos = m.end() + len(inner)

    def attrs(m):
        tag = m.group(0)
        for attr, key in re.findall(r'\sdata-t-([\w-]+)="([^"]+)"', tag):
            if key not in strings:
                sys.exit("%s: data-t-%s=\"%s\" isn't in its content file" % (page, attr, key))
            val = 'data-t-%s="%s"' % (attr, key)
            new = '%s="%s"' % (attr, html.escape(strings[key]))
            if re.search(r'\s%s="[^"]*"' % re.escape(attr), tag):
                tag = re.sub(r'(\s)%s="[^"]*"' % re.escape(attr), lambda _: " " + new, tag, count=1)
            else:
                tag = tag.replace(val, new + " " + val, 1)
            used.add(key)
        return tag

    s = re.sub(r"<[a-zA-Z][^>]*\sdata-t-[\w-]+=\"[^\"]+\"[^>]*>", attrs, s)
    path.write_text(s, encoding="utf-8")
    return used


def write_js(name, table):
    out = SITE / "strings" / (name + ".js")
    out.parent.mkdir(exist_ok=True)
    out.write_text(
        "// Made by tools/build_content.py from content/%s.toml: edit the text there, not here.\n"
        "const S = %s;\n"
        "export default S;\n"
        "// Fills in the {names} in a string: fill(S.some.key, { name: value }).\n"
        "export const fill = (s, vars = {}) => s.replace(/\\{(\\w+)\\}/g, (m, k) => (k in vars ? String(vars[k]) : m));\n"
        % (name, json.dumps(table, ensure_ascii=False, indent=1)),
        encoding="utf-8",
    )


# python3 tools/build_content.py [PAGE ...] only does those (shared = the pages that have no file of their own).
only = set(sys.argv[1:])
unknown = only - set(PAGES) - {"shared"}
if unknown:
    sys.exit("no such page: %s (pages: shared, %s)" % (", ".join(sorted(unknown)), ", ".join(PAGES)))
shared = load("shared")
shared_flat = flat(shared)
if not only or "shared" in only:
    write_js("shared", shared)
for name, pages in PAGES.items():
    if (only and name not in only) or not (CONTENT / (name + ".toml")).exists():
        continue
    table = load(name)
    write_js(name, table)
    own = flat(table)
    clash = set(own) & set(shared_flat)
    if clash:
        sys.exit("content/%s.toml and content/shared.toml both have %s" % (name, ", ".join(sorted(clash))))
    for page in pages:
        fill_page(page, {k: v for k, v in {**shared_flat, **own}.items() if isinstance(v, str)}, {**shared_flat, **own})
if not only or "shared" in only:
    for page in ALL_PAGES:
        if not any(page in pages for pages in PAGES.values()):
            fill_page(page, {k: v for k, v in shared_flat.items() if isinstance(v, str)}, shared_flat)
print("text from content/ written into site/")
