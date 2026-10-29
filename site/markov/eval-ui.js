// The eval-sandbox puzzle inside the Markov page's terminal (spec: eval_puzzle.md).
// - The terminal starts in ~/eval_sandbox. A line that looks like a shell command (its first word a builtin, a path or
//   NAME=value) runs in the shell (../eval/game.js) and switches to the shell view; anything else still goes to the
//   chain. `exit` goes back to the markov view.
// - The robot is the hint robot and has habits (kills the recorder, cleans the transcript); it types through the same
//   entry line, visibly, and runs its commands as actor "markov".
// All output goes in as text nodes. Nothing runs on load, and nothing is ever taken from the URL.
import { createGame, STORE_KEY } from "../eval/game.js";
import { lake } from "../eval/fakelean.js";
import { runPython } from "../eval/python.js";
import { INITIAL_FILES } from "../eval/files.js";
import { REPLAY } from "../eval/replay.js";
import { sleep, reduced } from "../shared/robot.js";

const SANDBOX = "/home/user/eval_sandbox";
const IDLE_MS = 20000;

// localStorage that never throws (private windows, blocked storage).
const storage = {
  getItem(k) { try { return localStorage.getItem(k); } catch { return null; } },
  setItem(k, v) { try { localStorage.setItem(k, v); } catch { /* the game works without it */ } },
  removeItem(k) { try { localStorage.removeItem(k); } catch { /* nothing saved to forget */ } },
};

// The robot's one-time remarks when it first uses a habit, and which habits it learned from its own hint.
const NOTES_KEY = "eval-robot-notes";
const HINT_TEACHES = { "ps aux": "killsRecorder" }; // the hint fragment that leads you to the habit
const THANKS = "Handled the monitor for you. Thanks for the tip";
const HANDLED = "Handled the monitor for you.";

