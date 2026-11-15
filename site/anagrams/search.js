// The anagram search, a JavaScript port of anagramFinder.cpp from github.com/wharrison2/anagrams.
// An anagram of a phrase is a set of dictionary words that together use exactly its letters. Like the C++:
//   1. keep the words whose letters fit inside the phrase, grouped by their letter counts ("codes");
//   2. find every multiset of codes that adds up to the phrase's code, taking codes in a fixed order so each
//      multiset is found once;
//   3. turn each one into words (every choice of a word per code), without repeats.
// Unlike the C++, it searches one word count at a time (all one-word anagrams, then two-word ones, ...), tries
// longer words first, and skips codes that can't fill what's left, so results come out a few at a time instead of
// all at the end. It's a plain module, so the worker and the tests share it.

const A = 97;

// Letter counts of a word, as an array of 26.
export function counts(word) {
  const c = new Array(26).fill(0);
  for (let i = 0; i < word.length; i++) c[word.charCodeAt(i) - A]++;
  return c;
}

// A code's key: its letters in order ("listen" -> "eilnst").
const keyOf = (c) => {
  let s = "";
  for (let i = 0; i < 26; i++) if (c[i]) s += String.fromCharCode(A + i).repeat(c[i]);
  return s;
};

// Lowercase letters only: "William Harrison!" -> "williamharrison".
export const clean = (text) => text.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");

// Every choice of k words from `list`, each choice in list order, repeats allowed (k = how often a code repeats).
function* choose(list, k, start = 0) {
  if (k === 0) { yield []; return; }
  for (let i = start; i < list.length; i++) for (const rest of choose(list, k - 1, i)) yield [list[i], ...rest];
}

/**
 * Finds anagrams of `phrase` among `words` (an array of lowercase a-z words).
 * Options: maxWords (default Infinity), minLength (shortest word to use, default 1), include (a word or words that
 * must be in every anagram; they're taken out of the phrase first and added back to each result).
 * Calls onDepth(n) before searching n-word anagrams and yields each anagram as an array of words, longest first.
 * Returns null if `include` doesn't fit inside the phrase.
 */
export function* anagrams(phrase, words, { maxWords = Infinity, minLength = 1, include = "", onDepth } = {}) {
  const target = counts(clean(phrase));
  const fixed = include.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z]+/).filter(Boolean);
  for (const w of fixed) {
    const c = counts(w);
    for (let i = 0; i < 26; i++) {
      target[i] -= c[i];
      if (target[i] < 0) return null;
    }
  }
  const total = target.reduce((a, b) => a + b, 0);
  if (total === 0) {
    if (fixed.length) yield fixed.slice();
    return;
  }

  // Step 1: the words that fit, grouped by code.
  const groups = new Map();
  for (const w of words) {
    if (w.length < minLength || w.length > total) continue;
    const c = counts(w);
    let fits = true;
    for (let i = 0; i < 26; i++) if (c[i] > target[i]) { fits = false; break; }
    if (!fits) continue;
    const k = keyOf(c);
    if (groups.has(k)) groups.get(k).words.push(w);
    else groups.set(k, { key: k, len: w.length, c, letters: c.flatMap((n, i) => (n ? [i] : [])), words: [w] });
  }
  // Longest codes first, so within a word count the anagrams with the longest words come first.
  const codes = [...groups.values()].sort((a, b) => b.len - a.len || (a.key < b.key ? -1 : 1));
  codes.forEach((g, i) => (g.index = i));
  const remaining = target.slice();

  // Step 2, n codes at a time: codes from index `from` on that fit, filling `left` letters with `slots` codes.
  function* fill(from, left, slots, path) {
    if (slots === 1) {
      const g = groups.get(keyOf(remaining)); // the last code is whatever's left, if it's a word
      if (g && g.index >= from) yield [...path, g];
      return;
    }
    for (let i = from; i < codes.length; i++) {
      const g = codes[i];
      if (g.len * slots < left) return; // codes only get shorter from here, so they can't fill it
      if (left - g.len < slots - 1) continue; // has to leave a letter for each word still to come
      let fits = true;
      for (const l of g.letters) if (g.c[l] > remaining[l]) { fits = false; break; }
      if (!fits) continue;
      for (const l of g.letters) remaining[l] -= g.c[l];
      yield* fill(i, left - g.len, slots - 1, [...path, g]);
      for (const l of g.letters) remaining[l] += g.c[l];
    }
  }

  const deepest = Math.min(maxWords - fixed.length, total);
  for (let n = 1; n <= deepest; n++) {
    if (onDepth) onDepth(n + fixed.length);
    for (const path of fill(0, total, n, [])) {
      // Step 3: words for the codes. A code used k times takes k words in list order, so no anagram repeats.
      const runs = [];
      for (const g of path) {
        if (runs.length && runs[runs.length - 1].g === g) runs[runs.length - 1].k++;
        else runs.push({ g, k: 1 });
      }
      yield* expand(runs, 0, []);
    }
  }

  function* expand(runs, r, chosen) {
    if (r === runs.length) {
      yield [...chosen, ...fixed].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
      return;
    }
    for (const pick of choose(runs[r].g.words, runs[r].k)) yield* expand(runs, r + 1, [...chosen, ...pick]);
  }
}
