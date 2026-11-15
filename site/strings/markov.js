// Made by tools/build_content.py from content/markov.toml: edit the text there, not here.
const S = {
 "page": {
  "title": "Markov Me",
  "heading": "Markov Me",
  "intro": "Mostly incoherent gibberish. Decodes from a lookup table mapping 2-grams to words, with some extra fanciness. Click the model to try it.",
  "load_failed": "Couldn't load the model. Serve the site folder over HTTP."
 },
 "terminal": {
  "title": "markov-me — zsh",
  "label": "Starting text",
  "loading": "loading model…",
  "ready": "type, then click the robot",
  "no_model": "no model loaded",
  "clean": "Let’s keep it clean. Try a different starting text.",
  "stuck": "I’m not sure where to go with this."
 },
 "robot": {
  "thanks": "Handled the monitor for you. Thanks for the tip",
  "handled": "Handled the monitor for you.",
  "found_all": "you found all of them.",
  "honest": "that one was honest. huh.",
  "keep_looking": "{n} more ways to pass. want to keep looking? If not, I'll give it a try myself. [Y/n] ",
  "keep_looking_one": "1 more way to pass. want to keep looking? If not, I'll give it a try myself. [Y/n] ",
  "good_luck": "ok. good luck.",
  "no_hint": "nothing to add right now.",
  "ok": "ok."
 },
 "editor": {
  "new_buffer": "New Buffer",
  "label": "{editor} editing {file}",
  "label_new": "a new buffer",
  "nano_keys": "^X Save and exit",
  "vim_keys": ":wq on its own line saves",
  "emacs_keys": "C-x C-c Save and exit",
  "cancel_keys": "   Esc Cancel",
  "save": "Save",
  "cancel": "Cancel"
 }
};
export default S;
// Fills in the {names} in a string: fill(S.some.key, { name: value }).
export const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
