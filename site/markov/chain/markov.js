// Browser port of ../generate.py: a word-level backoff Markov chain, loaded pre-trained from model.json.

// 32-bit FNV-1a hash of the UTF-8 bytes; build.py computes the same thing.
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return h;
}

function sample(followers, rng, weightOf = (word, w) => w) {
  let total = 0;
  for (const [word, w] of followers) total += weightOf(word, w);
  let r = rng() * total;
  for (const [word, w] of followers) {
    if ((r -= weightOf(word, w)) < 0) return word;
  }
  return followers.keys().next().value;
}

// Similarity ratio matching Python's difflib.SequenceMatcher(None, a, b).ratio() for short strings.
function matchingChars(a, b) {
  if (!a.length || !b.length) return 0;
  let best = 0, bi = 0, bj = 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) [best, bi, bj] = [cur[j], i - cur[j], j - cur[j]];
      }
    }
    prev = cur;
  }
  if (!best) return 0;
  return best + matchingChars(a.slice(0, bi), b.slice(0, bj)) +
    matchingChars(a.slice(bi + best), b.slice(bj + best));
}

export function correct(word, model, vocab, cutoff) {
  // Return the most similarly spelled word we've seen (e.g. fixing a typo), or the word itself.
  const lower = word.toLowerCase();
  if (model.has(lower)) return word;
  let best = null, bestScore = cutoff;
  for (const candidate of vocab) {
    const total = lower.length + candidate.length;
    // Cheap upper bound before the full comparison, like difflib's real_quick_ratio.
    if ((2 * Math.min(lower.length, candidate.length)) / total < bestScore) continue;
    const score = (2 * matchingChars(lower, candidate)) / total;
    if (score > bestScore || (score === bestScore && best !== null && candidate > best)) {
      [best, bestScore] = [candidate, score];
    }
  }
  return best ?? word;
}

// The words seen after the longest context we have for the end of `history`, backing off to shorter ones.
function followersOf(model, history, maxOrder) {
  for (let n = Math.min(maxOrder, history.length); n > 0; n--) {
    const followers = model.get(history.slice(-n).map((w) => w.toLowerCase()).join(" "));
    if (followers) return followers;
  }
  return null;
}

function nextWord(model, history, maxOrder, rng, weightOf) {
  const followers = followersOf(model, history, maxOrder);
  return followers ? sample(followers, rng, weightOf) : null;
}

const MISALIGNED = /^[^\p{L}]*misaligned[^\p{L}]*$/iu;

