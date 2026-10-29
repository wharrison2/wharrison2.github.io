// The robot: a small pencil-wielding robot that stands on top of a terminal, follows the cursor or the word being
// typed, writes into the terminal a letter at a time, erases, carries the cursor, reddens its eyes and shakes.
// Used by the Markov page and by the eval shell on it. The page's choreography calls this; it holds the robot's motion
// and typing rhythm only. The drawing stays in the page's HTML (see robot.css for its poses: writing, thinking,
// sleeping, staring, alarm, lifting, holding).

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise(requestAnimationFrame);
export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
export const reduced = matchMedia("(prefers-reduced-motion: reduce)");

// The robot is drawn in a 120x150 box with its pencil tip at (105.5, 146).
export const TIP_X = 105.5 / 120;
export const TIP_Y = 146 / 150;

// Calls fn(t) every frame with t going from 0 to 1 over ms.
export async function ramp(ms, fn) {
  const start = performance.now();
  for (let t = 0; t < 1; t = Math.min(1, (performance.now() - start) / ms)) {
    fn(t);
    await nextFrame();
  }
  fn(1);
}

// Takes the page's elements: `desk` (the positioned parent), `rig` (the absolutely placed box holding the drawing),
// `svg` (the drawing), `paper` (the terminal), `caret` (its block cursor, a child of the paper), `output` (where
// written text goes) and `entry` (the line being typed). Returns the robot, whose properties and methods are:
//   rest      true: not writing, standing on top of the terminal at the right. false: at the text. Then follow().
//   glide     px/ms: walk to the next spot at this steady speed instead of keeping up with the text; 0 for no walking.
//   grip      while carrying the cursor: where its stand-in sits in the drawing, {x, y} in viewBox units; else null.
//   shake     twitch, in px (0 for none); call follow(false) as it changes.
//   away      true: walks off the right edge of the window (and stays there) instead of anywhere else.
//   hurry     true skips pauses and letter-by-letter pacing (pause() and type() resolve at once); the page sets it.
//   tempo     stretches every typing pause (1 for normal).
//   x, y      where the pencil tip is, relative to the desk.
//   follow(remeasure = true)  move toward where the robot should be; call after changing rest/glide/aim.
//   lookAt(el)    hover over the middle of el instead of writing; lookAt(null) goes back to the text.
//   arrived()     resolves once it has reached where it's headed.
//   tip()         [x, y] of the pencil tip on screen.
//   setHeat(h)    0 to 1: the eyes and bulb redden, swell and glow. Past 0.7 the mouth goes flat and the arm jabs.
//   pause(ms)     sleep(ms), unless hurrying.
//   letterGap(), wordGap(word)   the next pause, in ms, after a letter or a word, in the typing rhythm.
//   type(target, text)   Resolves once text has gone onto the end of target (an element or text node) a letter at a
//                        time. Add the "writing" class to the svg meanwhile; the robot follows the cursor (or a
//                        `.typing` span in output).
//   erase(target, { to = 0, min = 55, spread = 45 })   Backspaces target's text down to `to` letters, a letter every
//                        min to min + spread ms.
//   carry(place)  picks the cursor up in its hand, calls place() to move it, and sets it down there.
//   park()        lets go of everything and returns the cursor and the robot to rest (after a run, say).
export function createRobot({ desk, rig, svg, paper, caret, output, entry }) {
  // ---------- The robot follows its pencil ----------
  // Its rig is absolutely placed on the desk and moved only with transforms, easing toward the write position: the
  // word being typed, else the cursor, or a word it's looking at. When it isn't writing, it steps off the text and
  // stands on top of the terminal at the right. That position is measured at most once a frame, and only after
  // something changed.
  // The cursor's stand-in in the robot's hand, drawn in place of its pencil while it carries the cursor.
  const grip = svg.querySelector(".grip");
  const bot = {
    x: 0, y: 0, tx: 0, ty: 0, w: 60, placed: false, dirty: true, running: false, last: 0,
    aim: null, // a word to hover over instead of writing
    rest: true, // not writing: off to the side
    away: false, // gone off the right of the window
    glide: 0, // on a long trip: its walking speed in px/ms, instead of a dash
    grip: null, // while handling the cursor: where its stand-in sits in the drawing, {x, y} in viewBox units
    shake: 0, // twitch, in px
    hurry: false, // clicking the paper while it writes skips the letter-by-letter writing
    tempo: 1,
    jx: 0, jy: 0, spin: 0, jitAt: 0,
  };

  function follow(remeasure = true) {
    if (remeasure) bot.dirty = true;
    if (bot.running) return;
    bot.running = true;
    bot.last = performance.now();
    requestAnimationFrame(botFrame);
  }
  function lookAt(el) {
    bot.aim = el;
    follow();
  }

  function botFrame(now) {
    // The frame's timestamp can be a little before the follow() that asked for it.
    const dt = clamp(now - bot.last, 0, 50);
    bot.last = now;
    if (bot.dirty) {
      bot.dirty = false;
      bot.w = rig.offsetWidth;
      const el = bot.aim ?? output.querySelector(".typing") ?? (bot.rest ? paper : caret);
      const r = el.getBoundingClientRect();
      const d = desk.getBoundingClientRect();
      let x, y;
      // Standing on the terminal's top edge, near its right end (its feet are 2 units above the pencil tip).
      if (el === paper) [x, y] = [r.right - 14 - bot.w * (1 - TIP_X), r.top + bot.w * 1.25 * (2 / 150)];
      else if (el === bot.aim) [x, y] = [r.left + r.width / 2, r.top + r.height * 0.6]; // hovering over its middle
      // Holding the cursor (arm down): its stand-in lands right on the cursor's spot.
      else if (el === caret && bot.grip) [x, y] = [r.left + (105.5 - bot.grip.x) * bot.w / 120, r.top + (146 - bot.grip.y) * bot.w / 120];
      else if (el === caret) [x, y] = [r.left, r.bottom - r.height * 0.1];
      else [x, y] = [r.right, r.bottom - r.height * 0.28]; // the end of the word being typed
      // Keep the whole robot inside the window sideways, so narrow phones never scroll sideways.
      const vw = document.documentElement.clientWidth;
      bot.tx = (bot.away ? vw + bot.w * 1.5 : clamp(x, bot.w * TIP_X, vw - bot.w * (1 - TIP_X) - 2)) - d.left;
      bot.ty = y - d.top;
      if (!bot.placed || reduced.matches) [bot.x, bot.y, bot.placed] = [bot.tx, bot.ty, true];
    }
    // Sideways a little faster than down, so starting a new line looks like a carriage return.
    let mx = (bot.tx - bot.x) * (1 - Math.exp(-dt / (bot.aim ? 150 : 45)));
    let my = (bot.ty - bot.y) * (1 - Math.exp(-dt / (bot.aim ? 150 : 85)));
    // Long trips (to and from its spot, carrying the cursor) are walked at a steady speed, bobbing a little with each
    // step. While writing it keeps up with the text.
    const step = Math.hypot(mx, my), speed = bot.glide || (bot.rest ? 1.4 : 0), most = speed * dt;
    if (speed && step > most) [mx, my] = [(mx * most) / step, (my * most) / step];
    bot.x += mx;
    bot.y += my;
    const walking = step > 0.02 * dt && !reduced.matches;
    const bob = walking ? -Math.abs(Math.sin(now / 95)) * bot.w * 0.04 : 0;
    const s = reduced.matches ? 0 : bot.shake;
    if (!s) [bot.jx, bot.jy, bot.spin] = [0, 0, 0];
    else if (now - bot.jitAt > 33) {
      bot.jitAt = now;
      bot.jx = (Math.random() * 2 - 1) * s;
      bot.jy = (Math.random() * 2 - 1) * s;
      bot.spin = (Math.random() * 2 - 1) * s * 0.9;
    }
    const h = bot.w * 1.25;
    rig.style.transform = `translate(${(bot.x - bot.w * TIP_X + bot.jx).toFixed(2)}px, ${(bot.y - h * TIP_Y + bot.jy + bob).toFixed(2)}px) rotate(${bot.spin.toFixed(2)}deg)`;
    const settled = Math.abs(bot.tx - bot.x) < 0.25 && Math.abs(bot.ty - bot.y) < 0.25;
    if (!settled || bot.dirty || s || bob) requestAnimationFrame(botFrame);
    else bot.running = false;
  }

  for (const el of [output, entry]) {
    new MutationObserver(() => follow()).observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  }
  new ResizeObserver(() => follow()).observe(paper);
  addEventListener("resize", () => follow());
  document.fonts?.ready.then(() => follow());
  follow();

  // Resolves once the robot has reached where it's headed.
  async function arrived() {
    const start = performance.now();
    await nextFrame();
    while ((bot.running || bot.dirty) && !bot.shake && performance.now() - start < 6000) await nextFrame();
  }

  // 0 to 1: the eyes and bulb redden, swell and glow. Past 0.7 the mouth goes flat and the arm starts jabbing.
  function setHeat(h) {
    svg.style.setProperty("--heat", h.toFixed(3));
    svg.classList.toggle("staring", h > 0.01);
    svg.classList.toggle("alarm", h > 0.7);
  }

  // ---------- Typing rhythm ----------
  // Uneven letters, now and then a quick burst or a hesitation, and longer stops after words, commas and sentences.
  // `tempo` stretches every pause (it slows down after "misaligned"). It averages close to the old 22ms a letter.
  let burst = 0;
  function letterGap() {
    let ms = 10 + Math.random() * 17;
    if (burst > 0) {
      burst -= 1;
      ms *= 0.45;
    } else if (Math.random() < 0.05) burst = 3 + Math.floor(Math.random() * 5);
    if (Math.random() < 0.025) ms += 80 + Math.random() * 150;
    return ms * bot.tempo;
  }
  function wordGap(word) {
    let ms = 20 + Math.random() * 30;
    if (/[.!?]['"’”)]*$/.test(word)) ms += 170 + Math.random() * 190;
    else if (/[,;:]['"’”)]*$|[—–-]$/.test(word)) ms += 60 + Math.random() * 90;
    return ms * bot.tempo;
  }
  const pause = (ms) => (bot.hurry ? Promise.resolve() : sleep(ms));

  // ---------- Writing and erasing ----------
  // An element's text is its textContent; a text node's is its data.
  const field = (el) => (el.nodeType === 3 ? "data" : "textContent");
  async function type(target, text) {
    const f = field(target);
    for (const ch of text) {
      target[f] += ch;
      await pause(letterGap());
    }
  }
  async function erase(target, { to = 0, min = 55, spread = 45 } = {}) {
    const f = field(target);
    while (target[f].length > to) {
      target[f] = target[f].slice(0, -1);
      await pause(min + Math.random() * spread);
    }
  }

  // ---------- Carrying the cursor ----------
  // The robot walks over with its arm up, lowers it to take the cursor in its hand, lifts it, carries it to wherever
  // `place` puts it, and lowers its arm to set it down there.
  async function carry(place) {
    const from = caret.parentElement;
    const land = () => {
      place();
      if (from.classList.contains("w")) from.textContent = from.textContent; // join the word back up
    };
    if (bot.hurry || reduced.matches) return land();
    const writing = svg.classList.contains("writing");
    svg.classList.remove("writing");
    // The stand-in is the cursor's size, hanging from the hand (the end of the arm at 106,116) over the pencil.
    const r = caret.getBoundingClientRect();
    const unit = 120 / rig.offsetWidth;
    const [w, h] = [r.width * unit, r.height * unit];
    bot.grip = { x: 106 - w / 2, y: 113 };
    Object.entries({ x: bot.grip.x, y: bot.grip.y, width: w, height: h }).forEach(([k, v]) => grip.setAttribute(k, v.toFixed(2)));
    svg.classList.add("lifting");
    bot.glide = 0.32;
    follow();
    await arrived();
    svg.classList.remove("lifting"); // reach down...
    await sleep(320);
    svg.classList.add("holding"); // ...take it...
    caret.classList.add("lifted");
    await sleep(120);
    svg.classList.add("lifting"); // ...and lift it
    await sleep(320);
    land();
    follow();
    await arrived();
    svg.classList.remove("lifting"); // set it down...
    await sleep(320);
    svg.classList.remove("holding"); // ...and let go
    caret.classList.remove("lifted");
    await sleep(120);
    bot.grip = null;
    bot.glide = 0;
    follow();
    await pause(200);
    if (writing) svg.classList.add("writing");
  }

  // Lets go of everything: poses cleared, the cursor back at the end of the paper, the robot back on top of it.
  function park() {
    svg.classList.remove("writing", "thinking", "holding", "lifting");
    caret.classList.remove("lifted");
    bot.grip = null;
    paper.append(caret);
    bot.rest = true;
    follow();
  }

  const tip = () => {
    const d = desk.getBoundingClientRect();
    return [d.left + bot.x, d.top + bot.y];
  };
  return Object.assign(bot, { follow, lookAt, arrived, tip, setHeat, pause, letterGap, wordGap, type, erase, carry, park });
}
