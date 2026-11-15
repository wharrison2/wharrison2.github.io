"""Compare the visible text of two HTML files: python3 textdiff.py BEFORE.html AFTER.html

Prints "text same" / "attrs same" when a page reads the same as before (placeholder, aria-label, title and alt
attributes included), or the sentences that differ.
"""
import difflib, html, re, sys


def text(path):
    s = open(path, encoding="utf-8").read()
    s = re.sub(r"<script.*?</script>|<style.*?</style>", " ", s, flags=re.S)
    attrs = re.findall(r'\s(?:placeholder|aria-label|title|alt)="([^"]*)"', s)
    s = re.sub(r"<[^>]+>", " ", s)
    return " ".join(html.unescape(s).split()), sorted(html.unescape(a) for a in attrs)


(a, a_attrs), (b, b_attrs) = text(sys.argv[1]), text(sys.argv[2])
print("text same" if a == b else "TEXT DIFFERS")
print("attrs same" if a_attrs == b_attrs else "ATTRS DIFFER:\n  before %s\n  after  %s" % (a_attrs, b_attrs))
if a != b:
    for d in difflib.ndiff(a.split(". "), b.split(". ")):
        if d[0] in "+-":
            print(d[:240])
