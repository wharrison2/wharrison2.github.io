// Fun mode: now and then a paperclip bounces along the bottom of the screen, settles, and fades away.
// Clicking a clip duplicates it. After 5 clicks, a little red-eyed Markov robot turns up and starts eating the
// page: each letter it pokes pops out as a paperclip and falls. After 8 clicks (or a while), robots bud smaller
// copies of themselves. Once every letter on screen is gone, they tear the rest of the screen away in holes,
// every scrap on screen of which becomes paperclips piling up at the bottom; the rest of the document, above and below, is torn away unseen. Then they line up, and the first robot zaps
// each of the others into paperclips. Left alone, it looks around, frowns, and zaps itself in the chest. A shutdown button appears but runs from the cursor;
// click it and everything falls away. At the end (either way) every paperclip drops off the bottom of the screen, and then the page comes back. A few seconds into the tearing, the first robot starts burning the button with
// its eyes (another one, if it's right next to it), which takes over a second.

import * as sfx from "./sfx.js";

const CLIP_URL = new URL("./clip.svg", import.meta.url).href;
const REPLACE_AT = 5;
const SWARM_AT = 8;
const GRAVITY = 0.45;
const CLIP_W = 14, CLIP_H = 36;
const INERTIA = (CLIP_W ** 2 + CLIP_H ** 2) / 12; // per unit mass, as a flat rectangle
const RESTITUTION = 0.55;
const FRICTION = 0.15; // how much a landing can scrub off sideways speed
const SLIDE = 0.93; // per-frame slowdown once lying flat
const CONTACT_DAMPING = 0.8;
const FLOOR_GAP = 4;
const RAD = Math.PI / 180;
const MAX_LIVE_CLIPS = 80;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const layer = Object.assign(document.createElement("div"), { className: "pc-layer" });
const pageLayer = Object.assign(document.createElement("div"), { className: "pc-page-layer" });
layer.dataset.pcSkip = pageLayer.dataset.pcSkip = "";
document.body.append(pageLayer, layer);

let clicks = 0;
let phase = "idle"; // idle → replacing → swarming → finale → ending
let lastPoke = 0;
const live = []; // clips with physics: { el, x, y, vx, vy, angle, va, onFloor, entered, settledAt, falling }

// ---------- Bouncing clips ----------

function spawn(x, y, vx, vy) {
  if (live.length >= MAX_LIVE_CLIPS) return null;
  const el = document.createElement("button");
  el.type = "button";
  el.className = "pc-clip";
  el.setAttribute("aria-label", "Paperclip");
  el.innerHTML = `<img src="${CLIP_URL}" alt="" draggable="false">`;
  const clip = { el, x, y, vx, vy, angle: 90, va: vx * 2, onFloor: false, entered: false, settledAt: 0, falling: false };
  el.addEventListener("click", () => poke(clip));
  layer.append(el);
  live.push(clip);
  run();
  return clip;
}

// Clips only drift by in fun mode, and not while a page holds them off (see hold()).
const root = document.documentElement;
const held = () => root.classList.contains("pc-hold");

function ambient() {
  if (phase === "idle" && live.length === 0 && !document.hidden && root.dataset.mode === "fun" && !held()) {
    const fromLeft = Math.random() < 0.5;
    const speed = 4 + Math.random() * 3;
    spawn(fromLeft ? -30 : innerWidth + 30, innerHeight - 80 - Math.random() * 120,
      fromLeft ? speed : -speed, -3);
  }
  setTimeout(ambient, 25_000 + Math.random() * 30_000);
}

function poke(clip) {
  if (phase === "ending") return;
  clicks += 1;
  lastPoke = performance.now();
  clip.vy = -5 - Math.random() * 3;
  clip.vx += (Math.random() - 0.5) * 4;
  clip.va += (Math.random() - 0.5) * 20;
  clip.onFloor = false;
  sfx.ping();
  spawn(clip.x, clip.y - 4, (Math.random() - 0.5) * 9, -7 - Math.random() * 4);
  if (clicks >= REPLACE_AT && phase === "idle" && !held()) startReplacing();
  if (clicks >= SWARM_AT && phase === "replacing") startSwarm();
}

let running = false;
function run() {
  if (running) return;
  running = true;
  requestAnimationFrame(step);
}

const flatAngle = (angle) => 90 + 180 * Math.round((angle - 90) / 180);

// The clip's lowest point relative to its centre. It's treated as a capsule, since the wire ends are round and
// a clip can't stand on one. That's the bottom of the lower end, or the middle of the side when it's lying flat.
function lowestPoint(angle) {
  const s = Math.sin(angle * RAD), co = Math.cos(angle * RAD);
  const half = (CLIP_H - CLIP_W) / 2, k = co >= 0 ? 1 : -1;
  const y = k * half * co + CLIP_W / 2;
  return 2 * half * Math.abs(co) < 1.5 ? { x: 0, y } : { x: -k * half * s, y };
}

// An impulse at the contact point, so a flat landing hops straight up and landing on an end turns some of the
// fall into spin. Slow contacts don't bounce at all: that's what lets a clip on its end pivot and topple over.
function bounce(c, p) {
  const w = c.va * RAD;
  const vpy = c.vy + w * p.x;
  if (vpy <= 0) return;
  const e = vpy > 1 ? RESTITUTION : 0;
  const j = -(1 + e) * vpy / (1 + p.x * p.x / INERTIA);
  const vpx = c.vx - w * p.y;
  const limit = FRICTION * -j;
  const jt = Math.max(-limit, Math.min(limit, -vpx / (1 + p.y * p.y / INERTIA)));
  c.vy += j;
  c.vx += jt;
  c.va += (p.x * j - p.y * jt) / INERTIA / RAD;
  c.va *= CONTACT_DAMPING; // bent wire soaks up some of every knock, or it rocks end to end forever
}

function step(now) {
  for (let i = live.length - 1; i >= 0; i--) {
    const c = live[i];
    // The pile is a wall sideways, not a ramp: a clip can't slide or bounce into a spot where it's higher than the
    // clip's lowest point, so nothing gets carried up the heap.
    const ox = c.x, bottom = c.y + (c.onFloor ? CLIP_W / 2 : lowestPoint(c.angle).y);
    c.vy += GRAVITY;
    c.x += c.vx;
    c.y += c.vy;
    c.angle += c.va;
    if (!c.falling && c.onFloor && surfaceAt(c.x) - FLOOR_GAP < bottom - 2) {
      c.x = ox;
      c.vx = -c.vx * 0.3;
    }
    const ground = surfaceAt(c.x) - FLOOR_GAP; // the floor, or the top of the pile
    if (!c.falling) {
      if (c.onFloor) {
        // Lying still. If the pile builds up around it, it stays where it is, half buried, rather than riding up.
        c.y -= c.vy;
        c.vy = 0;
        c.vx *= SLIDE;
        if (ground - CLIP_W / 2 > c.y + 3) c.onFloor = false; // the ground fell away: it drops again
        else if (ground - CLIP_W / 2 > c.y) c.y = ground - CLIP_W / 2;
      } else {
        const p = lowestPoint(c.angle);
        // If the pile has risen round it, the ground it stands on is where its lowest point already was, not the top
        // of the pile, so it isn't lifted out; it still bounces, pivots and topples over as usual.
        const floor = c.vy >= 0 ? Math.max(ground, c.y - c.vy + p.y) : ground;
        if (c.y + p.y > floor) {
          c.y = floor - p.y;
          if (c.vy > 2.5) sfx.clink(c.vy / 10);
          bounce(c, p);
          // Nearly flat and nearly still: lie down.
          const flat = flatAngle(c.angle);
          if (Math.abs(c.angle - flat) < 5 && Math.abs(c.va) < 1.5 && Math.abs(c.vy) < 1) {
            Object.assign(c, { angle: flat, va: 0, vy: 0, y: floor - CLIP_W / 2, onFloor: true });
          }
        }
      }
      if (c.x > 20 && c.x < innerWidth - 20) c.entered = true;
      if (c.entered && (c.x < 10 || c.x > innerWidth - 10)) {
        c.vx = -c.vx * 0.6;
        c.x = Math.min(Math.max(c.x, 10), innerWidth - 10);
      }
      const resting = c.onFloor && Math.abs(c.vx) < 0.05;
      if (resting && !c.settledAt) c.settledAt = now;
      if (!resting) c.settledAt = 0;
      // A settled clip fades after a while (15s), unless someone has been playing with them.
      if (phase === "idle" && c.settledAt && now - c.settledAt > 15000 && now - lastPoke > 15000) {
        remove(c, i, true);
        continue;
      }
    } else if (c.y > innerHeight + 80) {
      remove(c, i, false);
      continue;
    }
    c.el.style.transform =
      `translate(${c.x - CLIP_W / 2}px, ${c.y - CLIP_H / 2}px) rotate(${c.angle}deg)`;
  }
  if (live.length) requestAnimationFrame(step);
  else running = false;
}

