---
name: page-text
description: How the site's visible text is kept in content/*.toml (one file per page) and written into the pages by tools/build_content.py. Use when moving a page's hard-coded text into its content file, adding text to a page, or changing how text gets into the HTML or scripts.
---

# Page text

Every piece of text a visitor reads lives in one file per page in `content/`, with a short `#` comment above each
string saying what it is. `tools/build_content.py` writes it into the pages; the Pages workflow runs it on every deploy.

| File | Pages |
|---|---|
| `content/shared.toml` | Name, menu, footer and the pop-ups (mode question, mugging, paperclips), on every page. Also the only text for the post pages and `post.html`. |
| `content/home.toml` | `site/index.html` and the home terminal (`site/shared/siteterm.js`) |
| `content/markov.toml` | `site/markov/` (`index.html`, `markov-page.js`, `eval-ui.js`) |
| `content/qr.toml` | `site/qr/` |
| `content/transcription.toml` | `site/transcription/` (the worked example: copy its patterns) |

A post's own article (headings, paragraphs, notes) stays in its HTML file; only the shared bits around it come from
`shared.toml`. The eval puzzle's simulated files and shell output (`site/eval/`) are game data, not page text: leave them.

## How text gets in

- **HTML contents**: put `data-t="section.key"` on the element. The build replaces everything inside it with the string.
  A string with blank lines becomes `<p>` paragraphs (use it on a `div` or `section`); otherwise it's one line.
  `*italic*`, `**bold**`, `` `code` ``, `[text](url)` work. `{name}` becomes `<span id="name"></span>` for the page's
  script to fill. An empty string shows placeholder text.
- **Attributes**: `data-t-placeholder="key"`, `data-t-aria-label="key"`, `data-t-title="key"`, `data-t-alt="key"` set
  that attribute.
- **Scripts**: every string is also in the generated `site/strings/PAGE.js`:
  `import T, { fill } from "../strings/PAGE.js";` then `T.section.key`, and `fill(T.section.key, { n: 3 })` for `{n}`.
  Never hand-edit `site/strings/`. Text a script puts into `innerHTML` must be escaped first (it's plain text).
  A classic (non-module) script can't import; if one needs text, make it read a `data-` attribute the HTML carries,
  or leave it and say so.
- A page file may not reuse a key that's in `shared.toml`; the build stops if it does.
- Lists of things (questions, passages, projects) are TOML arrays or `[[tables]]`; the scripts loop over them.
- `projects` in `home.toml` is special: an array of `{ name, link, about }` the build renders as the Projects list.

## The content file

```toml
# Text for <page> (<path>/). After editing, run: python3 tools/build_content.py

[section]
# What this string is, where it shows, in a few words
key = "The text"
```

Group by part of the page, in page order. Comments say where the string appears, not what it says. Keys are short
lowercase words. Long text goes in `"""` strings.

## Moving a page's text

1. Snapshot the page first (if no snapshot was handed to you): `cp -R site /path/to/scratch/site_before`.
2. Find every visible string: the HTML (headings, buttons, labels, `title`, `placeholder`, `aria-label`, `alt`) and
   the page's scripts (`textContent`, `innerHTML`, template literals, messages, arrays of text). Skip CSS, class names,
   URLs, storage keys, event names and anything a visitor never reads.
3. Write `content/PAGE.toml`. Copy strings exactly; generate long ones with a script rather than retyping.
4. Mark up the HTML with `data-t` / `data-t-ATTR`, leaving the elements empty. Change the scripts to use `T` and `fill`.
5. Build only your page: `python3 tools/build_content.py PAGE` (several agents may be building other pages at once;
   `shared` does only the pages with no file of their own). Run it twice: the second run must change nothing.
6. Check:
   - `node --check` each changed script (copy it to a `.mjs` path first if it's a module).
   - `python3 .claude/skills/page-text/textdiff.py SNAPSHOT/page.html site/page.html`: the text must match, except
     spots the script fills in at load.
   - Load the page in headless Chrome and read the DOM (never take screenshots):
     `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu
     --user-data-dir=$(mktemp -d) --virtual-time-budget=3000 --dump-dom "http://localhost:8000/PAGE/?mode=fun"`
     The site is served at http://localhost:8000 from `site/`. Check script-made text appears. Exercise interactive
     bits through the Chrome DevTools protocol if needed, on your own `--remote-debugging-port`.
7. Don't commit or push.
