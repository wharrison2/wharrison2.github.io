// Makes the anagram finder's dictionary, site/anagrams/words.txt, from the word list in wharrison2/anagrams.
//
//   npm install --prefix /some/dir obscenity@0.4.6
//   OBSCENITY_DIR=/some/dir node tools/anagram_words.mjs path/to/filtered_words.txt
//
// Keeps lowercase a-z words, sorted and without repeats, and drops every word the Markov page's profanity filter
// (site/markov/chain/filter.js) flags on its own: the same obscenity matcher, English dataset, recommended
// transformers and allowed words. The allowed words are read from filter.js, so the two stay in step.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [source] = process.argv.slice(2);
if (!source) {
  console.error("usage: OBSCENITY_DIR=dir node tools/anagram_words.mjs path/to/filtered_words.txt");
  process.exit(1);
}

const require = createRequire(path.join(path.resolve(process.env.OBSCENITY_DIR || ROOT), "node_modules", "x.js"));
const { RegExpMatcher, englishDataset, englishRecommendedTransformers } = require("obscenity");

const filterJs = readFileSync(path.join(ROOT, "site/markov/chain/filter.js"), "utf8");
if (!filterJs.includes("obscenity@0.4.6")) throw new Error("filter.js no longer uses obscenity@0.4.6: update this script");
const allowedSrc = filterJs.match(/const ALLOWED = (\[[^\]]*\]);/);
if (!allowedSrc) throw new Error("couldn't find ALLOWED in filter.js");
const ALLOWED = JSON.parse(allowedSrc[1]);

const dataset = englishDataset.build();
const matcher = new RegExpMatcher({
  ...dataset,
  ...englishRecommendedTransformers,
  whitelistedTerms: [...dataset.whitelistedTerms, ...ALLOWED],
});
// Same as filter.js (a lone word has no spelled-out letters to join, but keep it identical).
const joinSpelled = (text) => text.replace(/\b[a-z](?:[\s.\-_*]+[a-z]\b)+/gi, (run) => run.replace(/[^a-z]/gi, ""));
const isProfane = (text) => matcher.hasMatch(text) || matcher.hasMatch(joinSpelled(text));

const words = [...new Set(readFileSync(source, "utf8").split(/\r?\n/).map((w) => w.trim().toLowerCase()))]
  .filter((w) => /^[a-z]+$/.test(w))
  .sort();
const kept = [], dropped = [];
for (const w of words) (isProfane(w) ? dropped : kept).push(w);

writeFileSync(path.join(ROOT, "site/anagrams/words.txt"), kept.join("\n") + "\n");
writeFileSync(path.join(process.env.OBSCENITY_DIR || ".", "dropped_words.txt"), dropped.join("\n") + "\n");
console.log(`${words.length} words in, ${kept.length} kept, ${dropped.length} dropped (listed in ${path.join(process.env.OBSCENITY_DIR || ".", "dropped_words.txt")})`);