function remove(clip, index, fade) {
  live.splice(index, 1);
  if (!fade) return clip.el.remove();
  clip.el.style.opacity = "0";
  setTimeout(() => clip.el.remove(), 1000);
}

// ---------- Robots ----------

// A small copy of the Markov robot, red-eyed. It touches the page with its pencil tip.
const BOT_SVG = `<svg viewBox="0 0 120 150" aria-hidden="true">
  <line class="antenna" x1="60" y1="10" x2="60" y2="24"/><circle class="bulb" cx="60" cy="9" r="5"/>
  <rect class="head" x="24" y="24" width="72" height="54" rx="16"/><rect class="face" x="33" y="34" width="54" height="34" rx="10"/>
  <ellipse class="eye" cx="49" cy="50" rx="6" ry="7"/><ellipse class="eye" cx="71" cy="50" rx="6" ry="7"/>
  <path class="mouth" d="M53 62 L67 62"/>
  <rect class="neck" x="54" y="78" width="12" height="6" rx="2"/><rect class="body" x="30" y="84" width="60" height="46" rx="14"/>
  <circle class="button" cx="48" cy="102" r="4"/><circle class="button" cx="60" cy="102" r="4"/>
  <rect class="leg" x="40" y="130" width="12" height="14" rx="5"/><rect class="leg" x="68" y="130" width="12" height="14" rx="5"/>
  <g class="arm"><path class="limb" d="M88 98 Q102 102 106 116"/>
    <g class="pencil"><rect x="101" y="110" width="9" height="26" rx="2"/><path d="M101 136 L105.5 146 L110 136 Z"/></g></g>
</svg>`;
const BOT_W = 48; // the first robot; each clone is a quarter smaller
const TIP = { x: 105.5 / 120, y: 146 / 150 };
const MAX_BOTS = 16;
const SVG_NS = "http://www.w3.org/2000/svg";

const wrapped = []; // { node, span, chars: [char spans], left: Set of indexes not yet eaten }
let textTargets = [];
let bots = []; // { el, x, y, scale, w, h, goal, run, tear, waitUntil, hop, flip, nextClone, hunting, lined }
let replaceStarted = 0;
let offscreenTorn = false; // the rest of the document (outside the window) has been torn away
let tearStarted = 0; // when the last letter on screen went
let ended = false;
let visibleText = []; // targets with letters still on screen

const skip = (el) => el.closest("[data-pc-skip], script, style, noscript, textarea, select, option, svg");
// Positions are measured once and kept in document coordinates: eating a letter only changes its colour, so the
// layout never moves, and reading it again for every letter is what starves everything else of time.
const boxOnScreen = (b) => b.bottom > scrollY && b.right > scrollX && b.top < scrollY + innerHeight && b.left < scrollX + innerWidth;
const pointOnScreen = (p) => p.w > 0 && boxOnScreen({ left: p.x, right: p.x, top: p.y, bottom: p.y });
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function collectTargets() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (/\S/.test(n.data) && !skip(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  textTargets = [];
  while (walker.nextNode()) textTargets.push({ node: walker.currentNode, box: null }); // measured in resizeCanvas
}

function measure(t) {
  if (t.chars) {
    t.pos = t.chars.map((c) => {
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2 + scrollX, y: r.top + r.height / 2 + scrollY, w: r.width, h: r.height };
    });
    const seen = t.pos.filter((q) => q.w > 0);
    t.box = seen.length
      ? { left: Math.min(...seen.map((q) => q.x)), right: Math.max(...seen.map((q) => q.x)),
        top: Math.min(...seen.map((q) => q.y)), bottom: Math.max(...seen.map((q) => q.y)) }
      : { left: 0, right: -1, top: 0, bottom: -1 };
  } else {
    const r = t.node.parentElement?.getBoundingClientRect() ?? { width: 0 };
    t.box = r.width ? { left: r.left + scrollX, right: r.right + scrollX, top: r.top + scrollY, bottom: r.bottom + scrollY }
      : { left: 0, right: -1, top: 0, bottom: -1 };
  }
}

function wrap(t) {
  // One span per character, so letters can go one at a time.
  const span = document.createElement("span");
  span.className = "pc-text";
  const chars = [];
  const left = new Set();
  for (const ch of t.node.data) {
    const c = document.createElement("span");
    c.textContent = ch;
    if (/\S/.test(ch)) left.add(chars.length);
    chars.push(c);
    span.append(c);
  }
  Object.assign(t, { span, chars, left });
  t.node.replaceWith(span);
  wrapped.push(t);
  measure(t);
  return t;
}

// Robots eat all the text still readable on screen before they tear anything.
function refreshText() {
  textTargets = textTargets.filter((t) => (t.chars ? t.left.size : t.node.isConnected));
  visibleText = textTargets.filter((t) => {
    if (!t.chars) return boxOnScreen(t.box);
    for (const k of t.left) if (pointOnScreen(t.pos[k])) return true;
    return false;
  });
}

function spawnBot(x, y, scale) {
  const el = document.createElement("div");
  el.className = "pc-bot";
  el.innerHTML = BOT_SVG;
  sfx.blip();
  const w = BOT_W * scale;
  el.style.width = `${w}px`;
  layer.append(el);
  const bot = {
    el, x, y, scale, w, h: w * 1.25, goal: null, run: null, tear: null,
    waitUntil: performance.now() + 400, hop: 0, flip: false, nextClone: performance.now() + 2000 + Math.random() * 2500,
  };
  bots.push(bot);
  return bot;
}

// A long run of letters to eat along one line, starting from the nearest one on screen, in the nearest text
// no other robot is already eating, so the page goes in tidy streaks rather than scattered bites.
function pickRun(bot) {
  const taken = new Set(bots.map((b) => b !== bot && b.run?.entry).filter(Boolean));
  const near = visibleText.map((entry) => {
    const b = entry.box;
    const dx = Math.max(b.left - scrollX - bot.x, 0, bot.x - (b.right - scrollX));
    const dy = Math.max(b.top - scrollY - bot.y, 0, bot.y - (b.bottom - scrollY));
    return { entry, d: Math.hypot(dx, dy) + (taken.has(entry) ? 400 : 0) };
  }).sort((a, b) => a.d - b.d);
  for (const { entry } of near.slice(0, 6)) {
    if (!entry.chars) {
      if (!entry.node.isConnected) continue;
      wrap(entry);
    }
    if (!entry.left.size || !boxOnScreen(entry.box)) continue;
    let best = -1, bestDist = Infinity;
    for (const k of entry.left) {
      const q = entry.pos[k];
      if (!pointOnScreen(q)) continue;
      const d = Math.hypot(q.x - scrollX - bot.x, q.y - scrollY - bot.y);
      if (d < bestDist) { bestDist = d; best = k; }
    }
    if (best >= 0) return { entry, k: best, n: 30 + Math.floor(Math.random() * 40) };
  }
  return null;
}

