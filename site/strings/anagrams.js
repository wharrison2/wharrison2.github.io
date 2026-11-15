// Made by tools/build_content.py from content/anagrams.toml: edit the text there, not here.
const S = {
 "page": {
  "title": "Anagrams",
  "heading": "Anagrams",
  "intro": "Type a word or phrase and see (some of) its anagrams."
 },
 "search": {
  "phrase": "Word or phrase",
  "placeholder": "Type something to rearrange",
  "example": "dormitory",
  "max_words": "Most words",
  "any": "Any number",
  "min_length": "Shortest word",
  "letters": "{n} letters",
  "one_letter": "1 letter",
  "include": "Must include",
  "include_placeholder": "Optional words",
  "stop": "Stop"
 },
 "status": {
  "loading": "Loading the word list…",
  "load_failed": "Couldn't load the word list. Try reloading the page.",
  "empty": "Type a word or phrase.",
  "searching": "Looking for {n}-word anagrams… {found} so far",
  "searching_one": "Looking for one-word anagrams… {found} so far",
  "done": "{found} anagrams.",
  "done_one": "1 anagram.",
  "none": "No anagrams with these settings.",
  "capped": "Showing {found}, leaving out most that share two words with one already shown. Use fewer words, longer words or a word to include to narrow it down.",
  "stopped": "Stopped at {found}.",
  "no_fit": "The phrase doesn't have the letters for “{words}”."
 },
 "results": {
  "words": "{n} words",
  "one_word": "1 word"
 },
 "about": {
  "heading": "About",
  "body": "A port of [a C++ anagram finder](https://github.com/wharrison2/anagrams) I wrote. It filters for words that can be spelled from the phrase, groups them by letter count, then searches for groups that add to precisely your letters.\n\nThe dictionary has about 95,000 English words, including plenty of obscure ones, with rude words taken out.\n"
 }
};
export default S;
// Fills in the {names} in a string: fill(S.some.key, { name: value }).
export const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
