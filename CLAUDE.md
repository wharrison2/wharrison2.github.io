# Personal site

A static site in `site/`, deployed to GitHub Pages from `main` by `.github/workflows/pages.yml`. The workflow runs
`python3 tools/build_content.py` and then publishes `site/`. To serve it locally:
`python3 -m http.server 8000 --directory site`.

## Working here

- **Subagents for coding without much taste.** Give subagents the coding tasks that don't need much taste: ports
  from another language, test harnesses, data processing, mechanical refactors, wiring a page up to an agreed design.
  Run independent pieces in parallel.
  - Keep the taste calls in the main session: what goes on the site, layout and visual design, page wording, and what
    to cut.
  - Keep the shared files for the main session as well, and do the integration after: `tools/build_content.py`
    (`PAGES`), `content/shared.toml`, `content/home.toml` (the Projects list) and the menus.
  - Give each subagent its own folder, its own headless Chrome port and profile, and tell it not to commit.
- **Page text** lives in `content/*.toml`, one file per page. See `.claude/skills/page-text/SKILL.md`.
- **Never take screenshots.** Check pages with headless Chrome `--dump-dom` or the DevTools protocol, or ask the user
  to look.
- **Don't commit or push** unless asked.
- **Don't publish private data.** The keystroke data from the transcription study must never be published: only model
  weights and aggregate stats.
- **QR codes** (`site/qr/`) is reachable only by its direct link. Don't link it from other pages, and don't add more
  utility pages like it.