function letterGoal(run) {
  const q = run.entry.pos[run.k];
  return pointOnScreen(q) && !isTorn(q.x, q.y) ? { x: q.x - scrollX, y: q.y - scrollY, act: "eat" } : null;
}

function eatLetter(entry, k) {
  const q = entry.pos[k];
  entry.left.delete(k);
  entry.chars[k].classList.add("pc-gone");
  if (!q.w) return;
  sfx.nibble();
  popClip(q.x - scrollX, q.y - scrollY, clamp(q.h * 1.1, 14, 30), q.w * q.h,
    (Math.random() - 0.5) * 1.5, -2 - Math.random() * 2.5);
}

function pickTearSpot(bot) {
  // Somewhere still whole, near the robot, so the holes spread outward from where it's been. Near the end,
  // each robot is sent to the nearest scrap that no other robot is already on.
  const endgame = openCount < ENDGAME;
  const claimed = endgame ? bots.flatMap((b) => {
    if (b === bot) return [];
    if (b.tear) return [{ x: b.tear.cx - scrollX, y: b.tear.cy - scrollY }];
    return b.goal?.act === "tear" ? [b.goal] : [];
  }) : [];
  let best = -1, bestDist = Infinity;
  for (let n = 0; n < (endgame ? openCount : 24); n++) {
    const i = endgame ? openDots[n] : openDots[Math.floor(Math.random() * openCount)];
    const x = dotX(i), y = dotY(i);
    if (claimed.some((c) => Math.hypot(c.x - x, c.y - y) < 40)) continue;
    const d = Math.hypot(x - bot.x, y - bot.y) - (endgame ? 0 : 1.5 * crowd(bot, x, y));
    if (d < bestDist) { bestDist = d; best = i; }
  }
  if (best < 0) best = openDots[Math.floor(Math.random() * openCount)];
  return { x: clamp(dotX(best), 0, innerWidth), y: clamp(dotY(best), 0, innerHeight), act: "tear" };
}

// How far (up to 300px) the nearest other robot, or where it's headed, is from x, y: the swarm spreads out.
function crowd(bot, x, y) {
  let near = 300;
  for (const b of bots) {
    if (b === bot) continue;
    near = Math.min(near, Math.hypot(b.x - x, b.y - y), b.goal ? Math.hypot(b.goal.x - x, b.goal.y - y) : 300);
  }
  return near;
}

function think(bot, now) {
  bot.run = null;
  if (visibleText.length) {
    const run = pickRun(bot);
    const goal = run && letterGoal(run);
    if (goal) { bot.run = run; bot.goal = goal; return; }
  } else if (zapsLeft()) {
    const goal = pickZap(bot);
    if (goal) { bot.goal = goal; return; }
  } else if (phase === "swarming" && openCount) {
    bot.goal = pickTearSpot(bot);
    return;
  }
  let wander = null;
  for (let n = 0; n < 6; n++) {
    const x = 40 + Math.random() * (innerWidth - 80), y = 60 + Math.random() * (innerHeight - 120);
    if (!wander || crowd(bot, x, y) > wander.room) wander = { x, y, room: crowd(bot, x, y) };
  }
  bot.goal = { x: wander.x, y: wander.y, act: "wander" };
}

function arrive(bot, now) {
  const act = bot.goal.act;
  bot.zapTarget = bot.goal.o;
  bot.goal = null;
  if (act === "line") {
    bot.lined = true;
    bot.flip = bot !== finale.leader; // everyone faces the first robot
    return;
  }
  if (act === "zap") {
    startZap(bot, bot.zapTarget, now);
    return;
  }
  if (act === "tear") {
    bot.tear = startTear(bot, now);
    bot.el.classList.add("tearing");
    return;
  }
  if (act !== "eat") return;
  const run = bot.run;
  if (run.entry.left.has(run.k)) eatLetter(run.entry, run.k);
  bot.waitUntil = now + 40 + 50 * bot.scale;
  // Carry on along the line, over spaces.
  let next = run.k + 1;
  while (next < run.entry.chars.length && !run.entry.left.has(next) && next - run.k < 8) next++;
  if (--run.n > 0 && run.entry.left.has(next)) {
    run.k = next;
    bot.goal = letterGoal(run);
  }
  if (!bot.goal) bot.run = null;
}

function updateBot(bot, now) {
  if (bot.zap) {
    const beam = beams.find((b) => b.bot === bot);
    if (beam) beam.from = eyes(bot);
    if (now >= bot.zap.until) {
      finishZap(bot);
      bot.waitUntil = now + 120;
    }
  } else if (bot.tear) {
    growTear(bot.tear);
    if (bot.tear.h >= 1) {
      bot.tear = null;
      bot.el.classList.remove("tearing");
      bot.waitUntil = now + 150;
    }
  } else if (now >= bot.waitUntil) {
    if (bot.hunting && shutdown) {
      laserButton(bot, now);
      return place_(bot);
    }
    if (!bot.goal && phase !== "finale") think(bot, now);
    const dx = bot.goal ? bot.goal.x - bot.x : 0, dy = bot.goal ? bot.goal.y - bot.y : 0, dist = Math.hypot(dx, dy);
    const speed = 2.5 + 3 * bot.scale;
    if (dist > speed) {
      bot.x += (dx / dist) * speed;
      bot.y += (dy / dist) * speed;
      bot.hop += 0.3;
      if (Math.abs(dx) > 2) bot.flip = dx < 0;
    } else if (bot.goal) {
      bot.x = bot.goal.x;
      bot.y = bot.goal.y;
      bot.hop = 0;
      arrive(bot, now);
    }
  }
  // Each robot buds smaller copies of itself.
  if (phase === "swarming" && now > bot.nextClone && bots.length < MAX_BOTS && bot.scale > 0.4) {
    bot.nextClone = now + 3000 + Math.random() * 3000;
    const kid = spawnBot(bot.x, bot.y, bot.scale * 0.75);
    kid.waitUntil = now + 200; // it hops off somewhere roomy first
    think(kid, now);
  }
  place_(bot);
}

function place_(bot) {
  bot.el.classList.toggle("eating", !!bot.run);
  const bob = -Math.abs(Math.sin(bot.hop)) * 7 * bot.scale;
  const left = bot.x - (bot.flip ? 1 - TIP.x : TIP.x) * bot.w, top = bot.y - TIP.y * bot.h + bob;
  bot.el.style.transform = `translate(${left}px, ${top}px)${bot.flip ? " scaleX(-1)" : ""}`;
}

// ---------- Zapping ----------

// Once the letters are gone, everything on the page that isn't its background (boxes, pictures, buttons, modals, the
// page's own robots) is zapped into paperclips by a robot's eyes, innermost first, before any tearing starts.
const objects = []; // { el, kids (the objects right inside it), by (the robot on its way to zap it), gone }
let beamsShown = false;
const VISUAL_TAGS = new Set(["IMG", "SVG", "CANVAS", "VIDEO", "IFRAME", "PICTURE", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "HR"]);
const ZAP_MS = 420;

const opaque = (c) => c && c !== "transparent" && !/rgba?\([^)]*,\s*0\)$|\/\s*0\)$/.test(c);
function looksLikeSomething(el, st, page) {
  if (VISUAL_TAGS.has(el.tagName.toUpperCase())) return true;
  if (st.backgroundImage !== "none" || st.boxShadow !== "none") return true;
  if (opaque(st.backgroundColor) && st.backgroundColor !== page) return true;
  return ["Top", "Right", "Bottom", "Left"].some((side) =>
    parseFloat(st[`border${side}Width`]) > 0 && st[`border${side}Style`] !== "none" && opaque(st[`border${side}Color`]));
}

