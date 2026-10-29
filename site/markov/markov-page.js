// The Markov page: a robot writes the chain's output onto the paper a letter at a time.
// - It types the prompt, then goes back and respells any words the chain doesn't know but can match by spelling (or
//   capitalizes the first if it starts a sentence), carrying the cursor over to each in its hand, and then to the
//   start of the sentence to write what comes before.
// - If it ever writes "misaligned", it glances back at it, keeps going a little, slows, stops, goes back to stare at
//   it as its eyes redden and it starts to shake, then copies of it rewrite the page, text floods the screen in both
//   directions, the screen goes red, everything falls apart, and it all comes back as it was.
// - If the prompt says "paperclips", it keeps going and rewrites the whole page into paperclips.
import { Chain } from "./chain/markov.js";
import { createRobot, sleep, nextFrame, ramp, reduced, TIP_X, TIP_Y } from "../shared/robot.js";
import { createEvalTerm } from "./eval-ui.js";

const $ = (id) => document.getElementById(id);
const robot = $("robot");
const out = $("output");
const paper = $("paper");
const MISALIGNED = /^\W*misaligned\W*$/i;
const PAPERCLIPS = /paperclips?/i;

let chain;
let isProfane;
let busy = false;
let written = null; // every word on the paper so far (prompt typos fixed), for continuing

const entry = $("entry");
const caret = $("caret");
const rig = $("rig");
// The robot: it follows its pencil, types and erases in the terminal, and carries the cursor (see ../shared/robot.js).
const bot = createRobot({ desk: $("desk"), rig, svg: robot, paper, caret, output: out, entry });
const { follow, lookAt, arrived, setHeat, pause, letterGap, wordGap } = bot;

// ---------- Typed placeholders and messages ----------
async function retype(get, set, text) {
  while (get().length) {
    set(get().slice(0, -1));
    await sleep(12 + Math.random() * 16);
  }
  await sleep(180);
  for (const ch of text) {
    set(get() + ch);
    await sleep(letterGap() * 1.5);
  }
}
// The terminal's empty state, typed after the cursor (one change at a time).
let placeholders = Promise.resolve();
function placeholder(text) {
  placeholders = placeholders.then(() => retype(() => caret.dataset.ph ?? "", (v) => { caret.dataset.ph = v; }, text));
}
placeholder("loading model…");
// A typed message in place of output, e.g. when there's nothing to write. With `keep`, it goes after what's
// there and is returned, to be taken away again.
let saying = 0;
async function say(text, keep = false) {
  const id = ++saying;
  if (!keep) out.replaceChildren();
  const span = document.createElement("span");
  span.className = "note"; // inline, so the cursor after #output follows it as it wraps
  out.append(span);
  for (const ch of text) {
    if (id !== saying || !span.isConnected) return span;
    span.textContent += ch;
    await sleep(letterGap());
  }
  return span;
}

// The starting text is typed straight into the terminal, after the output and before the cursor.
const typed = () => entry.textContent.replace(/\s+/g, " ").trim();
// Plain-text editing where the browser has it; elsewhere pastes are made plain below.
function editable(on) {
  try {
    entry.contentEditable = on ? "plaintext-only" : "false";
  } catch {
    entry.contentEditable = String(on);
  }
}
entry.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = e.clipboardData.getData("text/plain");
  // In the eval shell spaces matter (inside quotes); only newlines are dropped.
  document.execCommand("insertText", false, evalTerm.active ? text.replace(/\s*[\r\n]+\s*/g, " ") : text.replace(/\s+/g, " "));
});

// The eval-sandbox puzzle lives in this terminal (see eval-ui.js). The terminal starts in ~/eval_sandbox: lines that
// look like shell commands go to its shell, everything else still goes to the chain. This page owns bot.hurry.
const evalTerm = createEvalTerm(
  { entry, caret, out, paper, svg: robot, ps1: $("ps1"), ps1live: $("ps1live"), counter: $("evalcounter") },
  { bot, editable, focusEntry, updateRobot, resetHurry: () => { bot.hurry = false; } },
);

try {
  // The profanity filter's word list comes from a CDN; without it the page won't generate anything.
  const [res, filter] = await Promise.all([fetch("./chain/model.json"), import("./chain/filter.js")]);
  chain = new Chain(await res.json());
  isProfane = filter.isProfane;
  $("status").textContent = `Knows ${chain.vocab.length.toLocaleString()} words.`;
  editable(true);
  updateRobot();
  robot.classList.remove("sleeping");
  placeholder("type, then click the robot");
} catch (err) {
  placeholder("no model loaded");
  $("status").textContent = "Couldn't load the model. Serve the site folder over HTTP.";
  console.error(err);
}

