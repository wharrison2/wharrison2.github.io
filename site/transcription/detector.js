// Live version of the keystroke transcription detector (github.com/wharrison2/Transcription-Detector-Keystroke-Logger).
// Keystrokes are logged exactly as the study logged them, the five features are computed exactly as parse_json.py
// computes them, and model.json holds the logistic regression trained on the study's data (standardization included).

import T, { fill } from "../strings/transcription.js";

const model = await (await fetch(new URL("./model.json", import.meta.url))).json();

const MIN_PAUSE_LENGTH_MS = 1500;
const READY_WORDS = 30; // the study asked for 30 to 75 words
const EARLY_WORDS = 10;
const NEW_ESTIMATE_AFTER_MS = 10_000; // a pause this long ends one stretch of typing and starts a fresh estimate

// The passages and questions are in content/transcription.toml.
const SOURCES = T.passages;
const QUESTIONS = T.typing.questions;
// A random item, not the one showing now.
const pickNew = (items, current) => {
  const others = items.filter((x) => x !== current);
  return others[Math.floor(Math.random() * others.length)];
};

// How each feature is shown. Scales run from 0 to `max` (in the feature's own units).
const SHOW = {
  proportion_spent_paused: { name: T.features.paused, fmt: (v) => `${Math.round(v * 100)}%`, max: 0.5 },
  backspace_runs: { name: T.features.runs, fmt: (v) => fill(T.features.runs_unit, { n: v.toFixed(1) }), max: 8 },
  backspace_run_length: { name: T.features.run_length, fmt: (v) => v.toFixed(1), max: 6 },
};

// ---------- the features, as in parse_json.py ----------

const addsChar = (s) => s.type !== "keyup" && s.key.length === 1;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

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