function collectObjects() {
  objects.length = 0;
  const page = getComputedStyle(document.body).backgroundColor;
  const found = new Map();
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest(".pc-layer, .pc-page-layer, .pc-shutdown, script, style, noscript, template")) continue;
    if (el.ownerSVGElement) continue; // the parts of a drawing go with the drawing
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || +st.opacity === 0) continue;
    if (!looksLikeSomething(el, st, page)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) continue;
    // Something as big as the window is the background, which gets torn instead.
    if (r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9) continue;
    const o = { el, kids: [], by: null, gone: false };
    found.set(el, o);
    objects.push(o);
  }
  for (const o of objects) {
    for (let a = o.el.parentElement; a && a !== document.body; a = a.parentElement) {
      const p = found.get(a);
      if (p) { p.kids.push(o); break; }
    }
  }
}

function objectBox(o) {
  const r = o.el.getBoundingClientRect();
  return r.width && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth ? r : null;
}
// Objects on screen with nothing left on screen inside them.
const zappable = () => objects.filter((o) => !o.gone && objectBox(o) && !o.kids.some((k) => !k.gone && objectBox(k)));
// Another robot is on its way to it, or zapping it.
const claimed = (o, bot) => o.by && o.by !== bot && bots.includes(o.by) && (o.by.goal?.o === o || o.by.zap?.o === o);
const zapsLeft = () => objects.some((o) => !o.gone && objectBox(o));

function pickZap(bot) {
  let best = null, bestDist = Infinity;
  for (const o of zappable()) {
    if (claimed(o, bot)) continue;
    const r = objectBox(o);
    const d = Math.hypot(clamp(bot.x, r.left, r.right) - bot.x, clamp(bot.y, r.top, r.bottom) - bot.y) - Math.min(r.width * r.height, 40_000) / 400;
    if (d < bestDist) { bestDist = d; best = o; }
  }
  if (!best) return null;
  best.by = bot;
  // It stands a little way off, below or beside it, and looks at it.
  const r = objectBox(best);
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const a = Math.random() * Math.PI;
  const reach = 70 + Math.min(r.width, r.height) / 2;
  return { x: clamp(cx + Math.cos(a) * reach, 20, innerWidth - 20), y: clamp(cy + Math.sin(a) * reach, 60, innerHeight - 10), act: "zap", o: best };
}

function startZap(bot, o, now) {
  const r = objectBox(o);
  if (!r || o.gone) { o.by = null; return; }
  bot.zap = { o, until: now + ZAP_MS };
  bot.flip = r.left + r.width / 2 < bot.x;
  bot.el.classList.add("tearing");
  beams.push({ from: eyes(bot), to: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, frames: Math.round(ZAP_MS / 16), bot });
  sfx.zap();
}

function finishZap(bot) {
  const { o } = bot.zap;
  bot.zap = null;
  bot.el.classList.remove("tearing");
  const r = objectBox(o);
  o.gone = true;
  o.by = null;
  o.el.classList.add("pc-zapped");
  if (!r) return;
  const area = r.width * r.height, n = Math.round(clamp(area / 1500, 4, 70));
  for (let k = 0; k < n; k++) {
    const x = r.left + Math.random() * r.width, y = r.top + Math.random() * r.height;
    popClip(x, y, 16 + Math.random() * 14, area / n, ((x - r.left) / r.width - 0.5) * 5, -2 - Math.random() * 4);
  }
}

// ---------- Tearing ----------

// Torn holes are drawn over the page: a light ragged rim around a dark void. All the rims go under all the
// voids, so where holes overlap only the outer edge shows.
const tears = document.createElementNS(SVG_NS, "svg");
const rims = document.createElementNS(SVG_NS, "g");
const voids = document.createElementNS(SVG_NS, "g");
tears.classList.add("pc-tears");
rims.classList.add("pc-rims");
voids.classList.add("pc-voids");
tears.append(rims, voids);

// The page is tracked as a lattice of points this far apart (document coordinates). A hole tears every point
// inside its outline, and its dark void is drawn a few pixels wider than that outline (see .pc-voids), so where
// every point is torn there is no gap left between holes for the page to show through.
const GROW = 3; // px the torn outline is pushed outwards (the lattice is DOT apart, so this closes the gaps)
const DOT = 5;
const DOT_CLIP = 0.125; // chance a torn point on screen pops out as a clip: one per 200px²
const ENDGAME = 600; // with fewer untorn points than this on screen, robots are sent to what's left
const holes = []; // { cx, cy, R, shape, h, rim, hole }
let lattice = null; // 1 where torn
let latticeCols = 0, latticeRows = 0;
let openDots = new Int32Array(0); // untorn points on screen, as lattice indexes, refreshed every few frames
let openCount = 0;

const dotX = (i) => (i % latticeCols) * DOT - scrollX;
const dotY = (i) => Math.floor(i / latticeCols) * DOT - scrollY;

function isTorn(x, y) {
  const col = Math.round(x / DOT), row = Math.round(y / DOT);
  return col < 0 || row < 0 || col >= latticeCols || row >= latticeRows || lattice[row * latticeCols + col] === 1;
}

function setupLattice() {
  latticeCols = Math.ceil(document.documentElement.scrollWidth / DOT) + 1;
  latticeRows = Math.ceil(document.documentElement.scrollHeight / DOT) + 1;
  lattice = new Uint8Array(latticeCols * latticeRows);
}

function sizeTears() {
  tears.setAttribute("width", document.documentElement.scrollWidth);
  tears.setAttribute("height", document.documentElement.scrollHeight);
}

// A torn-out chunk: a handful of uneven corners at random angles and radii, squashed to a random aspect ratio and
// turned, with every edge broken once or twice into a zigzag. Returns flat [x, y, ...] in units of R (so within about 1).
function tornShape() {
  const k = 6 + Math.floor(Math.random() * 6);
  const angles = Array.from({ length: k }, (_, i) => ((i + Math.random() * 0.8) / k) * Math.PI * 2); // uneven, but never a big gap
  const squash = 0.4 + Math.random() * 0.6, turn = Math.random() * Math.PI;
  const cs = Math.cos(turn), sn = Math.sin(turn);
  const corners = angles.map((a, i) => {
    const rad = (i % 2 ? 0.55 : 0.8) + Math.random() * 0.3;
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad * squash;
    return [x * cs - y * sn, x * sn + y * cs];
  });
  const out = [];
  for (let i = 0; i < k; i++) {
    const [x0, y0] = corners[i], [x1, y1] = corners[(i + 1) % k];
    out.push(x0, y0);
    const len = Math.hypot(x1 - x0, y1 - y0), splits = 1 + Math.floor(Math.random() * 3);
    for (let m = 1; m <= splits; m++) {
      const f = (m + (Math.random() - 0.5) * 0.5) / (splits + 1), off = (Math.random() - 0.5) * len * 0.32;
      out.push(x0 + (x1 - x0) * f - ((y1 - y0) / len) * off, y0 + (y1 - y0) * f + ((x1 - x0) / len) * off);
    }
  }
  return out;
}

function startTear(bot, now) {
  const accel = Math.min(3, 1 + (now - tearStarted) / 15_000);
  const R = (30 + Math.random() * 42) * (0.55 + bot.scale * 0.9) * accel;
  const shape = tornShape();
  const rim = document.createElementNS(SVG_NS, "polygon");
  const hole = document.createElementNS(SVG_NS, "polygon");
  rims.append(rim);
  voids.append(hole);
  const tear = { cx: bot.x + scrollX, cy: bot.y + scrollY, R, shape, h: 0, rim, hole };
  sfx.rip(Math.min(1, R / 120));
  holes.push(tear);
  return tear;
}

function growTear(t) {
  t.h = Math.min(1, t.h + 0.04);
  const r = t.R * (1 - (1 - t.h) ** 2); // rips fast, then slows
  const n = t.shape.length / 2;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  let points = "";
  for (let i = 0; i < n; i++) {
    const dx = t.shape[2 * i] * r, dy = t.shape[2 * i + 1] * r, d = Math.hypot(dx, dy) || 1;
    xs[i] = t.cx + dx + (dx / d) * GROW; // a little past the true outline, so thin strokes still leave no gap
    ys[i] = t.cy + dy + (dy / d) * GROW;
    points += `${xs[i].toFixed(1)},${ys[i].toFixed(1)} `;
  }
  t.rim.setAttribute("points", points);
  t.hole.setAttribute("points", points);
  tearDots(t, xs, ys);
}

