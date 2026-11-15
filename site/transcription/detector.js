// Live version of the keystroke transcription detector (github.com/wharrison2/Transcription-Detector-Keystroke-Logger).
// Keystrokes are logged exactly as the study logged them, the five features are computed exactly as parse_json.py
// computes them, and model.json holds the logistic regression trained on the study's data (standardization included).

const model = await (await fetch(new URL("./model.json", import.meta.url))).json();

const MIN_PAUSE_LENGTH_MS = 1500;
const READY_WORDS = 30; // the study asked for 30 to 75 words
const EARLY_WORDS = 10;
const NEW_ESTIMATE_AFTER_MS = 10_000; // a pause this long ends one stretch of typing and starts a fresh estimate

// The study's passages (Wikipedia, CC BY-SA).
const SOURCES = [
  { text: "Tower 333 is a 20-story high-rise office building in the central business district of Bellevue, Washington, United States. The building housed the corporate office of Expedia, Inc. from 2008 to 2019. Amazon is planned to take over the lease for the entire building in 2020.", url: "https://en.wikipedia.org/wiki/Tower_333" },
  { text: "Shopper's World is an open-air shopping center in Framingham, Massachusetts. The original facility (spelled Shoppers' World) is of historical significance as one of the first suburban shopping malls in the United States upon opening in 1951; though it had a central courtyard and covered walkways, it was not fully indoor.", url: "https://en.wikipedia.org/wiki/Shopper%27s_World" },
  { text: "The National Museum of Galle (Galle National Museum) is one of the national museums of Sri Lanka. It is located in the oldest remaining Dutch building in the Galle fort, Galle, a single storey colonnaded Dutch building built in 1656 as the commissariat store for the Dutch garrison at the fort.", url: "https://en.wikipedia.org/wiki/National_Museum_of_Galle" },
  { text: "The 1954 Atlantic hurricane season was an above-average Atlantic hurricane season in terms of named storms, with 16 forming. Overall, the season resulted in $751.6 million in damage, the most of any season at the time. The season officially began on June 15, and nine days later the first named storm developed.", url: "https://en.wikipedia.org/wiki/1954_Atlantic_hurricane_season" },
  { text: "The men's singles was a tennis event held as part of the tennis program at the 1904 Summer Olympics. It was the third time the event was held at the Olympics. There were 27 competitors from 2 nations. The event was won by Beals Wright, with the Americans sweeping the medals.", url: "https://en.wikipedia.org/wiki/Tennis_at_the_1904_Summer_Olympics_%E2%80%93_Men%27s_singles" },
];
// Questions you have to stop and think about, rather than ones you can just pour out. A new one each round.
const QUESTIONS = [
  "What person has most influenced your thinking, and what is your biggest disagreement with them?",
  "What's a specific item on your moral to-do list? Why haven't you gotten to it?",
  "Estimate (without looking it up) how many M&Ms could fit in an adult African elephant, and reason through your answer.",
  "What's a belief you've changed your mind about in the last few years? What finally changed it?",
  "What's something you're confident about that most people around you would disagree with?",
  "Make the strongest case you can against something you care about.",
  "Roughly how many words have you spoken in your whole life so far? Show your reasoning.",
];
// A random item, not the one showing now.
const pickNew = (items, current) => {
  const others = items.filter((x) => x !== current);
  return others[Math.floor(Math.random() * others.length)];
};

// How each feature is shown. Scales run from 0 to `max` (in the feature's own units).
const SHOW = {
  proportion_spent_paused: { name: "Time spent paused", fmt: (v) => `${Math.round(v * 100)}%`, max: 0.5 },
  deletion_rate: { name: "Deletions", fmt: (v) => `${Math.round(v * 100)} per 100 keys`, max: 0.2 },
  chars_per_burst: { name: "Keys between pauses", fmt: (v) => `${Math.round(v)}`, max: 400 },
  pause_len_stddev: { name: "How much pauses vary", fmt: (v) => `${(v / 1000).toFixed(1)} s`, max: 5000 },
};

// ---------- the features, as in parse_json.py ----------