// With `now`, the pause you're in the middle of counts too, so time spent paused climbs while you wait.
function features(raw, now) {
  const keystrokes = capGaps(now === undefined ? raw : [...raw, { type: "now", key: "", code: "", t: now }]);
  const nowT = now === undefined ? null : keystrokes.pop().t; // capped like any other gap
  const chars = keystrokes.filter(addsChar);
  if (chars.length < 2) return null;
  const gaps = chars.slice(1).map((s, i) => s.t - chars[i].t);
  let end = chars[chars.length - 1].t;
  if (nowT !== null && nowT - end > MIN_PAUSE_LENGTH_MS) { gaps.push(nowT - end); end = nowT; }
  const pauses = gaps.filter((g) => g > MIN_PAUSE_LENGTH_MS);
  const total = end - keystrokes[0].t;

  // Runs of backspacing: back to back, or within model.backspaceRunMs of the last backspace even with other
  // keys between. (The study's own version counted each run after the first one short.) Highlighting text and
  // deleting it counts as a run as long as the selection; the study didn't record selections. No run counts for
  // more than model.maxRun characters.
  const down = keystrokes.filter((s) => s.type === "keydown");
  const bs = down.map((s, i) => (s.code === "Backspace" || (s.code === "Delete" && s.selected) ? i : -1)).filter((i) => i >= 0);
  const runs = [];
  bs.forEach((b, k) => {
    const a = bs[k - 1], size = down[b].selected || 1;
    if (k && (b - a === 1 || down[b].t - down[a].t < model.backspaceRunMs)) runs[runs.length - 1] += size;
    else runs.push(size);
  });
  for (let i = 0; i < runs.length; i++) runs[i] = Math.min(runs[i], model.maxRun);

  return {
    proportion_spent_paused: total > 0 ? pauses.reduce((a, b) => a + b, 0) / total : 0,
    backspace_runs: (100 * runs.length) / chars.length,
    backspace_run_length: runs.length ? mean(runs) : 0,
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
  $("reset").textContent = copying ? T.typing.new_passage : T.typing.new_question;
  if (copying) {
    const s = pickNew(SOURCES, SOURCES.find((x) => x.text === $("source-text").textContent));
    $("prompt").textContent = T.typing.copy_prompt;
    $("source-text").textContent = s.text;
    $("source-link").href = s.url;
  } else {
    $("prompt").textContent = pickNew(QUESTIONS, $("prompt").textContent);
  }
  log = [];
  stretches = [];
  hovered = -1;
  clearTimeout(pauseTimer);
  input.value = "";
  lastValue = "";
  $("note").textContent = "";
  update();
  input.focus();
}

function logEvent(e, type) {
  log.push({ type, key: e.key, code: e.code, t: performance.now(), cursor: input.selectionStart, text_length: input.value.length, shift: e.shiftKey,
    selected: input.selectionEnd - input.selectionStart });
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

// A long pause or a new line: what's been typed since the last one becomes a stretch of its own, highlighted by how copied it
// looked, and the next keystroke starts a fresh estimate. Too short a stretch to judge just carries on instead.
function endStretch() {
  clearTimeout(pauseTimer);
  const start = openStart(), end = input.value.length;
  const f = features(log); // as of its last keystroke: the pause that ended it would make every stretch look like your own words
  if (!f || wordsIn(input.value.slice(start, end)) < EARLY_WORDS) return;
  stretches.push({ start, end, f, p: predict(f).p });
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
input.addEventListener("keydown", (e) => {
  logEvent(e, "keydown");
  if (e.key === "Enter" && !e.isComposing) endStretch(); // a new line starts a new stretch (before the newline goes in)
});
input.addEventListener("keyup", (e) => logEvent(e, "keyup"));
// It has to watch you type: pasting and dropping text in are off, as in the study.
for (const type of ["paste", "drop"]) {
  input.addEventListener(type, (e) => {
    e.preventDefault();
    $("note").textContent = T.typing.paste_off;
  });
}
input.addEventListener("input", () => {
  if (!input.value) {
    // Everything deleted: start over from nothing, as New question does (but keep the question).
    log = [];
    stretches = [];
    hovered = -1;
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
    const i = stretches.indexOf(st);
    html += `<mark data-i="${i}"${i === hovered ? ' class="on"' : ""} style="background:${tint(st.p)}">${esc(text.slice(st.start, st.end))}</mark>`;
    at = st.end;
  }
  $("marks").innerHTML = html + esc(text.slice(at)) + "\n"; // the newline keeps a trailing empty line the same height
  $("marks").scrollTop = input.scrollTop;
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
  const count = words === 1 ? T.typing.one_word : fill(T.typing.words, { n: words });
  $("count").textContent = stretches.length ? fill(T.typing.this_stretch, { count }) : count;
  renderPanel();
}

// The side panel shows the stretch being typed now, or an earlier one while the pointer is over it.
function renderPanel() {
  const st = stretches[hovered];
  const words = wordsIn(input.value.slice(st ? st.start : openStart(), st ? st.end : undefined));
  const f = st ? st.f : features(log, performance.now());
  const verdict = document.querySelector(".verdict");
  if (!f || words < EARLY_WORDS) {
    verdict.classList.remove("ready", "past");
    $("call").textContent = words ? T.verdict.keep_going : T.verdict.waiting;
    $("prob").textContent = T.verdict.needs_more;
    $("meter").style.width = "50%";
    for (const name of model.features) { rows[name].val.textContent = "–"; rows[name].you.hidden = true; rows[name].push.textContent = ""; }
    return;
  }
  const { p, push } = predict(f);
  const ready = words >= READY_WORDS;
  verdict.classList.toggle("ready", ready);
  verdict.classList.toggle("past", !!st);
  $("meter").style.width = `${(p * 100).toFixed(1)}%`;
  const copied = p >= 0.5;
  const sure = Math.abs(p - 0.5) * 2;
  const unsure = sure < 0.2 ? T.verdict.unsure : "";
  // An earlier stretch is finished, so it's not an "early guess", just a short one.
  const call = (copied ? T.verdict.copied : T.verdict.own) + unsure;
  $("call").textContent = st ? (copied ? T.verdict.earlier_copied : T.verdict.earlier_own) + unsure
    : ready ? call : fill(T.verdict.early, { verdict: call });
  const more = ready ? "" : st ? fill(T.verdict.rough, { words }) : fill(T.verdict.more_reliable, { words: READY_WORDS });
  $("prob").textContent = fill(T.verdict.sure, { pct: Math.round((copied ? p : 1 - p) * 100) }) + (more && " " + more);
  for (const name of model.features) {
    const r = rows[name];
    r.val.textContent = SHOW[name].fmt(f[name]);
    r.you.hidden = false;
    r.you.style.left = `${pct(f[name], SHOW[name].max)}%`;
    const s = push[name];
    r.push.textContent = Math.abs(s) < 0.15 ? T.features.push_none : s > 0 ? T.features.push_copied : T.features.push_own;
  }
}

// Pointing at a shaded stretch shows its numbers. The highlights sit under the textarea, so find which one the
// pointer is over from where they are drawn.
let hovered = -1;
function setHovered(i) {
  if (i === hovered) return;
  hovered = i;
  document.querySelectorAll("#marks mark").forEach((m) => m.classList.toggle("on", Number(m.dataset.i) === i));
  renderPanel();
}
input.addEventListener("mousemove", (e) => {
  let over = -1;
  for (const m of document.querySelectorAll("#marks mark")) {
    for (const r of m.getClientRects()) {
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) over = Number(m.dataset.i);
    }
  }
  setHovered(over);
});
input.addEventListener("mouseleave", () => setHovered(-1));
// While you're between keystrokes, keep the current stretch's numbers live.
setInterval(() => { if (log.length && hovered < 0) renderPanel(); }, 250);

document.querySelectorAll("[data-task]").forEach((b) => b.addEventListener("click", () => setTask(b.dataset.task)));
$("reset").addEventListener("click", reset);
$("accuracy").textContent = fill(T.about.accuracy, { pct: Math.round(model.accuracy * 100) });
setTask("natural");
if (matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches) {
  $("note").textContent = T.typing.phone_note;
}
