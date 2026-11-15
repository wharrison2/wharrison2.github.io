// Profanity filter for prompts. The word list lives in the obscenity library
// (https://github.com/jo3-l/obscenity), loaded from a CDN, so this repo doesn't contain it.
// It already handles capitals, accents, leetspeak, stretched letters and innocent words that contain bad ones.
import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "https://cdn.jsdelivr.net/npm/obscenity@0.4.6/+esm";

// Ordinary words the library would otherwise flag. The anagram dictionary (tools/anagram_words.mjs) uses this list too.
const ALLOWED = [
  "sex", "shiitake", "retardant", "analcime", "analcite", "analecta", "analectic", "analects", "analemma",
  "analepsis", "analepsy", "analeptic", "analgen", "analgene", "analgesia", "anallagmatic", "anallantoic",
  "anallantoidea", "annal", "annalist", "annalistic", "annalize", "annals", "assecuration", "assecure", "assecution",
  "assegai", "assober", "assonance", "assonant", "assonantal", "assonate", "assort", "assorted", "assortment",
  "asswage", "assyrian", "assyriological", "assyriologist", "assyriology", "assythment", "bipennis", "cockpit",
  "cockscomb", "cockspur", "cocksure", "cockswain", "cumacea", "cumene", "cumfrey", "cumic", "cumidine", "cumin",
  "cuminic", "cuminil", "cuminol", "cummerbund", "cummin", "cumquat", "danalite", "dickcissel", "dicker",
  "epanalepsis", "eridanus", "evaginate", "evagination", "fanal", "feckless", "fecklessness", "invaginate",
  "invaginated", "invagination", "oceanus", "olecranal", "orgyia", "pandanus", "pannus", "philostorgy", "platanus",
  "ranal", "rapped", "rappee", "rappel", "retardation", "retardative", "retarder", "retardment", "sesquitertianal",
  "tabanus", "trafficker", "turdiformes", "turdus", "tympanal", "vandyke", "varanus"
];

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