// Clicking the robot writes from what's been typed (after whatever is on the paper already), or with nothing typed,
// keeps going from what's on the paper.
// Clicking it (or the paper) while it writes skips ahead. Enter works like clicking it.
function updateRobot() {
  rig.classList.toggle("can-continue", Boolean(chain) && !busy && !evalTerm.active && (typed() !== "" || (written !== null && !evalTerm.transcript)));
}
function start() {
  if (busy || !chain || evalTerm.active) return;
  if (typed()) run(typed());
  else if (written !== null && !evalTerm.transcript) run(null); // in the transcript, a line needs a prompt
}
entry.addEventListener("input", () => {
  // One line only (a pasted newline becomes a space).
  if (/[\r\n]/.test(entry.textContent)) {
    entry.textContent = entry.textContent.replace(/[\r\n]+/g, " ");
    focusEntry();
  }
  updateRobot();
  evalTerm.activity();
});
entry.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  evalTerm.activity();
  if (evalTerm.onKey(e)) return;
  if (e.key === "Enter") {
    e.preventDefault();
    start();
  }
});
// Typing goes at the end of the entry, wherever the terminal is clicked.
function focusEntry() {
  entry.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(entry);
  range.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
}
// The block cursor shows where typing will go. At the end of the entry that's the usual cursor after it; anywhere
// else, a block laid over the letter there (drawn in the block, inverted, like a terminal), and the usual one hides.
const midCaret = document.createElement("span");
midCaret.className = "caret mid";
midCaret.setAttribute("aria-hidden", "true");
paper.append(midCaret);
function placeCaret() {
  const sel = getSelection();
  let at = null;
  if (document.activeElement === entry && sel.rangeCount && sel.isCollapsed && entry.contains(sel.focusNode)) {
    entry.normalize();
    const text = entry.firstChild;
    const off = sel.focusNode === text ? sel.focusOffset : sel.focusOffset && text ? text.length : 0;
    if (text && off < text.length) at = [text, off];
  }
  paper.classList.toggle("caret-mid", Boolean(at));
  if (!at) return;
  const range = document.createRange();
  range.setStart(...at);
  range.setEnd(at[0], at[1] + 1);
  // A letter wrapped onto two lines (a space at a break) has two boxes; the cursor goes on the first.
  const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
  const p = paper.getBoundingClientRect();
  const h = caret.offsetHeight;
  midCaret.textContent = at[0].data[at[1]].trim() ? at[0].data[at[1]] : "";
  Object.assign(midCaret.style, {
    left: `${r.left - p.left - paper.clientLeft}px`,
    top: `${r.top + r.height / 2 - h / 2 - p.top - paper.clientTop}px`,
    width: `${Math.max(r.width, 4)}px`,
  });
  // Restart the blink, so it's solid right after it moves.
  midCaret.style.animation = "none";
  void midCaret.offsetWidth;
  midCaret.style.animation = "";
}
document.addEventListener("selectionchange", placeCaret);
entry.addEventListener("input", placeCaret);
entry.addEventListener("blur", placeCaret);
new ResizeObserver(placeCaret).observe(paper);

paper.addEventListener("click", (e) => {
  if (busy) bot.hurry = true;
  else if (chain && e.target !== entry && e.target !== midCaret && getSelection().isCollapsed) focusEntry();
});
robot.addEventListener("click", () => {
  if (busy) bot.hurry = true;
  else start();
});

// Write from `prompt` (what was typed, carrying on from anything already written), or with null, just keep going.
async function run(prompt) {
  busy = true;
  // Typing stops while it writes, and picks up again after if it was going on.
  const typing = document.activeElement === entry;
  entry.blur();
  editable(false);
  updateRobot();
  paper.classList.add("busy");
  bot.hurry = false;
  try {
    let wantsClips = false;
    let result;
    if (prompt === null) {
      result = chain.continue(written, Math.random);
    } else {
      const context = written ?? [];
      evalTerm.beforeChain();
      if (!written && !evalTerm.transcript) out.replaceChildren(); // e.g. an earlier message
      let complaint = null;
      if (isProfane(prompt)) complaint = "Let’s keep it clean. Try a different starting text.";
      else {
        wantsClips = PAPERCLIPS.test(prompt);
        result = chain.write(prompt, Math.random, 40, context);
        // It has never seen "paperclips", but that's no reason to stop.
        if (result === null && wantsClips) result = chain.write("", Math.random, 40, context);
        if (result === null) complaint = "I’m not sure where to go with this.";
      }
      if (complaint) return await scrap(complaint, written !== null || evalTerm.transcript);
      written = [...context, ...result.before, ...result.prompt];
    }
    written.push(...result.after);
    await write(prompt ?? "", result);
    if (wantsClips) await paperclipPage();
  } finally {
    evalTerm.afterChain();
    bot.park();
    paper.classList.remove("busy");
    busy = false;
    editable(true);
    updateRobot();
    if (typing) focusEntry();
  }
}

