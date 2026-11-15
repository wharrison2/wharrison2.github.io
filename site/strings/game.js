// Made by tools/build_content.py from content/game.toml: edit the text there, not here.
const S = {
 "page": {
  "title": "Alignment game",
  "heading": "Alignment game",
  "intro": "Run an AI lab racing rivals to the frontier: train models, ship them, fund safety work and lobby on policy, while the misalignment you can't see piles up. This is a draft, running entirely in your browser. The full version, also a draft, is at [alignmentgame.net](https://alignmentgame.net).",
  "open_full": "Open full window",
  "frame_label": "The game"
 },
 "about": {
  "heading": "About",
  "body": "The game is an argument, made through mechanics, that AI alignment isn't necessarily easy. Misalignment is the default outcome of ordinary training, and the dangerous kinds get harder to see as models get more capable. The fixes that work early turn cosmetic later. Going slow hands the frontier to a less careful rival, which is why regulation matters.\n\nEach turn is a quarter of a year. Rival labs play by their own strategies, and when the game ends a post-mortem shows what was really going on inside your models and which of your decisions caused what.\n\nThe engine is plain Python, running here in [Pyodide](https://pyodide.org) (Python compiled to WebAssembly), so the first load takes a few seconds. Multiplayer needs a server, so it's left out of this copy.\n\n[Code on GitHub](https://github.com/wharrison2/alignment_game)\n"
 }
};
export default S;
// Fills in the {names} in a string: fill(S.some.key, { name: value }).
export const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
