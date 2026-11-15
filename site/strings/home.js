// Made by tools/build_content.py from content/home.toml: edit the text there, not here.
const S = {
 "intro": "",
 "page": {
  "title": "William Harrison"
 },
 "headings": {
  "writing": "Writing",
  "projects": "Projects"
 },
 "posts": {
  "astra": {
   "title": "OpenAI's Astra alignment claims are dubious and there is good evidence it is misaligned",
   "date": "Sep 2026"
  },
  "vegan": {
   "title": "EAs Should be Vegan, for EA reasons",
   "date": "Jul 2026"
  },
  "doom": {
   "title": "Technical AI Safety Research Plausibly Increases P(doom) Absent Vastly More Advocacy",
   "date": "Apr 2026"
  },
  "scope": {
   "title": "Scope and Sensitivity",
   "date": "Apr 2026"
  }
 },
 "terminal": {
  "last_login": "Last login: {date} on ttys001",
  "welcome": "Welcome. This is {name}'s site. Type help, or click a name below.",
  "help": [
   [
    "ls [-l] [dir]",
    "list what's here"
   ],
   [
    "cd <dir>",
    "go into a folder (cd .. to go back)"
   ],
   [
    "cat <file>",
    "read a file or a post, here in the terminal"
   ],
   [
    "open <file>",
    "go to the real page for a post or project"
   ],
   [
    "tree",
    "everything at once"
   ],
   [
    "pwd, whoami, clear, history",
    ""
   ],
   [
    "exit",
    "the normal view of the site"
   ]
  ],
  "help_hint": "Tab completes names; ↑ and ↓ go through what you've typed. You can also click a name.",
  "reading": "reading {file} …",
  "open_hint": "open {file}  to read it on its own page",
  "open_project": "open {name}  →  {href}",
  "opening": "opening {path} …",
  "logout": "logout",
  "image": "[image]",
  "notes": "Notes",
  "input_label": "Command",
  "view_label": "View",
  "normal_view": "Normal view",
  "terminal_view": "Terminal view",
  "errors": {
   "ls_missing": "ls: {arg}: No such file or directory",
   "cd_file": "cd: not a directory: {arg}",
   "cd_missing": "cd: no such file or directory: {arg}",
   "cat_which": "cat: which file? (try ls)",
   "cat_missing": "cat: {arg}: No such file or directory",
   "cat_dir": "cat: {arg}: Is a directory",
   "cat_failed": "cat: {arg}: couldn't load it ({reason})",
   "open_what": "open: what should I open? (try open markov)",
   "open_nothing": "open: {arg}: nothing to open there",
   "sudo": "{user} is not in the sudoers file. This incident will be reported.",
   "permission": "zsh: permission denied: {cmd}  (try cat {cmd})",
   "not_found": "zsh: command not found: {cmd}  (try help)",
   "no_post": "no post on that page"
  }
 },
 "projects": [
  {
   "name": "Markov",
   "link": "markov/",
   "about": ""
  },
  {
   "name": "Transcription detector",
   "link": "transcription/",
   "about": "Type a few sentences and a model guesses, from your keystroke timing alone, whether you're writing your own words or copying someone else's. A class project, about 77% accurate."
  },
  {
   "name": "Alignment game",
   "link": "alignment-game/",
   "about": "A draft game about running an AI lab racing its rivals toward powerful AI, trading off revenue, safety research and the regulators. The full version, also a draft, is at [alignmentgame.net](https://alignmentgame.net)."
  },
  {
   "name": "SAR pair viewer",
   "link": "sar-viewer/",
   "about": "Two Sentinel-1 radar images of Weddell Sea ice, four days apart, overlaid or side by side."
  },
  {
   "name": "Block Blast solver",
   "link": "block-blast/",
   "about": "Draw your board and the three pieces you were dealt, and it finds the order and spots that clear the most squares."
  },
  {
   "name": "Anagram finder",
   "link": "anagrams/",
   "about": "Every way to rearrange a phrase into real words."
  }
 ]
};
export default S;
// Fills in the {names} in a string: fill(S.some.key, { name: value }).
export const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
