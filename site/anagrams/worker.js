// Runs the anagram search off the page's thread and sends results back in batches.
// The page starts a fresh worker for each search and ends the old one, which is how a search is stopped.
// Messages in: { text, phrase, options } (text: the word list, one per line). Messages out:
//   { type: "depth", n }  starting on n-word anagrams      { type: "found", items }  a batch of anagrams
//   { type: "done", capped }  finished (capped: it hit `cap`)   { type: "no-fit" }  the must-include words don't fit
import { anagrams, counts, clean } from "./search.js";

onmessage = ({ data: { text, phrase, options, cap } }) => {
  const have = counts(clean(phrase)), need = counts(clean(options.include));
  if (need.some((n, i) => n > have[i])) return postMessage({ type: "no-fit" });
  const words = text.split("\n").filter(Boolean);
  let batch = [], last = performance.now(), found = 0;
  const flush = () => {
    if (batch.length) postMessage({ type: "found", items: batch });
    batch = [];
    last = performance.now();
  };
  const results = anagrams(phrase, words, {
    ...options,
    onDepth: (n) => { flush(); postMessage({ type: "depth", n }); },
  });
  for (const a of results) {
    batch.push(a);
    if (++found >= cap) break;
    if (batch.length >= 200 || performance.now() - last > 60) flush();
  }
  flush();
  postMessage({ type: "done", capped: found >= cap });
};