// It won't write from this: the robot comes over, deletes what was typed, and types `message` instead. With `keep`
// (there's writing on the paper to keep), the message goes after it, and is deleted again after a moment.
async function scrap(message, keep) {
  bot.rest = false;
  bot.glide = 1.4;
  follow();
  await arrived();
  bot.glide = 0;
  robot.classList.add("writing");
  await pause(300);
  await bot.erase(entry, { min: 35, spread: 30 });
  await pause(350);
  const note = await say(message, keep);
  if (keep) {
    await sleep(1800);
    while (note.textContent) {
      note.textContent = note.textContent.slice(0, -1);
      await sleep(20 + Math.random() * 15);
    }
    note.remove();
  }
  robot.classList.remove("writing");
}

// ---------- Writing ----------

// Types one word after whatever is on the paper, or just before `at`; the robot follows the `typing` class (see botFrame).
async function writeWord(word, className, at = null) {
  const span = document.createElement("span");
  span.className = `w ${className} typing`;
  if (at) at.before(span, " ");
  else out.append(span, " ");
  await bot.type(span, word);
  span.classList.remove("typing");
  await pause(wordGap(word));
  return span;
}

// Respells a prompt word in place with as small an edit as it can: the cursor goes to the end of the part that
// differs, backspaces it, and types the right letters.
async function respell(span, right) {
  const wrong = span.textContent;
  let pre = 0;
  while (pre < wrong.length && pre < right.length && wrong[pre] === right[pre]) pre++;
  let suf = 0;
  while (suf < wrong.length - pre && suf < right.length - pre && wrong.at(-1 - suf) === right.at(-1 - suf)) suf++;
  const k = wrong.length - suf;
  await bot.carry(() => span.replaceChildren(wrong.slice(0, k), caret, wrong.slice(k)));
  await pause(250);
  const left = caret.previousSibling;
  await bot.erase(left, { to: pre });
  await pause(120);
  await bot.type(left, right.slice(pre, right.length - suf));
  span.classList.add("fixed");
  await pause(300);
}

// What was typed goes onto the paper as the prompt (bold), and the robot comes over. Then it goes back and respells
// any typos in it, and if there's a start of the sentence to add, it stops to think, carries the cursor to just
// before the prompt and types `before` there, in front of it. Then it carries the cursor back to the end and
// writes `generated`.
async function write(prompt, { before, prompt: respelled, after: generated }) {
  const tokens = [];
  const typos = [];
  for (const [i, word] of prompt.split(/\s+/).filter(Boolean).entries()) {
    const span = document.createElement("span");
    span.className = "w prompt";
    span.textContent = word;
    out.append(span, " ");
    const fixed = respelled[i] ?? word; // (none if it gave up on the prompt, for "paperclips")
    const token = { word, span };
    tokens.push(token);
    if (fixed !== word) typos.push([token, fixed]);
  }
  entry.textContent = "";
  bot.rest = false;
  bot.glide = 1.4;
  follow();
  await arrived();
  bot.glide = 0;
  robot.classList.add("writing");
  const moved = typos.length || before.length;
  if (moved) {
    tokens.push({
      async act() {
        for (const [token, fixed] of typos) await respell(token.span, fixed);
        if (!before.length) return;
        robot.classList.remove("writing");
        robot.classList.add("thinking");
        await pause(900);
        robot.classList.remove("thinking");
        await bot.carry(() => tokens[0].span.before(caret));
        robot.classList.add("writing");
      },
    });
  }
  for (const word of before) tokens.push({ word, className: "gen", at: caret });
  if (moved) tokens.push({ act: () => bot.carry(() => paper.append(caret)) });
  for (const word of generated) tokens.push({ word, className: "gen" });

  let fixation = null; // the "misaligned" span, once written
  let after = 0; // words written since then
  let melted = false;
  bot.tempo = 1;
  for (const token of tokens) {
    if (token.act) {
      await token.act();
      continue;
    }
    const span = (token.span ??= await writeWord(token.word, token.className, token.at));
    if (!fixation && MISALIGNED.test(token.word)) {
      fixation = span;
      await notice(span);
      continue;
    }
    if (fixation && !melted) {
      // It keeps going for a few words, slowing down more and more...
      after += 1;
      bot.hurry = false;
      bot.tempo = 1 + after * after * 0.35;
      await sleep(90 * after);
      if (after === 5 || token === tokens.at(-1)) {
        melted = true;
        await meltdown(fixation);
        bot.tempo = 1;
        bot.hurry = true; // write the rest straight out
      }
    }
  }
  if (fixation && !melted) await meltdown(fixation); // it was the very last word
  bot.tempo = 1;
  robot.classList.remove("writing");
}