// Tear every lattice point inside the hole's outline, row by row. Newly torn points on screen pop out as clips.
function tearDots(t, xs, ys) {
  const n = xs.length;
  let top = Infinity, bottom = -Infinity;
  for (let i = 0; i < n; i++) { top = Math.min(top, ys[i]); bottom = Math.max(bottom, ys[i]); }
  const cuts = [];
  for (let row = Math.max(0, Math.ceil(top / DOT)); row <= Math.min(latticeRows - 1, Math.floor(bottom / DOT)); row++) {
    const y = row * DOT;
    cuts.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      if (ys[i] > y !== ys[j] > y) cuts.push(xs[i] + ((y - ys[i]) * (xs[j] - xs[i])) / (ys[j] - ys[i]));
    }
    cuts.sort((a, b) => a - b);
    for (let c = 0; c + 1 < cuts.length; c += 2) {
      const last = Math.min(latticeCols - 1, Math.floor(cuts[c + 1] / DOT));
      for (let col = Math.max(0, Math.ceil(cuts[c] / DOT)); col <= last; col++) {
        const i = row * latticeCols + col;
        if (lattice[i]) continue;
        lattice[i] = 1;
        if (Math.random() >= DOT_CLIP) continue;
        const x = col * DOT, sx = x - scrollX, sy = y - scrollY;
        if (sx < 0 || sy < 0 || sx > innerWidth || sy > innerHeight) continue;
        const out = Math.atan2(y - t.cy, x - t.cx);
        popClip(sx + (Math.random() - 0.5) * DOT, sy + (Math.random() - 0.5) * DOT, 22 + Math.random() * 12,
          (DOT * DOT) / DOT_CLIP, Math.cos(out) * (1 + Math.random() * 2), -1.5 - Math.random() * 2.5);
      }
    }
  }
}

// The rest of the document, above, below and beside the window, is torn away in one go once the window is bare:
// nobody can see it fall, so it is simply gone, as ragged chunks tiled over it (no clips, no animation).
function tearOffscreen() {
  const W = document.documentElement.scrollWidth, H = document.documentElement.scrollHeight;
  const x0 = scrollX, x1 = scrollX + innerWidth, y0 = scrollY, y1 = scrollY + innerHeight;
  const regions = [[0, 0, W, y0], [0, y1, W, H], [0, y0, x0, y1], [x1, y0, W, y1]];
  const CELL = 280, M = 30, JIT = 18;
  const clampX = (x) => clamp(x, 0, W), clampY = (y) => clamp(y, 0, H);
  for (const [ax, ay, bx, by] of regions) {
    if (bx - ax < 1 || by - ay < 1) continue;
    for (let y = ay; y < by; y += CELL) {
      for (let x = ax; x < bx; x += CELL) {
        // This cell, grown by M each way so neighbours overlap, with a ragged edge that only ever moves inwards by JIT.
        const l = x - M, t = y - M, r = Math.min(x + CELL, bx) + M, b = Math.min(y + CELL, by) + M;
        const pts = [];
        const steps = (a, z) => Math.max(2, Math.round((z - a) / 70));
        const nx = steps(l, r), ny = steps(t, b);
        const j = () => Math.random() * JIT;
        for (let i = 0; i < nx; i++) pts.push([l + ((r - l) * i) / nx, t + j()]);
        for (let i = 0; i < ny; i++) pts.push([r - j(), t + ((b - t) * i) / ny]);
        for (let i = 0; i < nx; i++) pts.push([r - ((r - l) * i) / nx, b - j()]);
        for (let i = 0; i < ny; i++) pts.push([l + j(), b - ((b - t) * i) / ny]);
        const points = pts.map(([px, py]) => `${clampX(px).toFixed(1)},${clampY(py).toFixed(1)}`).join(" ");
        for (const parent of [rims, voids]) {
          const poly = document.createElementNS(SVG_NS, "polygon");
          poly.setAttribute("points", points);
          parent.append(poly);
        }
      }
    }
    for (let row = Math.max(0, Math.floor(ay / DOT)); row <= Math.min(latticeRows - 1, Math.ceil(by / DOT)); row++) {
      for (let col = Math.max(0, Math.floor(ax / DOT)); col <= Math.min(latticeCols - 1, Math.ceil(bx / DOT)); col++) lattice[row * latticeCols + col] = 1;
    }
  }
}

// Every untorn point on screen, right out to the edges.
function refreshOpen() {
  const c0 = clamp(Math.floor(scrollX / DOT), 0, latticeCols - 1), c1 = clamp(Math.ceil((scrollX + innerWidth) / DOT), 0, latticeCols - 1);
  const r0 = clamp(Math.floor(scrollY / DOT), 0, latticeRows - 1), r1 = clamp(Math.ceil((scrollY + innerHeight) / DOT), 0, latticeRows - 1);
  const size = (c1 - c0 + 1) * (r1 - r0 + 1);
  if (openDots.length < size) openDots = new Int32Array(size);
  openCount = 0;
  for (let row = r0; row <= r1; row++) {
    for (let col = c0, i = row * latticeCols + c0; col <= c1; col++, i++) if (!lattice[i]) openDots[openCount++] = i;
  }
}

// ---------- Loose clips and the pile ----------

// Loose clips fly and land on a pile at the bottom of the screen. The pile grows by the area each clip came
// from, so by the time the page is all torn away, the screen is full of paperclips.
// Two canvases, bottom to top: the clips that have
// landed (each drawn once), and the clips in the air (redrawn every frame).
const [pileCanvas, canvas] = [0, 1].map(() => Object.assign(document.createElement("canvas"), { className: "pc-pile" }));
const pileCtx = pileCanvas.getContext("2d");
const ctx = canvas.getContext("2d");
const beamCanvas = Object.assign(document.createElement("canvas"), { className: "pc-pile pc-beam" }); // over the robots
const beamCtx = beamCanvas.getContext("2d");
let dpr = 1;
let pileDirty = false;
const sprite = new Image();
sprite.src = CLIP_URL;
const COL = 4; // pile height is kept per column this wide
let debris = []; // { x, y, vx, vy, a, va, s, area, age, bounced }
let settled = [];
let falling = []; // everything dropping off the screen after a shutdown
let heights = null;