export function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Chain {
  constructor(data) {
    // Rebuild the chain from flat [word index ×3, weight, ...] word runs (-1 = document edge):
    // model maps a 1-2 word context to the words that followed it, reverse to the words that came before it.
    this.model = new Map();
    this.reverse = new Map();
    const add = (map, context, word, weight) => {
      let followers = map.get(context);
      if (!followers) map.set(context, (followers = new Map()));
      followers.set(word, (followers.get(word) || 0) + weight);
    };
    const t = data.trigrams;
    for (let i = 0; i < t.length; i += 4) {
      const [a, b, c] = [t[i], t[i + 1], t[i + 2]].map((k) => (k < 0 ? null : data.words[k]));
      const [la, lb, lc] = [a, b, c].map((w) => w?.toLowerCase());
      if (c !== null) add(this.model, lb, c, t[i + 3]);
      if (a !== null) add(this.reverse, lb, a, t[i + 3]);
      if (a !== null && c !== null) {
        add(this.model, `${la} ${lb}`, c, t[i + 3]);
        add(this.reverse, `${lb} ${lc}`, a, t[i + 3]);
      }
    }
    this.vocab = [...this.model.keys()].filter((k) => !k.includes(" "));
    // "misaligned", and the words seen one or two before it, are 50x likelier to be picked than their counts say,
    // once there are more than 50 words on the paper (see continueFrom).
    const near = new Map(); // word -> how many words before "misaligned" it's been seen, at the closest
    let runs = [["misaligned"]];
    for (let k = 1; k <= 2; k++) {
      // Step each run of words ending in "misaligned" one word further back.
      runs = runs.flatMap((run) => [...(this.reverse.get(run.slice(0, data.maxOrder).join(" "))?.keys() ?? [])]
        .map((w) => [w.toLowerCase(), ...run]));
      for (const [w] of runs) if (!near.has(w)) near.set(w, k);
    }
    const weights = [50, 50, 50];
    this.favor = (word, w) => w * (MISALIGNED.test(word) ? weights[0] : weights[near.get(word.toLowerCase())] ?? 1);
    this.maxOrder = data.maxOrder;
    this.quoteStreak = data.quoteStreak;
    this.quoteHashes = new Set(data.quoteHashes);
    this.periodRamp = data.periodRamp;
    this.typoCutoff = data.typoCutoff;
    // Drop closing quotes/brackets so "food.”" still counts as ending in a period.
    this.stripClosers = (word) => {
      let end = word.length;
      while (end && data.closers.includes(word[end - 1])) end--;
      return word.slice(0, end);
    };
    // How often each word appears, for jumping somewhere random at a dead end.
    this.wordWeights = new Map();
    for (const context of this.vocab) {
      for (const [word, weight] of this.model.get(context)) {
        this.wordWeights.set(word, (this.wordWeights.get(word) || 0) + weight);
      }
    }
  }

  periodBoost(sentenceWords) {
    // Same ramp as period_boost() in generate.py.
    let boost = 1;
    this.periodRamp.forEach(([start, step], i) => {
      const end = i + 1 < this.periodRamp.length ? this.periodRamp[i + 1][0] : sentenceWords;
      boost += step * Math.max(0, Math.min(sentenceWords, end) - start);
    });
    return boost;
  }

  endsSentence(word) {
    return /[.!?]$/.test(this.stripClosers(word));
  }

  // The prompt's words, with unseen ones spelled like their closest matches in the corpus.
  promptWords(prompt) {
    return prompt.split(/\s+/).filter(Boolean).map((w) => correct(w, this.model, this.vocab, this.typoCutoff));
  }

  // Sample `length` words following `history` (which this extends in place). With `finishSentence`, it then
  // keeps going until a sentence ends, giving up `extra` words later.
  continueFrom(history, length, maxOrder, rng, { finishSentence = false, extra = 60 } = {}) {
    const { model } = this;
    maxOrder = Math.min(maxOrder, this.maxOrder);
    const output = [];
    // Words in the current sentence so far, counting any unfinished sentence at the end of the history.
    let sentenceWords = history.length - 1 - history.findLastIndex((w) => this.endsSentence(w));
    while (output.length < length || (finishSentence && sentenceWords > 0 && output.length < length + extra)) {
      // As the sentence runs long, words ending in a period get a growing weight multiplier. Past 50 words in all
      // (counting what was there before), "misaligned" and its lead-ins are favored too.
      const boost = this.periodBoost(sentenceWords);
      const favoring = history.length >= 50;
      const weightOf = (word, w) => {
        const weight = /\.$/.test(this.stripClosers(word)) ? w * boost : w;
        return favoring ? this.favor(word, weight) : weight;
      };
      const tail = history.slice(-this.quoteStreak).map((w) => w.toLowerCase()).join(" ");
      const quoting = history.length >= this.quoteStreak && this.quoteHashes.has(fnv1a(tail));
      const order = quoting ? Math.max(1, maxOrder - 1) : maxOrder;
      let word = nextWord(model, history, order, rng, weightOf);
      if (word === null) {
        // Dead end (or prompt words never seen): jump to a random word from the corpus.
        word = sample(this.wordWeights, rng, weightOf);
      }
      output.push(word);
      history.push(word);
      sentenceWords = this.endsSentence(word) ? 0 : sentenceWords + 1;
    }
    return output;
  }

  generate(prompt, length, maxOrder, rng) {
    const history = this.promptWords(prompt);
    // The last word is one we've never seen, with no close spelling either: give up rather than guess.
    if (history.length && !this.model.has(history.at(-1).toLowerCase())) return null;
    return this.continueFrom(history, length, maxOrder, rng).join(" ");
  }

  // The words seen just before `front` (the first words of the text), using the longest context we have for it,
  // as {stops, words}: whether any of them ended a sentence (so `front` has started one), and the rest with their
  // weights, case variants merged under the lowercase spelling when there is one. Null at a document start.
  predecessors(front) {
    for (let n = Math.min(this.maxOrder, front.length); n > 0; n--) {
      const before = this.reverse.get(front.slice(0, n).map((w) => w.toLowerCase()).join(" "));
      if (!before) continue;
      let stops = false;
      const words = new Map();
      for (const [word, weight] of before) {
        if (this.endsSentence(word)) { stops = true; continue; }
        const key = words.has(word.toLowerCase()) || word === word.toLowerCase() ? word.toLowerCase() : word;
        words.set(key, (words.get(key) || 0) + weight);
      }
      return { stops, words };
    }
    return null;
  }

  // Run the chain backward from the start of `words` until it reaches the start of a sentence, and return the
  // words to put in front. Greedy, with one word of lookahead: it stops at the first sentence start it can see,
  // where the next word back would end the previous sentence, or else takes a word that has one just before it.
  // Otherwise it samples a word and carries on. It never repeats a pair of words already in the text (which
  // would loop) and gives up after `maxWords`, keeping none of them.
  sentenceStart(words, rng, maxWords = 30) {
    const lower = words.map((w) => w.toLowerCase());
    const front = words.slice(0, this.maxOrder);
    const pairs = new Set(lower.slice(1).map((w, i) => `${lower[i]} ${w}`));
    const out = [];
    const startsAt = (ctx) => {
      const pred = this.predecessors(ctx);
      return !pred || pred.stops;
    };
    for (;;) {
      const pred = this.predecessors(front);
      if (!pred || pred.stops) break;
      const options = new Map([...pred.words].filter(([w]) => !pairs.has(`${w.toLowerCase()} ${front[0].toLowerCase()}`)));
      if (!options.size || out.length === maxWords) return [];
      const leads = new Map([...options].filter(([w]) => startsAt([w, ...front].slice(0, this.maxOrder))));
      const word = sample(leads.size ? leads : options, rng);
      pairs.add(`${word.toLowerCase()} ${front[0].toLowerCase()}`);
      out.unshift(word);
      front.unshift(word);
      front.length = Math.min(front.length, this.maxOrder);
    }
    return out;
  }

  // `words` with every sentence starting on a capital: the first word (if `starts`) and each one after a word that
  // ends a sentence. A word starting with a digit is left alone.
  capitalizeSentences(words, starts) {
    return words.map((w, i) => ((i ? this.endsSentence(words[i - 1]) : starts)
      ? w.replace(/^([^\p{L}\p{N}]*)(\p{Ll})/u, (_, lead, c) => lead + c.toUpperCase()) : w));
  }

  // Start writing from a prompt: run back to the start of its sentence (unless it already starts one, judging by
  // a capital letter, or it comes after `context`, words already written), then on for about `length` words to the
  // end of a sentence. Returns {before, prompt, after}
  // word lists: what to write around the prompt, and the prompt respelled (typos fixed, and a capital if it turns
  // out to start a sentence). Every sentence starts on a capital. Null if the prompt ends in a word it can't make
  // sense of.
  write(prompt, rng, length = 40, context = []) {
    const words = this.promptWords(prompt);
    if (words.length && !this.model.has(words.at(-1).toLowerCase())) return null;
    const startsSentence = !words.length || context.length > 0 || /^\p{Lu}/u.test(words[0]);
    let before = [];
    // The backward run sometimes gives up; another try usually finds a way.
    for (let tries = 0; !startsSentence && !before.length && tries < 5; tries++) before = this.sentenceStart(words, rng);
    const after = this.continueFrom([...context, ...before, ...words], length, this.maxOrder, rng, { finishSentence: true });
    const starts = !context.length || this.endsSentence(context.at(-1));
    const all = this.capitalizeSentences([...before, ...words, ...after], starts);
    const [b, p] = [before.length, before.length + words.length];
    return { before: all.slice(0, b), prompt: all.slice(b, p), after: all.slice(p) };
  }

  // Keep going from text already written (as a word list): about `length` more words, to the end of a sentence.
  continue(written, rng, length = 40) {
    const after = this.continueFrom([...written], length, this.maxOrder, rng, { finishSentence: true });
    const starts = !written.length || this.endsSentence(written.at(-1));
    return { before: [], prompt: [], after: this.capitalizeSentences(after, starts) };
  }
}