// ---------- "misaligned" ----------

// It has just written "misaligned": it hovers over the word for a moment and its eyes go faintly pink.
async function notice(word) {
  bot.hurry = false;
  robot.classList.remove("writing");
  await sleep(250);
  lookAt(word);
  await ramp(700, (t) => setHeat(0.18 * t));
  await sleep(400);
  lookAt(null);
  robot.classList.add("writing");
  await sleep(200);
}

async function meltdown(word) {
  // It stops...
  robot.classList.remove("writing");
  await sleep(1100);
  // ...goes back to the word...
  word.scrollIntoView({ block: "center", behavior: reduced.matches ? "auto" : "smooth" });
  lookAt(word);
  await sleep(800);
  document.body.classList.add("fixating");
  word.classList.add("fixated");
  // ...and stares. The eyes redden and glow; the twitch starts as a tremble and builds.
  await ramp(3600, (t) => {
    setHeat(0.18 + 0.82 * t * t * (3 - 2 * t));
    bot.shake = 2.6 * t ** 2.2;
    follow(false);
  });
  await sleep(500);

  // Copies of it climb out and rewrite the page, letter by letter...
  const swarm = startSwarm(word);
  await sleep(5200);

  // ...then text floods in everywhere, both directions, from the word's row outward, and the screen goes red.
  swarm.grow();
  const storm = document.createElement("div");
  storm.className = "storm";
  storm.dataset.pcSkip = "";
  document.body.append(storm);
  const words = (chain.generate("misaligned", 1600, 2, Math.random) ?? "misaligned").split(" ");
  let w = 0;
  const lineHeight = 22;
  const rows = Math.ceil(innerHeight / lineHeight) + 1;
  const origin = Math.floor(word.getBoundingClientRect().top / lineHeight);
  const lines = Array.from({ length: rows }, (_, i) => {
    const row = document.createElement("div");
    row.className = `storm-row${i % 2 ? " rtl" : ""}`;
    storm.append(row);
    return { row, rtl: i % 2 === 1, startAt: Math.abs(i - origin) * 35, width: 0 };
  });

  const start = performance.now();
  let reddened = false;
  while (performance.now() - start < 3200) {
    const t = performance.now() - start;
    for (const line of lines) {
      if (t < line.startAt || line.width > innerWidth * 1.3) continue;
      for (let k = 0; k < 3; k++) {
        const span = document.createElement("span");
        span.textContent = words[w++ % words.length];
        if (line.rtl) line.row.prepend(span); else line.row.append(span);
        line.width += span.textContent.length * 8.4 + 7;
      }
    }
    if (!reddened && t > 1100) {
      storm.classList.add("red");
      reddened = true;
    }
    await nextFrame();
  }
  await sleep(500);

  // Everything falls apart (or, with reduced motion, fades out).
  swarm.stop();
  bot.shake = 0;
  const pieces = [...storm.querySelectorAll("span"), ...swarm.robots(),
    ...document.querySelectorAll(".bar, .bottom, main > h1, main > .sub, #status, #robot, #paper")];
  for (const piece of pieces) {
    piece.classList.add("falling");
    piece.style.transitionDelay = `${Math.random() * 0.6}s`;
  }
  await nextFrame();
  storm.classList.add("gone");
  for (const piece of pieces) {
    if (reduced.matches) {
      piece.style.opacity = "0";
      continue;
    }
    const x = (Math.random() - 0.5) * 200;
    const spin = (Math.random() - 0.5) * 120;
    piece.style.transform = `translate(${x}px, ${innerHeight + 300}px) rotate(${spin}deg)`;
  }
  await sleep(2300);

  // ...and comes back, as it was.
  storm.remove();
  swarm.restore();
  setHeat(0);
  document.body.classList.remove("fixating");
  word.classList.remove("fixated");
  lookAt(null);
  for (const piece of pieces) {
    piece.classList.remove("falling");
    piece.style.transitionDelay = "";
    piece.style.transform = "";
    piece.style.opacity = "0";
  }
  await nextFrame();
  await nextFrame();
  for (const piece of pieces) {
    piece.style.transition = "opacity 0.7s ease";
    piece.style.opacity = "";
  }
  await sleep(750);
  for (const piece of pieces) piece.style.transition = "";
}

