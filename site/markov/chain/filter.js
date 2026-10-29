// Profanity filter for prompts. The word list lives in the obscenity library
// (https://github.com/jo3-l/obscenity), loaded from a CDN, so this repo doesn't contain it.
// It already handles capitals, accents, leetspeak, stretched letters and innocent words that contain bad ones.
import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "https://cdn.jsdelivr.net/npm/obscenity@0.4.6/+esm";

// Ordinary words the library would otherwise flag.
const ALLOWED = ["sex", "shiitake", "retardant"];

const dataset = englishDataset.build();
const matcher = new RegExpMatcher({
  ...dataset,
  ...englishRecommendedTransformers,
  whitelistedTerms: [...dataset.whitelistedTerms, ...ALLOWED],
});

// "d a m n" / "d.a.m.n" -> "damn": join runs of single letters, which the library doesn't do.
const joinSpelled = (text) =>
  text.replace(/\b[a-z](?:[\s.\-_*]+[a-z]\b)+/gi, (run) => run.replace(/[^a-z]/gi, ""));

export function isProfane(text) {
  return matcher.hasMatch(text) || matcher.hasMatch(joinSpelled(text));
}