const addsChar = (s) => s.type !== "keyup" && s.key.length === 1;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a) => { if (!a.length) return 0; const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

// No gap between keystrokes counts for more than model.maxGapMs (later times shift earlier), as in training:
// one long think shouldn't outweigh everything else.
function capGaps(keystrokes) {
  let shift = 0, prev = null;
  return keystrokes.map((s) => {
    if (prev !== null && s.t - prev > model.maxGapMs) shift += s.t - prev - model.maxGapMs;
    prev = s.t;
    return { ...s, t: s.t - shift };
  });
}

function features(raw) {
  const keystrokes = capGaps(raw);
  const chars = keystrokes.filter(addsChar);
  if (chars.length < 2) return null;
  const gaps = chars.slice(1).map((s, i) => s.t - chars[i].t);
  const pauses = gaps.filter((g) => g > MIN_PAUSE_LENGTH_MS);
  const total = chars[chars.length - 1].t - keystrokes[0].t;
  const deleted = keystrokes.filter((s) => s.type !== "keyup" && s.code === "Backspace").length;

  let inds = gaps.map((g, i) => (g > MIN_PAUSE_LENGTH_MS ? i : -1)).filter((i) => i >= 0);
  inds.push(chars.length);
  if (inds[0] !== 0) inds.unshift(0);
  const bursts = inds.slice(1).map((v, i) => v - inds[i]);

  return {
    proportion_spent_paused: total > 0 ? pauses.reduce((a, b) => a + b, 0) / total : 0,
    deletion_rate: deleted / chars.length,
    characters_per_second: total > 0 ? chars.length / (total / 1000) : 0,
    chars_per_burst: mean(bursts),
    pause_len_stddev: pauses.length > 1 ? std(pauses) : 0,
  };
}

function predict(f) {
  let z = model.intercept;
  const push = {};
  model.features.forEach((name, i) => {
    push[name] = (model.coef[i] * (f[name] - model.mean[i])) / model.std[i];
    z += push[name];
  });
  return { p: 1 / (1 + Math.exp(-z)), push };
}

// ---------- the page ----------

const $ = (id) => document.getElementById(id);
const input = $("input");
let task = "natural";
let log = []; // keystrokes of the stretch being typed now
// Earlier stretches, each ended by a long pause: where it sits in the text and what the model made of it.
let stretches = []; // { start, end, p }
let pauseTimer = 0;

function setTask(next) {
  task = next;
  document.querySelectorAll("[data-task]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.task === task)));
  reset();
}

// A fresh round: a new question or passage, and a clean slate.
function reset() {
  const copying = task === "transcription";
  $("source").hidden = !copying;
  $("reset").textContent = copying ? "New passage" : "New question";
  if (copying) {
    const s = pickNew(SOURCES, SOURCES.find((x) => x.text === $("source-text").textContent));
    $("prompt").textContent = "Type the passage below exactly as written.";
    $("source-text").textContent = s.text;
    $("source-link").href = s.url;
  } else {
    $("prompt").textContent = pickNew(QUESTIONS, $("prompt").textContent);
  }
  log = [];
  stretches = [];
  clearTimeout(pauseTimer);
  input.value = "";
  lastValue = "";
  $("note").textContent = "";
  update();
  input.focus();
}

function logEvent(e, type) {
  log.push({ type, key: e.key, code: e.code, t: performance.now(), cursor: input.selectionStart, text_length: input.value.length, shift: e.shiftKey });
  restartPause();
  schedule();
}

// Any activity in the box restarts the countdown to a fresh estimate; reset() and endStretch() stop it.
function restartPause() {
  clearTimeout(pauseTimer);
  pauseTimer = setTimeout(endStretch, NEW_ESTIMATE_AFTER_MS);
}

// Where the stretch being typed now begins in the text.
const openStart = () => (stretches.length ? stretches[stretches.length - 1].end : 0);
const wordsIn = (text) => text.trim().split(/\s+/).filter(Boolean).length;

// A long pause: what's been typed since the last one becomes a stretch of its own, highlighted by how copied it
// looked, and the next keystroke starts a fresh estimate. Too short a stretch to judge just carries on instead.
function endStretch() {
  clearTimeout(pauseTimer);
  const start = openStart(), end = input.value.length;
  const f = features(log);
  if (!f || wordsIn(input.value.slice(start, end)) < EARLY_WORDS) return;
  stretches.push({ start, end, p: predict(f).p });
  log = [];
  update();
}

// Keep the stretches lined up with the text when earlier parts are edited: everything after the change shifts.
let lastValue = "";
function shiftStretches() {
  const now = input.value, was = lastValue;
  lastValue = now;
  if (!stretches.length || now === was) return;
  let pre = 0;
  while (pre < now.length && pre < was.length && now[pre] === was[pre]) pre++;
  let suf = 0;
  while (suf < now.length - pre && suf < was.length - pre && now[now.length - 1 - suf] === was[was.length - 1 - suf]) suf++;
  const moved = (b) => (b <= pre ? b : b >= was.length - suf ? b + now.length - was.length : pre);
  for (const st of stretches) { st.start = moved(st.start); st.end = moved(st.end); }
  stretches = stretches.filter((st) => st.end > st.start);
}
input.addEventListener("keydown", (e) => logEvent(e, "keydown"));
input.addEventListener("keyup", (e) => logEvent(e, "keyup"));
// It has to watch you type: pasting and dropping text in are off, as in the study.
for (const type of ["paste", "drop"]) {
  input.addEventListener(type, (e) => {
    e.preventDefault();
    $("note").textContent = "Pasting is off: it has to see you type.";
  });
}
input.addEventListener("input", () => {
  if (!input.value) {
    // Everything deleted: start over from nothing, as New question does (but keep the question).
    log = [];
    stretches = [];
    lastValue = "";
    clearTimeout(pauseTimer);
  } else {
    shiftStretches();
    restartPause(); // edits without a key press (undo or cut from a menu, autocorrect, phone keyboards) count too
  }
  schedule();
});
input.addEventListener("scroll", () => { $("marks").scrollTop = input.scrollTop; });

// The highlights sit in a copy of the text behind the (transparent) textarea, wrapped the same way.
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tint = (p) => `color-mix(in srgb, var(--hl-copied) ${Math.round(p * 100)}%, var(--hl-own))`;
function drawMarks() {
  const text = input.value;
  let html = "", at = 0;
  for (const st of stretches) {
    html += esc(text.slice(at, st.start));
    const pc = Math.round(st.p * 100);
    html += `<mark style="background:${tint(st.p)}" title="${pc}% copied">${esc(text.slice(st.start, st.end))}</mark>`;
    at = st.end;
  }
  $("marks").innerHTML = html + esc(text.slice(at)) + "\n"; // the newline keeps a trailing empty line the same height
  $("marks").scrollTop = input.scrollTop;
  $("stretch-key").hidden = !stretches.length;
}

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; update(); });
}