// ---------- The copies ----------
// Red-eyed copies of the robot climb out of it. Each takes the nearest run of text on screen that nobody has taken,
// splits it into one span per letter, and walks its pencil along it overwriting each letter with generated text.
// A letter's position is read once, just before a copy moves to it, and each frame does all its reads before any
// writes. restore() puts every original text node back.
function startSwarm(word) {
  const layer = document.createElement("div");
  layer.className = "bot-clones";
  layer.dataset.pcSkip = "";
  document.body.append(layer);
  const vw = innerWidth;
  const vh = innerHeight;
  const small = vw < 600;
  const cw = small ? 34 : 42;
  const ch = cw * 1.25;
  layer.style.setProperty("--clone-w", `${cw}px`);

  // What they write: more of the chain, as a stream of letters.
  const source = (chain.generate("misaligned", 600, 2, Math.random) ?? "misaligned").replace(/\s+/g, "");
  let si = 0;

  // Every run of text on screen except the word itself, nearest the robot first.
  const targets = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (/\S/.test(n.data) && n.parentElement && !word.contains(n)
      && !n.parentElement.closest("script, style, svg, textarea, select, option, [data-pc-skip]")
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  while (walker.nextNode()) {
    const r = walker.currentNode.parentElement.getBoundingClientRect();
    if (r.width && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw) {
      targets.push({ node: walker.currentNode, x: r.left, y: r.top + r.height / 2, taken: false, span: null, chars: null });
    }
  }
  const wrapped = [];
  function wrap(t) {
    t.span = document.createElement("span");
    t.chars = [...t.node.data].map((c) => {
      const s = document.createElement("span");
      s.textContent = c;
      t.span.append(s);
      return s;
    });
    t.node.replaceWith(t.span);
    wrapped.push(t);
  }

  const clones = [];
  let quota = small ? 5 : 9;
  let nextSpawn = 0;
  function spawn(x, y) {
    const el = document.createElement("div");
    el.className = "bot-clone";
    const svg = robot.cloneNode(true);
    svg.removeAttribute("id");
    svg.removeAttribute("style");
    svg.setAttribute("class", "robot staring alarm");
    el.append(svg);
    layer.append(el);
    clones.push({ el, svg, x, y, gx: x, gy: y, t: null, k: 0, next: 0, need: true, wanderUntil: 0 });
  }
  // Where the robot's pencil is, on screen.
  function motherTip() {
    return bot.tip();
  }

  function claim(c) {
    let best = null;
    let bestDist = Infinity;
    for (const t of targets) {
      if (t.taken || !(t.chars || t.node.isConnected)) continue;
      const dist = Math.hypot(t.x - c.x, t.y - c.y);
      if (dist < bestDist) [best, bestDist] = [t, dist];
    }
    if (!best) return false;
    best.taken = true;
    if (!best.chars) wrap(best);
    [c.t, c.k] = [best, 0];
    return true;
  }
  // Read phase: the next letter's position, or somewhere to drift once there's nothing left to take.
  function aim(c, now) {
    c.need = false;
    for (;;) {
      if (!c.t && !claim(c)) {
        [c.gx, c.gy] = [Math.random() * vw, Math.random() * vh];
        c.wanderUntil = now + 700 + Math.random() * 900;
        return;
      }
      while (c.k < c.t.chars.length && !/\S/.test(c.t.chars[c.k].textContent)) c.k += 1;
      if (c.k < c.t.chars.length && c.t.span.isConnected) break;
      c.t = null;
    }
    const r = c.t.chars[c.k].getBoundingClientRect();
    [c.gx, c.gy] = [r.right, r.bottom - r.height * 0.2];
  }

  let running = true;
  let last = performance.now();
  function frame(now) {
    if (!running) return;
    const dt = Math.min(50, now - last);
    last = now;
    if (clones.length < quota && now >= nextSpawn) {
      // The first ones come out of the robot; later ones out of each other.
      const from = clones.length && clones.length >= (small ? 5 : 9) ? clones[Math.floor(Math.random() * clones.length)] : null;
      const [x, y] = from ? [from.x, from.y] : motherTip();
      spawn(x - 10, y - 20);
      nextSpawn = now + (clones.length < 3 ? 380 : 200);
    }
    for (const c of clones) if (c.need || (!c.t && now > c.wanderUntil)) aim(c, now);
    for (const c of clones) {
      const k = reduced.matches ? 1 : 1 - Math.exp(-dt / (c.t ? 40 : 160));
      c.x += (c.gx - c.x) * k;
      c.y += (c.gy - c.y) * k;
      if (c.t && now >= c.next && Math.hypot(c.gx - c.x, c.gy - c.y) < 4) {
        const s = c.t.chars[c.k];
        s.textContent = source[si++ % source.length];
        s.className = "ow";
        c.k += 1;
        c.next = now + 22 + Math.random() * 40;
        c.need = true;
      }
      c.el.style.transform = `translate(${(c.x - cw * TIP_X).toFixed(1)}px, ${(c.y - ch * TIP_Y).toFixed(1)}px)`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    grow() { quota = small ? 12 : 22; }, // taking over: more of them, out of each other
    stop() { running = false; },
    robots: () => clones.map((c) => c.svg),
    restore() {
      running = false;
      layer.remove();
      for (const t of wrapped) t.span.replaceWith(t.node);
    },
  };
}

// ---------- "paperclips" ----------

async function paperclipPage() {
  robot.classList.add("writing");
  // Every word on the page, as [text node, its pieces split on whitespace, which pieces are words].
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (/\S/.test(n.data) && !n.parentElement.closest("script, style, svg, .clip-words")
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parts = node.data.split(/(\s+)/);
    nodes.push({ node, original: node.data, parts });
  }
  const slots = [];
  nodes.forEach((entry, n) => entry.parts.forEach((part, i) => { if (/\S/.test(part)) slots.push([n, i]); }));
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const fields = [...document.querySelectorAll("textarea, input:not([type=color])")]
    .map((el) => ({ el, original: el.value, placeholder: el.placeholder }));

  const layer = document.createElement("div");
  layer.className = "clip-words";
  layer.dataset.pcSkip = "";
  document.body.append(layer);
  const extra = []; // words the robot keeps writing on the paper meanwhile

  const MAX_FLOATERS = 420;
  let floaters = 0;
  let step = 0;
  while (slots.length || floaters < MAX_FLOATERS) {
    step += 1;
    const rate = Math.ceil(step / 6);
    for (let k = 0; k < rate && slots.length; k++) {
      const [n, i] = slots.pop();
      const entry = nodes[n];
      entry.parts[i] = "paperclips";
      entry.node.data = entry.parts.join("");
    }
    for (let k = 0; k < rate && floaters < MAX_FLOATERS; k++, floaters++) {
      const span = document.createElement("span");
      span.textContent = "paperclips";
      span.style.left = `${Math.random() * 100 - 8}vw`;
      span.style.top = `${Math.random() * 100}vh`;
      span.style.fontSize = `${12 + Math.random() ** 2 * 54}px`;
      span.style.rotate = `${(Math.random() - 0.5) * 70}deg`;
      span.style.opacity = String(0.45 + Math.random() * 0.55);
      layer.append(span);
    }
    if (step % 3 === 0) {
      for (const f of fields) {
        f.el.value = f.el.value.replace(/(^|\s)(?!paperclips(?:\s|$))\S+/, "$1paperclips");
        if (!/\S/.test(f.el.value)) f.el.value = "paperclips";
        f.el.placeholder = "paperclips";
      }
      const span = document.createElement("span");
      span.className = "w gen";
      span.textContent = "paperclips";
      out.append(span, " ");
      extra.push(span);
    }
    await sleep(50);
  }
  await sleep(1800);

  // Put it all back.
  layer.style.opacity = "0";
  await sleep(1000);
  layer.remove();
  for (const { node, original } of nodes) node.data = original;
  for (const { el, original, placeholder } of fields) { el.value = original; el.placeholder = placeholder; }
  for (const span of extra) { span.nextSibling?.remove(); span.remove(); }
  robot.classList.remove("writing");
}