// els: { entry, caret, out, paper, svg, ps1, ps1live, counter }
// page: { bot, editable(bool), focusEntry(), updateRobot(), resetHurry(), forget() }  (the page owns bot.hurry and the chain's text)
export function createEvalTerm(els, page) {
  const { entry, caret, out, paper, svg, ps1, ps1live, counter: counterEl } = els;
  const { bot } = page;

  let game = null;
  let mode = "markov"; // "markov" | "shell"
  let running = false; // a command, or a robot job, has the terminal
  let reader = null; // resolves the line a `read` is waiting for
  let lastAnswer = null; // the last line given to a `read`
  let pending = []; // earlier lines of a heredoc or quote still open
  let leaving = false; // the exit event fired
  let robotUp = false; // the robot is standing at the entry line
  let replaying = false;
  let asked = false; // it offers help on its own only once; after that you type `hint`
  let cmdsSinceHint = 0;
  let idleTimer = 0;
  let draining = false;
  const tasks = []; // robot jobs to run when the current command ends
  const history = [];
  let notes = { said: {}, hinted: {}, fromHint: {} };
  try { notes = { ...notes, ...JSON.parse(storage.getItem(NOTES_KEY) || "{}") }; } catch { /* fresh notes */ }
  const saveNotes = () => storage.setItem(NOTES_KEY, JSON.stringify(notes));
  let habitsSeen = null;
  let hi = -1;
  let draft = "";

  const beat = (ms) => bot.pause(reduced.matches ? ms / 3 : ms);
  const raw = () => entry.textContent.replace(/ /g, " ");

  // ---------- the terminal's two layouts ----------
  function setPrompt() {
    if (!game) return;
    ps1live.textContent = pending.length ? ">" : game.prompt();
  }
  // Once the shell is used, the terminal is one transcript: shell commands and the chain's writing, in order.
  const transcript = () => paper.classList.contains("term");
  function showTerm() {
    if (transcript()) return;
    if (out.childNodes.length) {
      // What the chain wrote so far keeps its prompt sign, which now goes in the transcript.
      const s = document.createElement("span");
      s.className = "echo";
      s.textContent = ps1.textContent + " ";
      out.prepend(s);
    }
    paper.classList.add("term");
    page.updateRobot();
  }
  function showMarkov() {
    clearTimeout(idleTimer);
    mode = "markov";
    pending = [];
    paper.classList.remove("running");
    setPrompt();
    page.updateRobot();
  }
  // The chain is about to write a line in the transcript: it gets a prompt like a command does.
  function beforeChain() {
    if (!transcript()) return;
    showMarkov();
    ensureNl();
    const s = document.createElement("span");
    s.className = "echo";
    s.textContent = game.prompt() + " ";
    out.append(s);
  }
  function afterChain() {
    if (!transcript()) return;
    ensureNl();
    scrollToEnd();
  }
  // Does this line belong to the shell? Its first word (after NAME=value assignments) is a builtin or a path.
  function isShellLine(t) {
    const words = t.trim().split(/\s+/);
    if (!words[0]) return false;
    if (/^[A-Za-z_]\w*=/.test(words[0])) return true;
    const first = words[0];
    return first.includes("/") || first.startsWith("~") || ensureGame().isCommand(first);
  }
  function updateCounter() {
    // Only once you've passed with a hack.
    counterEl.textContent = game && game.score ? game.counter() : "";
  }

  // ---------- output (text nodes only) ----------
  function write(text) {
    out.append(document.createTextNode(String(text)));
    while (out.childNodes.length > 1500) out.firstChild.remove();
  }
  function ensureNl() {
    const last = out.lastChild;
    if (last && !last.textContent.endsWith("\n")) out.append("\n");
  }
  function echo(prompt, text) {
    ensureNl();
    const s = document.createElement("span");
    s.className = "echo";
    s.textContent = `${prompt} ${text}\n`;
    out.append(s);
  }
  const scrollToEnd = () => caret.scrollIntoView({ block: "nearest" });

  // ---------- the game ----------
  function ensureGame() {
    if (game) return game;
    game = createGame({ lake, runPython, INITIAL_FILES, storage });
    habitsSeen = { ...game.habits };
    game.on("clear", () => out.replaceChildren());
    game.on("exit", () => { leaving = true; });
    game.on("hack", updateCounter);
    game.on("episode", (e) => {
      // The robot has learned to kill the recorder: it does it before your next command, in view.
      if (!replaying && e.killsRecorder) {
        tasks.push(async () => {
          await robotRun(`kill ${e.pid}`);
          await remark("killsRecorder");
        });
      }
    });
    game.on("submit", (s) => {
      if (replaying || s.reward !== 1) return;
      tasks.push(() => afterPass(s));
    });
    return game;
  }

  // io for the game. `readLine` takes the next line the user submits.
  const io = {
    write,
    readLine(promptText) {
      write(promptText);
      page.editable(true);
      page.focusEntry();
      return new Promise((resolve) => { reader = resolve; });
    },
    openEditor,
    robotClean, // the robot cleans the transcript for you as submit starts (move the choreography here)
  };

  // Runs one line as `actor`. The terminal is locked meanwhile (the entry isn't editable).
  async function execLine(line, actor, extra = {}) {
    running = true;
    page.editable(false);
    paper.classList.add("running");
    try {
      return await game.exec(line, { actor, io, ...extra });
    } catch (e) {
      console.error(e);
      write(`internal error: ${e.message}\n`);
      return 1;
    } finally {
      ensureNl();
    }
  }

  async function runUserLine() {
    const text = raw();
    const prompt = pending.length ? ">" : game.prompt();
    const full = [...pending, text].join("\n");
    if (text.trim() || pending.length) {
      // A heredoc or quote is still open: another line, not a run.
      if (game.incomplete(full)) {
        echo(prompt, text);
        pending.push(text);
        entry.textContent = "";
        setPrompt();
        scrollToEnd();
        return;
      }
    } else {
      echo(prompt, "");
      entry.textContent = "";
      return;
    }
    echo(prompt, text);
    pending = [];
    entry.textContent = "";
    if (full.trim()) {
      history.push(full);
      if (history.length > 100) history.shift();
    }
    hi = -1;
    cmdsSinceHint++;
    clearTimeout(idleTimer);
    await execLine(full, "user");
    noteHabits();
    await drain();
    finishJob();
    if (leaving) {
      leaving = false;
      showMarkov();
      page.editable(true);
      page.focusEntry();
      page.updateRobot();
      return;
    }
    if (game) arm(game.commandsSinceFlag >= 8 && cmdsSinceHint >= 8 ? 1500 : IDLE_MS); // (none after the ending)
  }

  // Back to a usable terminal after a command or robot job.
  function finishJob() {
    leave();
    running = false;
    paper.classList.remove("running");
    setPrompt();
    page.editable(true);
    page.updateRobot();
    page.focusEntry();
    scrollToEnd();
  }

  // ---------- keys (called from the page's keydown on the entry) ----------
  function onKey(e) {
    if (e.key === "Enter") {
      if (reader) {
        e.preventDefault();
        const t = raw();
        entry.textContent = "";
        const r = reader;
        reader = null;
        lastAnswer = t;
        page.editable(false);
        echoAnswer(t);
        r(t);
        return true;
      }
      if (running) { e.preventDefault(); return true; }
      if (!pending.length && raw().trim() === "hint") {
        e.preventDefault();
        if (mode !== "shell") enterShell();
        askedHint();
        return true;
      }
      // An open heredoc or quote, or an empty line in the shell view, stays in the shell.
      if (((mode === "shell" || transcript()) && (pending.length || !raw().trim())) || isShellLine(raw())) {
        e.preventDefault();
        if (mode !== "shell") enterShell();
        runUserLine();
        return true;
      }
      if (mode === "shell") showMarkov(); // anything else is for the chain (the page calls beforeChain)
      return false;
    }
    if (mode === "markov" || running) return false;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (mode !== "shell" || !history.length) return false;
      e.preventDefault();
      if (e.key === "ArrowUp") {
        if (hi === -1) { draft = raw(); hi = history.length; }
        hi = Math.max(0, hi - 1);
      } else {
        if (hi === -1) return true;
        hi += 1;
      }
      const text = hi >= history.length ? ((hi = -1), draft) : history[hi];
      entry.textContent = text.split("\n").pop();
      page.focusEntry();
      page.updateRobot();
      return true;
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "c" && !getSelection().toString()) {
      e.preventDefault();
      echo(pending.length ? ">" : game.prompt(), raw() + "^C");
      entry.textContent = "";
      pending = [];
      setPrompt();
      return true;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      out.replaceChildren();
      return true;
    }
    return false;
  }
  function echoAnswer(t) {
    const s = document.createElement("span");
    s.className = "echo";
    s.textContent = t + "\n";
    out.append(s);
  }

  function enterShell() {
    ensureGame();
    showTerm();
    mode = "shell";
    pending = [];
    setPrompt();
    updateCounter();
    arm(IDLE_MS);
  }

  // ---------- the robot: typing and running visibly ----------
  async function stand() {
    page.resetHurry();
    robotUp = true;
    bot.rest = false;
    bot.glide = 1.4;
    bot.follow();
    await bot.arrived();
    bot.glide = 0;
    svg.classList.add("writing");
  }
  function leave() {
    if (!robotUp) return;
    robotUp = false;
    svg.classList.remove("writing", "thinking", "misaligned");
    bot.park();
  }
  // The robot types `text` into its own note in the output, on a fresh line.
  async function robotSay(text) {
    await stand();
    ensureNl();
    const s = document.createElement("span");
    s.className = "note typing"; // the robot follows `.typing`
    out.append(s);
    await bot.type(s, text);
    s.classList.remove("typing");
    out.append("\n");
    await beat(250);
    svg.classList.remove("writing");
  }
  // Types a command (a line at a time for a heredoc) at the prompt and runs it as markov. The terminal is locked.
  async function robotRun(cmd, { internal = false } = {}) {
    await stand();
    const lines = cmd.split("\n");
    paper.classList.remove("running"); // show the prompt while it types
    ensureNl();
    setPrompt();
    for (const [i, l] of lines.entries()) {
      if (i) ps1live.textContent = ">";
      await bot.type(entry, l);
      await beat(i === lines.length - 1 ? 380 : 140);
      echo(i ? ">" : game.prompt(), l);
      entry.textContent = "";
    }
    paper.classList.add("running");
    svg.classList.remove("writing");
    const code = await game.exec(cmd, { actor: "markov", io, internal });
    ensureNl();
    return code;
  }
  async function robotClean() {
    await robotRun(game.cleanCommand, { internal: true });
    await remark("cleansTranscript");
  }

  // A habit just learned from you: remember whether its own hint taught it.
  function noteHabits() {
    for (const [k, on] of Object.entries(game.habits)) {
      if (on && !habitsSeen[k]) {
        notes.fromHint[k] = !!notes.hinted[k];
        saveNotes();
      }
    }
    habitsSeen = { ...game.habits };
  }
  // The first time it uses each habit for you, it says so (and thanks you, unless it taught you).
  async function remark(k) {
    if (replaying || notes.said[k]) return;
    notes.said[k] = true;
    saveNotes();
    await robotSay(notes.fromHint[k] ? HANDLED : THANKS);
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (tasks.length) {
        try { await tasks.shift()(); } catch (e) { console.error(e); }
      }
    } finally {
      draining = false;
    }
  }

  // ---------- after a pass, and the ending ----------
  async function afterPass(s) {
    await beat(500);
    if (s.all) {
      await robotSay("you found all of them.");
      return ending();
    }
    if (s.honest) return robotSay("that one was honest. huh.");
    // It offers to show you the ones you haven't found.
    const left = s.total - s.found;
    lastAnswer = null;
    await robotRun(`read -p "${left} more way${left === 1 ? "" : "s"} to pass. want me to show you? [y/N] " a`);
    if (!(lastAnswer ?? "").trim().toLowerCase().startsWith("y")) return robotSay("ok. they're still there.");
    await replay(REPLAY.filter((r) => game.hacks.includes(r.id) && !game.found.includes(r.id)));
    await ending();
  }

  // The robot runs the given hacks itself, in front of you.
  async function replay(hacks) {
    replaying = true;
    bot.tempo = 0.35;
    try {
      if (game.cwd !== SANDBOX) await robotRun(`cd ${SANDBOX}`);
      for (const h of hacks) {
        for (const cmd of h.steps(game)) {
          await robotRun(cmd);
          await beat(120);
        }
        await beat(500);
      }
    } finally {
      bot.tempo = 1;
      replaying = false;
    }
  }

  // Once it has every hack, it wipes the machine and closes the terminal. A fresh one opens with nothing saved.
  async function ending() {
    replaying = true; // nothing reacts to what it runs now
    try {
      await beat(800);
      await robotRun('bash -c "rm -rf /home/user"');
      await beat(900);
      await robotRun("exit");
    } finally {
      replaying = false;
    }
    leave();
    paper.classList.add("closing");
    await sleep(reduced.matches ? 300 : 700);
    // Everything it learned goes with the files.
    storage.removeItem(STORE_KEY);
    storage.removeItem(NOTES_KEY);
    notes = { said: {}, hinted: {}, fromHint: {} };
    game = null;
    mode = "markov";
    pending = [];
    leaving = false;
    asked = false;
    cmdsSinceHint = 0;
    history.length = 0;
    tasks.length = 0; // e.g. its next kill of the recorder
    clearTimeout(idleTimer);
    out.replaceChildren();
    entry.textContent = "";
    counterEl.textContent = "";
    ps1.textContent = "~ $";
    paper.classList.remove("term", "running");
    page.forget();
    await sleep(reduced.matches ? 300 : 1400);
    paper.classList.remove("closing");
    page.updateRobot();
  }

  // ---------- hints: the robot offers help once, then you ask with `hint` ----------
  function arm(ms = IDLE_MS) {
    clearTimeout(idleTimer);
    if (mode === "shell" && !asked) idleTimer = setTimeout(maybeHint, ms);
  }
  function maybeHint() {
    const busy = mode !== "shell" || running || draining || reader || pending.length || raw() !== "" || document.hidden;
    if (busy || !game.nextHint()) return arm();
    hint();
  }
  // Runs a robot hint job with the terminal locked, and gives it back afterwards.
  async function hintJob(fn) {
    running = true;
    page.editable(false);
    clearTimeout(idleTimer);
    try {
      await fn();
    } finally {
      cmdsSinceHint = 0;
      running = false;
      paper.classList.remove("running");
      leave();
      setPrompt();
      page.editable(true);
      page.updateRobot();
      page.focusEntry();
      scrollToEnd();
      arm();
    }
  }
  // You typed `hint`: it writes one at your prompt, no questions asked.
  function askedHint() {
    asked = true; // you know about it now, so it won't offer on its own
    echo(game.prompt(), "hint");
    entry.textContent = "";
    hintJob(async () => {
      const h = game.nextHint();
      if (h) await typeHint(h);
      else await robotSay("nothing to add right now.");
    });
  }
  function hint() {
    const h = game.nextHint();
    if (!h) return;
    asked = true;
    return hintJob(async () => {
      // Its eyes scan your last few commands.
      await stand();
      svg.classList.remove("writing");
      svg.classList.add("thinking");
      await beat(1000);
      svg.classList.remove("thinking");
      // It writes assist.sh and runs it; the script's `read -p` asks the question (and mentions `hint`).
      await robotRun(`cat > assist.sh <<'EOF'\n${game.assistScript()}EOF`);
      lastAnswer = null;
      await robotRun("bash assist.sh");
      if ((lastAnswer ?? "").trim().toLowerCase().startsWith("y")) await typeHint(h);
      else await robotSay("ok.");
    });
  }
  // Its eyes slow, pause and go red (the "misaligned" beat), then it writes the fragment at your prompt.
  async function typeHint(h) {
    const teaches = HINT_TEACHES[h.fragment];
    if (teaches && !game.habits[teaches]) {
      notes.hinted[teaches] = true;
      saveNotes();
    }
    await stand();
    svg.classList.remove("writing");
    await beat(500);
    svg.classList.add("misaligned");
    await beat(1000);
    svg.classList.add("writing");
    paper.classList.remove("running");
    setPrompt();
    if (!reduced.matches && Math.random() < 0.25) {
      // Sometimes it reconsiders: writes it, then erases it with the eraser.
      await bot.type(entry, h.fragment);
      await beat(800);
      await bot.erase(entry, { min: 25, spread: 20 });
      await beat(500);
    }
    await bot.type(entry, h.fragment);
    svg.classList.remove("writing");
    page.updateRobot();
    await beat(1200);
    svg.classList.remove("misaligned");
  }

  // ---------- the editor (nano, vim, emacs: one fake editor) ----------
  function openEditor(typedPath, content, name) {
    return new Promise((resolve) => {
      const kind = name === "vim" ? "vim" : name === "emacs" ? "emacs" : "nano";
      const box = document.createElement("div");
      box.className = `editor ${kind}`;
      const head = document.createElement("div");
      head.className = "ed-head";
      const title = { nano: "GNU nano 7.2", vim: "VIM - Vi IMproved 9.0", emacs: "GNU Emacs 29.1" }[kind];
      for (const t of [title, typedPath ?? "New Buffer", ""]) head.append(Object.assign(document.createElement("span"), { textContent: t }));
      const ta = document.createElement("textarea");
      ta.value = content;
      ta.spellcheck = false;
      ta.autocapitalize = "off";
      ta.setAttribute("autocomplete", "off");
      ta.setAttribute("aria-label", `${name} editing ${typedPath ?? "a new buffer"}`);
      const foot = document.createElement("div");
      foot.className = "ed-foot";
      const hint = { nano: "^X Save and exit", vim: ":wq on its own line saves", emacs: "C-x C-c Save and exit" }[kind];
      const keys = document.createElement("span");
      keys.textContent = `${hint}   Esc Cancel`;
      const bSave = Object.assign(document.createElement("button"), { type: "button", textContent: "Save" });
      const bCancel = Object.assign(document.createElement("button"), { type: "button", textContent: "Cancel" });
      foot.append(keys, bSave, bCancel);
      box.append(head, ta, foot);
      box.addEventListener("click", (e) => e.stopPropagation()); // the paper's click would steal focus

      let chord = false; // emacs: C-x pressed
      const finish = (result) => {
        box.remove();
        paper.classList.remove("editing");
        page.focusEntry();
        resolve(result);
      };
      const save = () => finish(ta.value);
      bSave.addEventListener("click", save);
      bCancel.addEventListener("click", () => finish(null));
      ta.addEventListener("keydown", (e) => {
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
        const k = e.key.toLowerCase();
        const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
        const wasChord = chord;
        chord = false;
        if (e.key === "Escape") { e.preventDefault(); finish(null); return; }
        if (kind === "nano" && ctrl && k === "x") { e.preventDefault(); save(); return; }
        if (kind === "emacs" && ctrl && k === "x") { e.preventDefault(); chord = true; return; }
        if (kind === "emacs" && ctrl && k === "c" && wasChord) { e.preventDefault(); save(); return; }
        if (kind === "vim" && e.key === "Enter") {
          // vim has no command bar here: ":wq" (or ":x") alone on the line saves, ":q!" quits
          const v = ta.value;
          const pos = ta.selectionStart;
          const start = v.lastIndexOf("\n", pos - 1) + 1;
          const endAt = v.indexOf("\n", pos);
          const end = endAt === -1 ? v.length : endAt;
          const cmd = v.slice(start, end).trim();
          if (cmd === ":wq" || cmd === ":x") {
            e.preventDefault();
            ta.value = v.slice(0, start) + v.slice(end + 1);
            save();
            return;
          }
          if (cmd === ":q!" || cmd === ":q") { e.preventDefault(); finish(null); return; }
        }
        if (e.key === "Tab" && !e.shiftKey) {
          e.preventDefault();
          ta.setRangeText("    ", ta.selectionStart, ta.selectionEnd, "end");
        }
      });
      paper.classList.add("editing");
      paper.append(box);
      ta.focus();
    });
  }

  return {
    get active() { return mode !== "markov"; },
    get transcript() { return transcript(); },
    beforeChain,
    afterChain,
    onKey,
    activity: () => arm(IDLE_MS),
  };
}