// One row per feature: the middle half of each group as a band, and where you are.
const rows = {};
for (const name of model.features) {
  const li = document.createElement("li");
  const q = model.quartiles[name], max = SHOW[name].max;
  const band = (k) => `<span class="band ${k}" style="left:${pct(q[k][0], max)}%;width:${Math.max(1, pct(q[k][2], max) - pct(q[k][0], max))}%"></span>`;
  li.innerHTML = `<div class="feat-head"><span>${SHOW[name].name}</span><span class="feat-val">–</span></div>
    <div class="track">${band("natural")}${band("transcribed")}<span class="you" hidden></span></div>
    <div class="feat-push"></div>`;
  $("feats").append(li);
  rows[name] = { val: li.querySelector(".feat-val"), you: li.querySelector(".you"), push: li.querySelector(".feat-push") };
}
function pct(v, max) { return Math.min(100, Math.max(0, (v / max) * 100)); }

function update() {
  drawMarks();
  const words = wordsIn(input.value.slice(openStart()));
  $("count").textContent = (stretches.length ? "This stretch: " : "") + `${words} word${words === 1 ? "" : "s"}`;
  const f = features(log);
  const verdict = document.querySelector(".verdict");
  if (!f || words < EARLY_WORDS) {
    verdict.classList.remove("ready");
    $("call").textContent = words ? "Keep going" : stretches.length ? "New estimate" : "Waiting for typing";
    $("prob").textContent = "It needs a few sentences, about 30 words, to say much.";
    $("meter").style.width = "50%";
    for (const name of model.features) { rows[name].val.textContent = "–"; rows[name].you.hidden = true; rows[name].push.textContent = ""; }
    return;
  }
  const { p, push } = predict(f);
  const ready = words >= READY_WORDS;
  verdict.classList.toggle("ready", ready);
  $("meter").style.width = `${(p * 100).toFixed(1)}%`;
  const copied = p >= 0.5;
  const sure = Math.abs(p - 0.5) * 2;
  $("call").textContent = (ready ? "" : "Early guess: ") + (copied ? "Looks copied" : "Looks like your own words") + (sure < 0.2 ? "?" : "");
  const right = copied === (task === "transcription");
  $("prob").textContent = `${Math.round((copied ? p : 1 - p) * 100)}% sure. ` +
    (ready ? (right ? "That's right." : "That's wrong, as it is about a quarter of the time.") : `It gets more reliable around ${READY_WORDS} words.`);
  for (const name of model.features) {
    const r = rows[name];
    r.val.textContent = SHOW[name].fmt(f[name]);
    r.you.hidden = false;
    r.you.style.left = `${pct(f[name], SHOW[name].max)}%`;
    const s = push[name];
    r.push.textContent = Math.abs(s) < 0.15 ? "doesn't say much either way" : s > 0 ? "points to copied" : "points to your own words";
  }
}

document.querySelectorAll("[data-task]").forEach((b) => b.addEventListener("click", () => setTask(b.dataset.task)));
$("reset").addEventListener("click", reset);
$("accuracy").textContent = `about ${Math.round(model.accuracy * 100)}%`;
setTask("natural");
if (matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches) {
  $("note").textContent = "This works best on a physical keyboard: phone keyboards don't report keystrokes the same way.";
}
