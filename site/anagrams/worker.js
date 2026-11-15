// Runs the anagram search off the page's thread and sends results back in batches.
// The page starts a fresh worker for each search and ends the old one, which is how a search is stopped.
// Messages in: { text, phrase, options, cap } (text: the word list, one per line). Messages out:
//   { type: "depth", n }  starting on n-word anagrams      { type: "found", items }  a batch of anagrams
//   { type: "done", capped }  finished (capped: there were more than `cap`)   { type: "no-fit" }  the must-include words don't fit
//
// When there are lots of anagrams, most of them are small changes to each other ("a b listen", "a b silent", ...).
// So an anagram that shares two or more words with one already sent is held back, and the search goes on looking
// for ones that don't. Held-back ones are sent at the end, while there's room under `cap`. The must-include words
// are in every anagram, so they don't count towards sharing.
import { anagrams, counts, clean, includeWords } from "./search.js";

const LOOK = 100; // stop once it has looked at this many times `cap` anagrams, and fill up with held-back ones

onmessage = ({ data: { text, phrase, options, cap } }) => {
  const have = counts(clean(phrase)), need = counts(clean(options.include));
  if (need.some((n, i) => n > have[i])) return postMessage({ type: "no-fit" });
  const words = text.split("\n").filter(Boolean);
  const fixed = includeWords(options.include);
  let batch = [], last = performance.now(), sent = 0, seen = 0, full = false;
  const held = [], pairs = new Set();
  const flush = () => {
    if (batch.length) postMessage({ type: "found", items: batch });
    batch = [];
    last = performance.now();
  };
  // The anagram's pairs of words, leaving out the must-include ones.
  const pairsOf = (a) => {
    const own = a.slice();
    for (const w of fixed) own.splice(own.indexOf(w), 1);
    const out = [];
    for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) out.push(own[i] + " " + own[j]);
    return out;
  };
  const results = anagrams(phrase, words, {
    ...options,
    onDepth: (n) => { flush(); postMessage({ type: "depth", n }); },
  });
  for (const a of results) {
    if (++seen > LOOK * cap) { full = true; break; }
    const ps = pairsOf(a);
    if (ps.some((p) => pairs.has(p))) {
      if (held.length < cap) held.push(a);
      continue;
    }
    for (const p of ps) pairs.add(p);
    batch.push(a);
    if (++sent >= cap) { full = true; break; }
    if (batch.length >= 200 || performance.now() - last > 60) flush();
  }
  flush();
  // Held-back ones, while there's room.
  while (held.length && sent < cap) {
    batch = held.splice(0, Math.min(500, cap - sent));
    sent += batch.length;
    flush();
  }
  postMessage({ type: "done", capped: full || held.length > 0 });
};