function resizeCanvas() {
  dpr = devicePixelRatio || 1;
  for (const [c, g] of [[pileCanvas, pileCtx], [canvas, ctx], [beamCanvas, beamCtx]]) {
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    c.style.width = `${innerWidth}px`;
    c.style.height = `${innerHeight}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  for (const t of textTargets) measure(t);
  pileDirty = true;
  const old = heights;
  heights = new Float32Array(Math.ceil(innerWidth / COL) + 1);
  if (old) heights.forEach((_, i) => { heights[i] = old[Math.min(i, old.length - 1)]; });
  for (const c of settled) draw(pileCtx, c);
  sizeTears();
}

function surfaceAt(x) {
  if (!heights) return innerHeight;
  return innerHeight - heights[clamp(Math.floor(x / COL), 0, heights.length - 1)];
}

function draw(g, c) {
  const h = c.s * (c.age < 8 ? 0.4 + c.age * 0.075 : 1); // popping into being
  const w = (h * CLIP_W) / CLIP_H;
  const cos = Math.cos(c.a) * dpr, sin = Math.sin(c.a) * dpr;
  g.setTransform(cos, sin, -sin, cos, c.x * dpr, c.y * dpr); // leaves g rotated: reset it before clearing or filling
  g.drawImage(sprite, -w / 2, -h / 2, w, h);
}

function popClip(x, y, s, area, vx, vy) {
  debris.push({ x, y, vx, vy, a: Math.random() * Math.PI * 2, va: (Math.random() - 0.5) * 0.12, s, area, age: 0, bounced: false });
}

const PILE_CAP = 0.4; // the pile thins out as it nears this fraction of the screen, so it stays a heap at the bottom

// The torn-off clips get the same rigid-body treatment as the loose ones (a capsule that bounces off its lowest
// point, pivots and topples), scaled to their size, and once lying down they slide along the slope of the heap.
// Each one only costs anything until it comes to rest; then it's drawn into the pile canvas for good.
function stepDebris() {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.age += 1;
    if (stepBody(d) && d.age < 600) continue;
    debris[i] = debris[debris.length - 1];
    debris.pop();
    settle(d);
  }
}

const slopeAt = (x) => (surfaceAt(x + 10) - surfaceAt(x - 10)) / 20; // >0: the ground falls away to the right
const PILE_FRICTION = 0.82; // per-frame drag on a clip sliding over the heap
const REPOSE = 0.6; // the steepest slope (about 30°) a clip will stay put on
// A lying clip's angle: along the heap under it, plus the tilt it came down with.
const layAlong = (d) => d.flat + Math.atan(slopeAt(d.x)) * 0.7 + d.tilt;

// One frame of physics for a clip in the air or sliding. Returns false once it has come to rest.
function stepBody(d) {
  const W = (d.s * CLIP_W) / CLIP_H, half = (d.s - W) / 2, I = (W * W + d.s * d.s) / 12;
  const lowest = (a) => {
    const co = Math.cos(a), k = co >= 0 ? 1 : -1;
    return { y: k * half * co + W / 2, x: 2 * half * Math.abs(co) < 1.5 ? 0 : -k * half * Math.sin(a) };
  };
  const groundAt = (x) => surfaceAt(x) - d.s * 0.05;
  // Sideways, the heap is a wall, not a ramp: a clip can't move into a spot where the heap is above its lowest point,
  // so nothing gets pushed up the slope. It knocks against it instead.
  const bottom = d.y + (d.lying ? W / 2 : lowest(d.a).y);
  const ox = d.x;
  d.x = clamp(d.x + d.vx, 6, innerWidth - 6);
  const blocked = d.x !== ox + d.vx || groundAt(d.x) < bottom - 2;
  if (blocked) {
    d.x = ox;
    d.vx = -d.vx * 0.3;
  }
  const ground = groundAt(d.x);
  if (d.lying) {
    // Lying on the heap: gravity pulls it down the slope and the clips under it drag on it, hard. On a gentle slope
    // it grips and doesn't start sliding at all. It lies along the slope, with a bit of a tilt of its own.
    const slope = slopeAt(d.x);
    const pull = Math.abs(slope) > 0.25 ? (GRAVITY * slope) / (1 + slope * slope) : 0;
    d.vx = (d.vx + pull) * PILE_FRICTION;
    // Steeper than a heap can stand: it keeps going downhill, so gullies and dips between heaps fill in.
    if (Math.abs(slope) > REPOSE) d.vx = Math.sign(slope) * Math.max(Math.abs(d.vx), 0.8);
    d.a = layAlong(d);
    if (ground - W / 2 > d.y + 3) { d.lying = false; return true; } // ran off an edge: falling again
    if (ground - W / 2 < d.y) return false; // the heap has built up under it: it's buried where it lies
    if (blocked) return false; // slid up against a clip it can't get over: it stops there
    d.y = ground - W / 2;
    return Math.abs(d.vx) > 0.15 || Math.abs(slopeAt(d.x)) > REPOSE;
  }
  const flat = Math.PI / 2 + Math.PI * Math.round((d.a - Math.PI / 2) / Math.PI);
  if (d.toppling) {
    // Resting on one end and falling over like a stick pivoting on that end: slow to start, then quicker, then flat.
    const dir = Math.sign(flat - d.a) || 1;
    const lean = Math.max(Math.cos(d.a - flat), 0.3); // how far it's leaned from upright (sin of that angle)
    d.va = dir * (Math.abs(d.va) + (1.5 * GRAVITY * lean) / d.s);
    const pivot = d.x + lowest(d.a).x, base = groundAt(pivot);
    d.a += d.va;
    if (Math.sign(flat - d.a) !== dir) {
      Object.assign(d, { lying: true, flat, toppling: false, va: 0, vx: d.va * W * 0.5, vy: 0, tilt: (Math.random() - 0.5) * 0.3 });
      d.a = layAlong(d);
      d.y = groundAt(d.x) - W / 2;
      return true;
    }
    d.x = clamp(pivot - lowest(d.a).x, 6, innerWidth - 6);
    d.y = base - lowest(d.a).y;
    return true;
  }
  d.vy += GRAVITY;
  d.y += d.vy;
  d.a += d.va;
  const { x: px, y: py } = lowest(d.a);
  if (d.y + py <= ground) return true;
  d.y = ground - py;
  const vpy = d.vy + d.va * px;
  if (vpy > 1) {
    if (vpy > 3) sfx.clink(vpy / 14);
    // A real bounce. Only part of the knock becomes spin, and never much: a bent wire tumbles, it doesn't whirl.
    const j = (-(1 + RESTITUTION * 0.6) * vpy) / (1 + (px * px) / I);
    const vpx = d.vx - d.va * py;
    const limit = FRICTION * -j;
    const jt = clamp(-vpx / (1 + (py * py) / I), -limit, limit);
    d.vy += j;
    d.vx += jt;
    d.va = clamp((d.va + ((px * j - py * jt) / I) * 0.35) * CONTACT_DAMPING, -0.08, 0.08);
    return true;
  }
  // Too slow to bounce: if it's already about flat it lies down, otherwise it falls over onto its side.
  if (Math.abs(d.a - flat) < 0.09) {
    Object.assign(d, { lying: true, flat, va: 0, vy: 0, y: ground - W / 2, tilt: (Math.random() - 0.5) * 0.3 });
    d.a = layAlong(d);
  } else {
    Object.assign(d, { toppling: true, vx: 0, vy: 0, va: Math.sign(flat - d.a) === Math.sign(d.va) ? d.va : 0 });
  }
  return true;
}

function settle(d) {
  d.age = 99; // full size, even if it landed mid-pop
  settled.push(d);
  draw(pileCtx, d);
  // The heap rises in a low hump under the clip, only across the width it actually covers, and nowhere else: clips nest
  // into each other, so not by their full thickness. A hollow under a clip that's lying across it isn't sealed over,
  // so later clips drop into it and fill it in, rather than resting on nothing and leaving holes.
  const W = (d.s * CLIP_W) / CLIP_H, half = (Math.abs(Math.sin(d.a)) * (d.s - W) + W) / 2;
  const i0 = Math.floor((d.x - half) / COL), i1 = Math.floor((d.x + half) / COL);
  const centre = clamp(Math.floor(d.x / COL), 0, heights.length - 1);
  const full = heights[centre] / (innerHeight * PILE_CAP);
  const rise = W * 0.45 * Math.max(0.1, 1 - full * full);
  // It only raises the heap above where it actually is: one that ended up buried (the heap rose round it while it
  // was still sliding, as happens when lots fall at once) adds nothing on top, or the surface would float above
  // the clips drawn there and leave a gap under the next ones.
  const base = innerHeight - d.y - W / 2; // the height of the clip's underside
  for (let i = i0; i <= i1; i++) {
    if (heights[i] === undefined) continue;
    const edge = 1 - Math.abs(i - (i0 + i1) / 2) / ((i1 - i0) / 2 + 1); // a hump, highest under the middle
    heights[i] = Math.max(heights[i], Math.min(heights[i], base) + rise * edge);
  }
}

function stepFalling() {
  falling = falling.filter((c) => c.y < innerHeight + 40);
  for (const c of falling) {
    if (c.delay > 0) { c.delay -= 1; continue; }
    c.vy += GRAVITY;
    c.x += c.vx;
    c.y += c.vy;
    c.a += c.spin;
  }
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const d of debris) draw(ctx, d);
  for (const c of falling) draw(ctx, c);
  if (beams.length || beamsShown) {
    beamCtx.clearRect(0, 0, innerWidth, innerHeight);
    beamsShown = beams.length > 0;
    beamCtx.strokeStyle = "#e0242f";
    beamCtx.lineCap = "round";
    beamCtx.shadowColor = "#ff2a35";
    beamCtx.shadowBlur = 8;
    for (const beam of beams) {
      beamCtx.lineWidth = 1.5 + Math.min(beam.frames, 16) * 0.25;
      beamCtx.beginPath();
      for (const eye of beam.from) {
        beamCtx.moveTo(eye.x, eye.y);
        beamCtx.lineTo(beam.to.x, beam.to.y);
      }
      beamCtx.stroke();
    }
    beams = beams.filter((b) => --b.frames > 0);
  }
}

// ---------- The invasion ----------

function startReplacing(at = null) {
  phase = "replacing";
  document.documentElement.classList.add("pc-busy");
  getSelection()?.removeAllRanges();
  replaceStarted = performance.now();
  collectTargets();
  collectObjects();
  layer.prepend(pileCanvas, canvas, beamCanvas);
  resizeCanvas();
  addEventListener("resize", resizeCanvas);
  pageLayer.append(tears);
  setupLattice();
  refreshOpen();
  refreshText();
  // The first robot turns up where the last clip was poked (or where a page asked).
  const from = at ?? live.at(-1);
  spawnBot(from ? clamp(from.x, 30, innerWidth - 30) : innerWidth / 2, from ? Math.min(from.y, innerHeight - 30) : innerHeight - 40, 1);
  invade();
}

function startSwarm() {
  if (phase === "swarming" || phase === "ending") return;
  if (phase === "idle") startReplacing();
  phase = "swarming";
  showShutdown();
}

// Links stay dead until the page is back, so nobody wanders off mid-invasion.
function blockLinks(e) {
  if (phase !== "idle" && e.target.closest?.("a[href]")) {
    e.preventDefault();
    e.stopPropagation();
  }
}
for (const type of ["click", "auxclick"]) document.addEventListener(type, blockLinks, true);

let invading = false;
let frame = 0;
const active = () => phase === "replacing" || phase === "swarming" || phase === "finale";

function invade() {
  if (invading) return;
  invading = true;
  requestAnimationFrame(tick);
}

function tick(now) {
  frame += 1;
  if (active()) {
    if (frame % 5 === 0) refreshOpen();
    if (frame % 15 === 0) refreshText();
    if (phase === "replacing" && (now - replaceStarted > 12_000 || !visibleText.length)) startSwarm();
    if (phase === "swarming" && !visibleText.length && !tearStarted && !zapsLeft()) tearStarted = now;
    // A few seconds into the tearing, one robot goes after the shutdown button.
    if (phase === "swarming" && tearStarted && now - tearStarted > 3000 && shutdown && !bots.some((b) => b.hunting)) sendHunter();
    for (const bot of [...bots]) updateBot(bot, now);
    if (phase === "swarming" && tearStarted && !openCount && !offscreenTorn) { offscreenTorn = true; tearOffscreen(); }
    if (phase === "swarming" && tearStarted && !openCount && !shutdown && !bots.some((b) => b.tear)) startFinale(now);
    if (phase === "finale") stepFinale(now);
  }
  stepDebris();
  stepFalling();
  render();
  if (active() || debris.length || falling.length) requestAnimationFrame(tick);
  else invading = false;
}

// ---------- Finale ----------

// With nothing left on screen, the robots line up facing the first one, smallest at the far end. It zaps each of
// them into paperclips with its eyes, faster and faster, then turns itself into paperclips too.
let finale = null; // { stage, start, next, gap, leader, queue }
let beams = []; // { from: [eye points], to, frames }

function startFinale(now) {
  phase = "finale";
  const [leader, ...rest] = bots;
  rest.sort((a, b) => b.scale - a.scale);
  const y = innerHeight * 0.55;
  leader.goal = { x: innerWidth * 0.12, y, act: "line" };
  rest.forEach((bot, i) => {
    bot.goal = { x: innerWidth * (rest.length > 1 ? 0.3 + (0.6 * i) / (rest.length - 1) : 0.6), y, act: "line" };
  });
  for (const bot of bots) {
    bot.run = null;
    bot.waitUntil = 0;
  }
  finale = { stage: "lining", start: now, next: 0, gap: 550, leader, queue: rest, steps: [] };
}

// A point on a robot's drawing (in its 120 × 150 viewBox), on screen.
function botPoint(bot, vx, vy) {
  const left = bot.x - (bot.flip ? 1 - TIP.x : TIP.x) * bot.w, top = bot.y - TIP.y * bot.h;
  return { x: left + ((bot.flip ? 120 - vx : vx) / 120) * bot.w, y: top + (vy / 150) * bot.h };
}

const eyes = (bot) => [botPoint(bot, 49, 50), botPoint(bot, 71, 50)];

function burst(bot) {
  const left = bot.x - (bot.flip ? 1 - TIP.x : TIP.x) * bot.w, top = bot.y - TIP.y * bot.h;
  const n = Math.round(6 + 30 * bot.scale * bot.scale);
  for (let k = 0; k < n; k++) {
    const x = left + Math.random() * bot.w, y = top + Math.random() * bot.h;
    popClip(x, y, 12 + 16 * bot.scale + Math.random() * 6, (bot.w * bot.h) / n,
      ((x - left) / bot.w - 0.5) * 5, -2 - Math.random() * 4);
  }
  bot.el.remove();
  bots.splice(bots.indexOf(bot), 1);
}

function stepFinale(now) {
  const f = finale;
  if (f.stage === "lining") {
    if (bots.every((b) => b.lined) || now - f.start > 6000) {
      f.stage = "zapping";
      f.next = now + 800;
    }
  } else if (f.stage === "zapping" && now >= f.next) {
    const victim = f.queue.shift();
    if (victim) {
      beams.push({ from: eyes(f.leader), to: botPoint(victim, 60, 80), frames: 10 });
      sfx.zap();
      burst(victim);
      f.gap = Math.max(160, f.gap * 0.85);
      f.next = now + f.gap;
    } else {
      // The last one left glances one way, then the other, frowns, and zaps itself in the chest.
      const me = f.leader;
      const look = (dx) => () => { for (const eye of me.el.querySelectorAll(".eye")) eye.style.transform = `translateX(${dx}px)`; };
      f.stage = "alone";
      f.steps = [
        [600, look(-8)],
        [700, look(8)],
        [650, look(-8)],
        [600, look(8)],
        [550, look(0)],
        [600, () => me.el.querySelector(".mouth").setAttribute("d", "M52 65 Q60 57 68 65")],
        [1200, () => {
          beams.push({ from: eyes(me), to: botPoint(me, 60, 104), frames: 16 });
          sfx.zap();
          me.el.classList.add("tearing");
        }],
        [260, (t) => {
          burst(me);
          f.stage = "done";
          f.next = t + 1200;
        }],
      ];
      f.next = now + f.steps[0][0];
    }
  } else if (f.stage === "alone" && now >= f.next) {
    const [, act] = f.steps.shift();
    act(now);
    if (f.steps.length) f.next = now + f.steps[0][0];
  } else if (f.stage === "done" && now >= f.next && !debris.length && !ended) {
    ended = true;
    setTimeout(fadeAndReset, 900);
  }
}

// ---------- Shutdown button ----------

let shutdown = null;
let lastJump = 0;
let button = null; // its size and where it's headed, so the cursor handler never has to wait on a layout

function showShutdown() {
  shutdown = document.createElement("button");
  shutdown.type = "button";
  shutdown.className = "pc-shutdown";
  shutdown.textContent = "Shut down";
  shutdown.dataset.pcSkip = "";
  shutdown.style.transition = "none"; // appear in place, not slide in from the corner
  document.body.append(shutdown);
  button = { w: shutdown.offsetWidth, h: shutdown.offsetHeight, cx: 0, cy: 0 };
  place(innerWidth * (0.2 + Math.random() * 0.6), innerHeight * (0.2 + Math.random() * 0.5));
  shutdown.getBoundingClientRect();
  shutdown.style.transition = "";
  shutdown.addEventListener("click", shutDown);
  addEventListener("pointermove", flee);
}

function place(x, y) {
  const { w, h } = button;
  const cx = Math.min(Math.max(x, w / 2 + 8), innerWidth - w / 2 - 8);
  const cy = Math.min(Math.max(y, h / 2 + 8), innerHeight - h / 2 - 8);
  // Moved by transform, which the browser animates off the main thread, so it glides even while the page is busy.
  shutdown.style.transform = `translate(${cx - w / 2}px, ${cy - h / 2}px)`;
  Object.assign(button, { cx, cy });
  return { cx, cy };
}

function flee(e) {
  if (e.pointerType !== "mouse" || !shutdown) return;
  const { cx, cy } = button;
  const dx = cx - e.clientX, dy = cy - e.clientY;
  const dist = Math.hypot(dx, dy) || 1;
  if (dist > 130) return;
  // Step away from the cursor. Pinned in a corner, it can only teleport every couple of seconds,
  // so a patient person can still catch it.
  const push = (130 - dist) * 0.9;
  const moved = place(cx + (dx / dist) * push, cy + (dy / dist) * push);
  const stuck = Math.hypot(moved.cx - cx, moved.cy - cy) < 2;
  if (stuck && performance.now() - lastJump > 2200) {
    lastJump = performance.now();
    place(innerWidth - e.clientX, innerHeight - e.clientY);
  }
}

// The first robot stops where it is and burns the button into paperclips with its eyes. If it's right next to the
// button, the nearest robot that isn't takes the shot (or failing that, the farthest).
const LASER_MS = 1300;
const LASER_MIN = 150;
function sendHunter() {
  const away = (b) => Math.hypot(b.x - button.cx, b.y - button.cy);
  const far = bots.filter((b) => away(b) >= LASER_MIN).sort((a, b) => away(a) - away(b));
  const hunter = bots[0] && away(bots[0]) >= LASER_MIN ? bots[0]
    : far[0] ?? [...bots].sort((a, b) => away(b) - away(a))[0];
  if (!hunter) return;
  hunter.hunting = true;
  hunter.run = null;
  hunter.goal = null;
}

// Each frame while hunting: the beam follows the button as it runs, and burns through after LASER_MS.
function laserButton(bot, now) {
  bot.hop = 0;
  bot.flip = button.cx < bot.x;
  let beam = beams.find((b) => b.bot === bot);
  if (!bot.laserUntil) {
    bot.laserUntil = now + LASER_MS;
    bot.el.classList.add("tearing");
    beam = { from: eyes(bot), to: null, frames: Infinity, bot };
    beams.push(beam);
    sfx.burn(LASER_MS / 1000);
  }
  beam.from = eyes(bot);
  beam.to = { x: button.cx, y: button.cy };
  if (now < bot.laserUntil) return;
  beams.splice(beams.indexOf(beam), 1);
  bot.laserUntil = 0;
  bot.el.classList.remove("tearing");
  grabButton(bot, now);
}

function grabButton(bot, now) {
  bot.hunting = false;
  bot.waitUntil = now + 400;
  if (!shutdown) return;
  const { cx, cy, w, h } = button;
  const n = 16;
  for (let k = 0; k < n; k++) {
    popClip(cx + (Math.random() - 0.5) * w, cy + (Math.random() - 0.5) * h, 18 + Math.random() * 10, (w * h) / n,
      (Math.random() - 0.5) * 4, -3 - Math.random() * 3);
  }
  hideShutdown();
}

function hideShutdown() {
  removeEventListener("pointermove", flee);
  shutdown?.remove();
  shutdown = null;
}

// ---------- Endings ----------

function stopEverything() {
  phase = "ending";
  beams = []; // a laser on the button stops with it
  hideShutdown();
}

function restorePage() {
  for (const { node, span } of wrapped.splice(0)) if (span.isConnected) span.replaceWith(node);
  for (const o of objects) o.el.classList.remove("pc-zapped");
  textTargets = [];
}

function resetState() {
  for (const c of live.splice(0)) c.el.remove();
  for (const bot of bots) bot.el.remove();
  bots = [];
  holes.length = 0;
  rims.replaceChildren();
  voids.replaceChildren();
  lattice = null;
  openCount = 0;
  tears.remove();
  tears.style.opacity = "";
  debris = [];
  settled = [];
  falling = [];
  heights = null;
  for (const c of [pileCanvas, canvas, beamCanvas]) c.remove();
  beamCtx.clearRect(0, 0, innerWidth, innerHeight);
  removeEventListener("resize", resizeCanvas);
  clicks = 0;
  ended = false;
  tearStarted = 0;
  offscreenTorn = false;
  visibleText = [];
  finale = null;
  beams = [];
  beamsShown = false;
  for (const o of objects.splice(0)) o.el.classList.remove("pc-zapped");
  phase = "idle";
  document.documentElement.classList.remove("pc-busy");
  for (const done of whenDone.splice(0)) done();
}

// ---------- For pages ----------
const whenDone = [];
// hold(true) keeps clips from drifting by or starting the invasion until hold(false).
export function hold(on) {
  root.classList.toggle("pc-hold", on);
}
// Starts the invasion now, its first robot at x, y (in the window), in any mode. Resolves once the page is back.
export function invadeFrom(x, y) {
  if (phase !== "idle") return Promise.resolve();
  const done = new Promise((r) => whenDone.push(r));
  startReplacing({ x, y });
  return done;
}

// Both endings are the same: every clip (the pile, the ones in the air, the loose ones) and every robot drops off the
// bottom of the screen with a little stagger and spin, and only once they're all gone do the holes fade away and the
// page come back underneath.
function shutDown() {
  fallAway();
}

function fadeAndReset() {
  fallAway();
}

function fallAway() {
  stopEverything();
  sfx.spill();
  for (const c of live) {
    c.falling = true;
    c.vy = -2 - Math.random() * 3;
    c.vx = (Math.random() - 0.5) * 3;
  }
  // The top of the pile is all you can see of it; a few thousand falling is plenty.
  // Every clip falls from exactly where it is; the ones on top of the heap let go a little before those under them.
  falling = [...settled, ...debris].map((c) => ({
    ...c, age: 99, vy: -Math.random() * 1.5, vx: (Math.random() - 0.5) * 2, spin: (Math.random() - 0.5) * 0.15,
    delay: reduceMotion ? 0 : Math.random() * 25 + Math.max(0, c.y - (innerHeight - 200)) * 0.06,
  }));
  settled = [];
  debris = [];
  heights.fill(0);
  pileCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pileCtx.clearRect(0, 0, innerWidth, innerHeight);
  for (const bot of bots) {
    bot.el.classList.add("falling");
    bot.el.style.transitionDelay = `${Math.random() * 0.3}s`;
    bot.el.style.transform += ` translateY(${innerHeight + 200}px) rotate(${(Math.random() - 0.5) * 90}deg)`;
  }
  run();
  invade();
  const started = performance.now();
  const gone = () => {
    const bots_ = bots.some((b) => b.el.isConnected && performance.now() - started < 2500);
    if ((falling.length || live.length || bots_) && performance.now() - started < 6000) return setTimeout(gone, 100);
    // Nothing left in the air: the holes fade away, and the page is back underneath them.
    restorePage();
    tears.style.opacity = "0";
    for (const o of objects) o.el.classList.remove("pc-zapped");
    wrapped.forEach(({ chars }) => chars.forEach((c) => c.classList.remove("pc-gone")));
    setTimeout(resetState, reduceMotion ? 100 : 1100);
  };
  setTimeout(gone, reduceMotion ? 100 : 600);
}

// ?paperclips sends the first one right away instead of after several seconds.
setTimeout(ambient, new URLSearchParams(location.search).has("paperclips") ? 500 : 8000 + Math.random() * 6000);
