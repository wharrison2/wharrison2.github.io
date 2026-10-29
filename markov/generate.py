#!/usr/bin/env python3
"""Word-level Markov chain text generator trained on .txt files in ./corpus.

Usage:
    python3 markov/generate.py "Starting text here"
    python3 markov/generate.py                      # interactive mode
    python3 markov/generate.py "The" --length 80 --order 3 --seed 42
"""

import argparse
import difflib
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

CORPUS_DIR = Path(__file__).parent / "corpus"

# How much each folder counts relative to the others; unlisted folders get weight 1.
FOLDER_WEIGHTS = {
    "school_writing/stanford": 3,
    "school_writing/high_school": 2,
    "ea_lw_stuff": 3,
    "college_essays": 3,
    "transcripts": 0.5,
}

# Once the last this-many words appear verbatim in one document, look back one fewer word to break the quote.
QUOTE_STREAK = 7

# As a sentence runs long, words ending in a period get a growing weight multiplier.
# Each (words, step) entry means: once the sentence is past this many words, add step per extra word.
# So 12 words -> 1.2x, 13 -> 1.4x, ... 18 -> 2.4x, 19 -> 2.9x, ... 24 -> 5.4x, 25 -> 6.4x, ...
PERIOD_RAMP = [(11, 0.2), (18, 0.5), (24, 1.0)]
# How similar (0-1) an unknown prompt word must be to a corpus word to count as a typo of it.
TYPO_CUTOFF = 0.8

CLOSERS = "\"'”’)]"  # closing quotes/brackets allowed after the final punctuation


def weight_for(relative_path):
    for folder, weight in FOLDER_WEIGHTS.items():
        if relative_path.as_posix().startswith(folder + "/"):
            return weight
    return 1


def load_corpus(corpus_dir):
    files = sorted(f for f in corpus_dir.glob("**/*.txt") if f.is_file())
    if not files:
        sys.exit(f"No .txt files found in {corpus_dir}. Add some of your writing there first.")
    # Each file is tokenized separately so chains don't run across file boundaries.
    return [(f.read_text(encoding="utf-8", errors="ignore").split(), weight_for(f.relative_to(corpus_dir)))
            for f in files]


def build_model(documents, max_order):
    """Map each context (a tuple of 1..max_order lowercased words) to weighted counts of the words that followed it."""
    model = defaultdict(Counter)
    for words, weight in documents:
        for i in range(1, len(words)):
            for n in range(1, max_order + 1):
                if i - n < 0:
                    break
                context = tuple(w.lower() for w in words[i - n:i])
                model[context][words[i]] += weight
    return model


def build_quote_index(documents, n):
    """Every run of n consecutive lowercased words found within a single document."""
    return {tuple(w.lower() for w in words[i:i + n])
            for words, _ in documents for i in range(len(words) - n + 1)}


def ends_sentence(word):
    return word.rstrip(CLOSERS).endswith((".", "!", "?"))


def period_boost(sentence_words):
    """Weight multiplier for period-ending words when the sentence is this many words long."""
    boost = 1.0
    for i, (start, step) in enumerate(PERIOD_RAMP):
        end = PERIOD_RAMP[i + 1][0] if i + 1 < len(PERIOD_RAMP) else sentence_words
        boost += step * max(0, min(sentence_words, end) - start)
    return boost


def sample(followers, rng, boost=1.0):
    weights = [weight * boost if word.rstrip(CLOSERS).endswith(".") else weight
               for word, weight in followers.items()]
    return rng.choices(list(followers), weights=weights)[0]


def correct(word, model, vocab):
    """Return the most similarly spelled word we've seen (e.g. fixing a typo), or the word itself."""
    if (word.lower(),) in model:
        return word
    match = difflib.get_close_matches(word.lower(), vocab, n=1, cutoff=TYPO_CUTOFF)
    return match[0] if match else word


def next_word(model, history, max_order, rng, boost=1.0):
    """Pick the next word using the longest context we've seen, backing off to shorter ones."""
    for n in range(min(max_order, len(history)), 0, -1):
        context = tuple(w.lower() for w in history[-n:])
        if context in model:
            return sample(model[context], rng, boost)
    return None


def generate(model, prompt, length, max_order, rng, word_weights, vocab, quotes):
    # Generate as if the prompt's unseen words were spelled like their closest matches in the corpus.
    history = [correct(w, model, vocab) for w in prompt.split()]
    # The last word is one we've never seen, with no close spelling either: give up rather than guess.
    if history and (history[-1].lower(),) not in model:
        return None
    output = []
    # Words in the current sentence so far, counting any unfinished sentence at the end of the prompt.
    sentence_words = next((i for i, w in enumerate(reversed(history)) if ends_sentence(w)), len(history))
    for _ in range(length):
        quoting = len(history) >= QUOTE_STREAK and tuple(w.lower() for w in history[-QUOTE_STREAK:]) in quotes
        boost = period_boost(sentence_words)
        word = next_word(model, history, max(1, max_order - 1) if quoting else max_order, rng, boost)
        if word is None:
            # Dead end (or prompt words never seen): jump to a random word from the corpus.
            word = sample(word_weights, rng, boost)
        output.append(word)
        history.append(word)
        sentence_words = 0 if ends_sentence(word) else sentence_words + 1
    return " ".join(output)


def show(prompt, text):
    print("I'm not sure where to go with this." if text is None else f"{prompt} {text}")


def main():
    parser = argparse.ArgumentParser(description="Continue text in the style of your writing.")
    parser.add_argument("prompt", nargs="*", help="starting text (omit for interactive mode)")
    parser.add_argument("-n", "--length", type=int, default=50, help="number of words to generate (default 50)")
    parser.add_argument("-o", "--order", type=int, default=2,
                        help="how many previous words to condition on (default 2; higher = closer to your original text)")
    parser.add_argument("-s", "--seed", type=int, help="random seed for reproducible output")
    parser.add_argument("--corpus", type=Path, default=CORPUS_DIR, help="folder of .txt files")
    args = parser.parse_args()

    documents = load_corpus(args.corpus)
    word_weights = Counter()
    for words, weight in documents:
        for w in words:
            word_weights[w] += weight
    if not word_weights:
        sys.exit("Corpus files are empty.")
    model = build_model(documents, args.order)
    vocab = [context[0] for context in model if len(context) == 1]
    quotes = build_quote_index(documents, QUOTE_STREAK)
    rng = random.Random(args.seed)

    if args.prompt:
        prompt = " ".join(args.prompt)
        show(prompt, generate(model, prompt, args.length, args.order, rng, word_weights, vocab, quotes))
        return

    print(f"Loaded {len(documents)} file(s), {sum(len(words) for words, _ in documents):,} words. Type a prompt (Ctrl-D to quit).")
    while True:
        try:
            prompt = input("\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if prompt:
            show(prompt, generate(model, prompt, args.length, args.order, rng, word_weights, vocab, quotes))


if __name__ == "__main__":
    main()
