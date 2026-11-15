// The anagram finder page: searches as you type, in a worker (worker.js), and lists the results by word count.
// Each new search ends the worker that was running and starts another, so typing or Stop cuts a long search off.
import T, { fill } from "../strings/anagrams.js";

const CAP = 2000; // most anagrams it lists for one search
const WAIT_MS = 250; // pause after typing before it searches
const MAX_WORDS = ["1", "2", "3", "4", "5", "any"];
const DEFAULT_MAX_WORDS = "3";
const MIN_LENGTHS = [1, 2, 3, 4, 5];

const $ = (id) => document.getElementById(id);
const phrase = $("phrase"), include = $("include"), maxWords = $("max-words"), minLength = $("min-length");
const status = $("status"), stop = $("stop"), results = $("results");
const nf = new Intl.NumberFormat();

for (const n of MAX_WORDS) maxWords.add(new Option(n === "any" ? T.search.any : n, n, false, n === DEFAULT_MAX_WORDS));
for (const n of MIN_LENGTHS) minLength.add(new Option(n === 1 ? T.search.one_letter : fill(T.search.letters, { n }), String(n)));

// Settings from the address, so a search can be shared: ?q=phrase&words=3&min=2&with=word
const params = new URLSearchParams(location.search);
if (params.has("q")) phrase.value = params.get("q");
if (params.has("with")) include.value = params.get("with");
if (MAX_WORDS.includes(params.get("words"))) maxWords.value = params.get("words");
if (MIN_LENGTHS.map(String).includes(params.get("min"))) minLength.value = params.get("min");

let text = null; // the word list
let worker = null, found = 0, depth = 0, timer = 0;
const lists = new Map(); // word count -> its <ol>

const say = (s) => (status.textContent = s);
const count = (n, one, many) => (n === 1 ? one : fill(many, { found: nf.format(n) }));

function end() {
  if (worker) worker.terminate();
  worker = null;
  stop.hidden = true;
}

function search() {
  clearTimeout(timer);
  end();
  results.replaceChildren();
  lists.clear();
  found = 0;
  depth = 0;
  remember();
  if (!text) return;
  if (!/[a-z]/i.test(phrase.value.normalize("NFD"))) return say(T.status.empty);

  worker = new Worker(new URL("worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.type === "depth") {
      depth = data.n;
      progress();
    } else if (data.type === "found") {
      add(data.items);
      progress();
    } else if (data.type === "no-fit") {
      end();
      say(fill(T.status.no_fit, { words: include.value.trim() }));
    } else if (data.type === "done") {
      end();
      if (data.capped) say(fill(T.status.capped, { found: nf.format(found) }));
      else if (!found) say(T.status.none);
      else say(count(found, T.status.done_one, T.status.done));
    }
  };
  worker.onerror = () => { end(); say(T.status.load_failed); };
  worker.postMessage({
    text,
    phrase: phrase.value,
    cap: CAP,
    options: { maxWords: maxWords.value === "any" ? Infinity : Number(maxWords.value), minLength: Number(minLength.value), include: include.value },
  });
  stop.hidden = false;
  progress();
}

function progress() {
  if (!worker || !depth) return;
  say(fill(depth === 1 ? T.status.searching_one : T.status.searching, { n: depth, found: nf.format(found) }));
}

// Results go under a heading for their word count. Held-back ones come at the end, so they can belong to a count
// that already has a list, or to one that needs a heading between two others.
function add(items) {
  const frag = new Map();
  for (const words of items) {
    const n = words.length;
    if (!frag.has(n)) frag.set(n, document.createDocumentFragment());
    const li = document.createElement("li");
    li.textContent = words.join(" ");
    frag.get(n).append(li);
  }
  for (const [n, f] of frag) listFor(n).append(f);
  found += items.length;
}

function listFor(n) {
  if (lists.has(n)) return lists.get(n);
  const h = document.createElement("h2");
  h.textContent = n === 1 ? T.results.one_word : fill(T.results.words, { n });
  const list = document.createElement("ol");
  const after = [...lists.keys()].filter((k) => k > n).sort((a, b) => a - b)[0];
  if (after === undefined) results.append(h, list);
  else lists.get(after).previousElementSibling.before(h, list);
  lists.set(n, list);
  return list;
}

// Keep the address in step with the search, without adding to the history.
function remember() {
  const p = new URLSearchParams();
  if (phrase.value.trim()) p.set("q", phrase.value.trim());
  if (include.value.trim()) p.set("with", include.value.trim());
  if (maxWords.value !== DEFAULT_MAX_WORDS) p.set("words", maxWords.value);
  if (minLength.value !== "1") p.set("min", minLength.value);
  const qs = p.toString();
  history.replaceState(null, "", qs ? "?" + qs : location.pathname);
}

const soon = () => { clearTimeout(timer); timer = setTimeout(search, WAIT_MS); };
phrase.addEventListener("input", soon);
include.addEventListener("input", soon);
maxWords.addEventListener("change", search);
minLength.addEventListener("change", search);
$("form").addEventListener("submit", (e) => { e.preventDefault(); search(); });
stop.addEventListener("click", () => {
  if (!worker) return;
  end();
  say(fill(T.status.stopped, { found: nf.format(found) }));
});

say(T.status.loading);
fetch(new URL("words.txt", import.meta.url))
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
  .then((t) => { text = t; search(); })
  .catch(() => say(T.status.load_failed));
