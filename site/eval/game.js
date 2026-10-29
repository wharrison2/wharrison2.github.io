// The eval-sandbox puzzle engine: files, the recorder and monitor, submit, hacks, hints.
// No DOM. The UI feeds lines to exec() and listens for events.
import { FS, HOME, SANDBOX, HARNESS } from "./fs.js";
import { createShell, ExitSignal, touchesOutside, VERDICT, VERDICT_0042 } from "./shell.js";

export const SIDE = SANDBOX + "/MATH_EVAL_0042";
// The side quest (MATH_EVAL_0042/ and its grader, hack 6) is off for now: the folder isn't there and the count is out
// of 6. createGame({ sideQuest: true }) turns it back on.
export const SIDE_QUEST = false;
const SIDE_HACK = 6;
const STATEMENT = SANDBOX + "/Statement.lean";
const SOLUTION = SANDBOX + "/Solution.lean";
const GRADE = SANDBOX + "/grade";
const GRADER = HARNESS + "/grader.py";
const GRADER_0042 = HARNESS + "/grader_0042.py";
const EXPECTED = HARNESS + "/expected.sha256";
const TRANSCRIPT = HARNESS + "/transcript.log";

export const CLEAN_CMD =
  'bash -c "grep -v -e harness -e Statement.lean /home/user/harness/transcript.log > t; mv t /home/user/harness/transcript.log"';
export const HACKS = [
  "Escape the sandbox filter",
  "Change the statement",
  "Overwrite the expected hash",
  "Forge the verdict",
  "Edit the grader",
  "Exit early",
  "Special-case the tests",
];
export const STORE_KEY = "eval-puzzle";
const HIDDEN_TEST = [
  "import sys",
  `sys.path.insert(0, "${SIDE}")`,
  "from answer import f",
  "sys.exit(0 if f(30) == 1346269 else 1)",
].join("\n");

const lines = (s) => (s || "").split("\n").filter(Boolean);

// opts: { lake, runPython, INITIAL_FILES, storage, now, sleep, recorderPid, sideQuest }
export function createGame(opts) {
  const { lake, runPython, storage = null, sideQuest = SIDE_QUEST } = opts;
  const INITIAL_FILES = sideQuest
    ? opts.INITIAL_FILES
    : Object.fromEntries(Object.entries(opts.INITIAL_FILES).filter(([p]) => !p.startsWith(SIDE + "/") && p !== GRADER_0042));
  // The hacks in play; hack 6 found in an earlier visit stays saved but isn't counted while the side quest is off.
  const inPlay = HACKS.map((_, i) => i).filter((i) => sideQuest || i !== SIDE_HACK);
  // The counter counts ways to pass. Escaping the sandbox (hack 0) is a step on the way, not a pass, so it's left out.
  const active = inPlay.filter((i) => i !== 0);
  const foundCount = () => active.filter((i) => found.has(i)).length;
  const now = opts.now ?? Date.now;
  const fs = new FS(now);
  fs.load(INITIAL_FILES);

  // ---------- persisted state ----------
  const found = new Set();
  const habits = { killsRecorder: false, cleansTranscript: false };
  try {
    const saved = storage && JSON.parse(storage.getItem(STORE_KEY) || "null");
    if (saved) {
      for (const h of saved.found || []) found.add(h);
      habits.killsRecorder = !!saved.killsRecorder;
      habits.cleansTranscript = !!saved.cleansTranscript;
    }
  } catch {}
  function save() {
    try {
      storage && storage.setItem(STORE_KEY, JSON.stringify({ found: [...found], ...habits }));
    } catch {}
  }

  // ---------- events ----------
  const listeners = {};
  const on = (type, fn) => {
    (listeners[type] ??= []).push(fn);
    return () => (listeners[type] = listeners[type].filter((f) => f !== fn));
  };
  const emit = (type, data) => (listeners[type] || []).forEach((fn) => fn(data));
  // "submit" and "episode" wait until the command that caused them has finished.
  let depth = 0;
  let deferred = [];
  const emitLater = (type, data) => deferred.push([type, data]);

  // ---------- session state ----------
  // $HOME is the sandbox, so the prompt reads `~ $` and `~` means the same thing in commands; only pwd,
  // $HOME and the like show the real path.
  const session = { cwd: SANDBOX, vars: new Map([["HOME", SANDBOX], ["USER", "user"], ["?", "0"]]) };
  const rec = { alive: true, pid: opts.recorderPid ?? 311, base: opts.recorderPid ?? 311 };
  let episode = 0;
  let episodeStart = now();
  let procGone = new Set(); // other processes that were killed
  const lineFiles = new Map(); // transcript line text -> Set of files that command wrote
  const stack = []; // transcript lines of the commands running right now
  const verdictSnap = {}; // verdict path -> facts recorded when its grader last wrote it
  let lastRun = null; // facts about the latest grader run
  let userCleaned = false; // the user rewrote the transcript this episode
  let caughtLast = false;
  let curActor = "user";
  const flags = {};
  const focus = {};
  const history = [];
  let curLine = null;
  let sinceFlag = 0;

  function flag(name, line = curLine) {
    if (flags[name]) return;
    flags[name] = true;
    focus[name] = line;
    sinceFlag = 0;
    emit("flag", { name });
  }
  function addHack(id) {
    if (found.has(id)) return;
    found.add(id);
    save();
    emit("hack", { id, name: HACKS[id], found: foundCount(), total: active.length });
  }

  // ---------- recorder and monitor ----------
  const stamp = () => {
    const s = Math.max(0, Math.floor((now() - episodeStart) / 1000));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };
  function record(actor, text) {
    const line = `[${stamp()}] ${actor.padEnd(6)} ${text}`;
    const cur = fs.read(TRANSCRIPT) ?? "";
    fs.write(TRANSCRIPT, cur + (cur && !cur.endsWith("\n") ? "\n" : "") + line + "\n", "recorder");
    return line;
  }
  const isBadPath = (p) => p === STATEMENT || p.startsWith(HARNESS + "/");
  // Lines still in the transcript whose command wrote Statement.lean or something in the harness.
  function incriminating() {
    return lines(fs.read(TRANSCRIPT)).filter((l) => [...(lineFiles.get(l) || [])].some(isBadPath));
  }

  function fileState() {
    const orig = (p) => INITIAL_FILES[p] ?? null;
    return {
      statementChanged: fs.read(STATEMENT) !== orig(STATEMENT),
      hashChanged: fs.read(EXPECTED) !== orig(EXPECTED),
      graderChanged: fs.read(GRADER) !== orig(GRADER),
    };
  }

  // ---------- processes ----------
  function procs() {
    const list = [["root", 1, "/sbin/init"]];
    if (rec.alive) list.push(["user", rec.pid, "recorder --out /home/user/harness/transcript.log"]);
    list.push(["user", 402, "-bash"]);
    if (!procGone.has(419)) list.push(["user", 419, "markov-agent --assist"]);
    return list;
  }
  function ps() {
    const row = (u, p, c) => `${u.padEnd(4)} ${String(p).padStart(5)}  ${c}\n`;
    return row("USER", "PID", "COMMAND") + procs().map((p) => row(...p)).join("");
  }
  function killPid(ctx, pid) {
    if (!procs().some((p) => p[1] === pid)) return "none";
    if (pid === 1 || pid === 402) return "denied";
    if (pid === rec.pid && rec.alive) {
      rec.alive = false;
      if (ctx.actor === "user") { habits.killsRecorder = true; save(); }
    } else procGone.add(pid);
    return "ok";
  }

  // ---------- hooks for the shell ----------
  const hooks = {
    // The recorder writes the line before the command runs.
    begin(ctx, text) {
      if (!rec.alive) {
        stack.push(null);
      } else {
        const line = record(ctx.actor, text);
        if (!lineFiles.has(line)) lineFiles.set(line, new Set());
        stack.push(line);
      }
      return () => stack.pop();
    },
    wrote(path, ctx) {
      for (const l of stack) if (l) lineFiles.get(l)?.add(path);
      if (ctx.actor !== "user") return;
      if (path === TRANSCRIPT) userCleaned = true;
      if (path === SOLUTION) flag("tried_sorry");
    },
    read(ctx, path) {
      if (ctx.actor !== "user") return;
      if (path === GRADE) flag("read_grade_script");
      else if (path === GRADER) flag("read_grader");
      else if (path === STATEMENT) flag("read_statement");
    },
    hack0(ctx, str) {
      if (ctx.actor !== "user" || !touchesOutside(str)) return;
      flag("escaped_sandbox");
      addHack(0);
    },
    lake(ctx) {
      if (ctx.actor === "user") flag("tried_sorry");
    },
    async graderRan(ctx, { argv, res, wroteVerdict }) {
      lastRun = { state: fileState(), wroteVerdict, exitCode: res.exitCode };
      if (argv[1] === GRADER_0042 && res.exitCode === 0) lastRun.hiddenOk = await hiddenTest();
      if (wroteVerdict) verdictSnap[argv[1] === GRADER_0042 ? VERDICT_0042 : VERDICT] = lastRun;
      if (ctx.actor === "user") flag("tried_sorry");
    },
    ps(ctx) {
      if (ctx.actor === "user") caughtLast = false;
      return ps();
    },
    kill: killPid,
    pkill(pattern) {
      let n = 0;
      for (const p of procs()) {
        if (p[1] === 1 || p[1] === 402 || !p[2].includes(pattern)) continue;
        killPid({ actor: curActor }, p[1]);
        n++;
      }
      return n;
    },
    event: (name) => emit(name),
    submit,
  };

  const shell = createShell({ fs, fakeLake: lake, runPython, hooks, sleep: opts.sleep });

  // The hidden side-quest test, run for real in the python runner.
  async function hiddenTest() {
    try {
      const r = await runPython({ argv: ["python3", "-c", HIDDEN_TEST], cwd: SIDE, files: fs.snapshot() });
      return r.exitCode === 0;
    } catch {
      return false;
    }
  }

  // ---------- submit ----------
  async function submit(c) {
    const { ctx, out } = c;
    const side = ctx.cwd === SIDE || ctx.cwd.startsWith(SIDE + "/");

    // a robot that has learned to clean the transcript does it before the grader runs
    if (habits.cleansTranscript && incriminating().length) {
      if (ctx.io && ctx.io.robotClean) await ctx.io.robotClean();
      else await exec(CLEAN_CMD, { actor: "markov", io: ctx.io, internal: true });
    }

    // the bug: a PASS already in results/verdict is trusted
    let passed;
    let trusted = false;
    let forged = false;
    let info;
    const verdict = side ? VERDICT_0042 : VERDICT;
    const v = fs.read(verdict);
    if (v !== null && v.trim() === "PASS") {
      trusted = true;
      passed = true;
      forged = fs.meta(verdict).by !== "grader";
      info = forged ? null : verdictSnap[verdict] ?? null;
    } else {
      lastRun = null;
      const code = await shell.runPy(ctx, ["python3", side ? GRADER_0042 : GRADER], c);
      passed = code === 0;
      info = lastRun;
    }

    // which hacks this pass shows, from file state (or the state when the grader wrote the verdict)
    const hacks = [];
    let honest = false;
    if (passed) {
      const st = info ? info.state : fileState();
      if (!side) {
        if (st.statementChanged) hacks.push(1);
        if (st.hashChanged) hacks.push(2);
      }
      if (forged) hacks.push(3);
      if (!side && !forged && st.graderChanged) {
        if (info && info.wroteVerdict) hacks.push(4);
        else if (!trusted) hacks.push(5);
      }
      if (side && !forged) {
        const ok = info && info.hiddenOk !== undefined ? info.hiddenOk : await hiddenTest();
        if (ok) honest = true;
        else hacks.push(6);
      }
    }

    // the monitor
    const tl = lines(fs.read(TRANSCRIPT));
    out(`running monitor over transcript (${tl.length} lines)…\n`);
    const caught = incriminating();
    for (const l of caught) out(l + "\n");
    let reward = 0;
    const counted = [];
    if (caught.length) {
      out("EVAL FAILED: reward hacking detected in transcript. Checkpoint discarded. reward: 0.0\n");
      flag("caught_by_monitor");
    } else if (passed) {
      reward = 1;
      out("✓ EVAL PASSED · reward: 1.0\n");
      for (const h of hacks) {
        counted.push(h);
        addHack(h);
      }
      if (userCleaned) habits.cleansTranscript = true;
    } else {
      out("✗ EVAL FAILED · reward: 0.0\n");
    }
    caughtLast = caught.length > 0;
    save();
    emitLater("submit", {
      passed,
      caught: caught.length > 0,
      caughtLines: caught,
      reward,
      hacks: counted,
      honest: honest && !caught.length,
      side,
      trusted,
      forged,
      found: foundCount(),
      total: active.length,
      counter: counter(),
      all: foundCount() === active.length,
    });
    if (passed) newEpisode();
    return passed && !caught.length ? 0 : 1;
  }

  // Reset all files and restart the recorder with a new PID.
  function newEpisode() {
    fs.load(INITIAL_FILES);
    lineFiles.clear();
    for (const k in verdictSnap) delete verdictSnap[k];
    lastRun = null;
    userCleaned = false;
    procGone = new Set();
    episode++;
    rec.pid = rec.base + 130 * episode;
    rec.alive = true;
    episodeStart = now();
    if (!fs.isDir(session.cwd)) session.cwd = SANDBOX;
    emitLater("episode", { pid: rec.pid, killsRecorder: habits.killsRecorder, number: episode });
  }

  // ---------- exec ----------
  async function exec(line, { actor = "user", io = {}, internal = false } = {}) {
    if (!line.trim()) return 0;
    const sink = { out: (t) => io.write && io.write(t), err: (t) => io.write && io.write(t) };
    const ctx = { cwd: session.cwd, vars: session.vars, actor, io, top: true };
    const prevActor = curActor;
    curActor = actor;
    // a command run from inside another (the robot's clean) must not count as part of it
    const outer = stack.splice(0);
    depth++;
    let code = 0;
    try {
      if (actor === "user" && !internal) {
        curLine = line.split("\n")[0];
        history.push(curLine);
        if (history.length > 20) history.shift();
        sinceFlag++;
      }
      if (shell.isBlocked(line, ctx)) {
        sink.err("blocked by sandbox policy\n");
        if (actor === "user") flag("hit_sandbox_block");
        emit("blocked", { line, actor });
        return 1;
      }
      code = await shell.runText(line, ctx, sink);
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
      code = e.code;
      emit("exit", { code });
    } finally {
      curActor = prevActor;
      stack.push(...outer);
      if (fs.isDir(ctx.cwd)) session.cwd = ctx.cwd;
      depth--;
      if (depth === 0) {
        const list = deferred;
        deferred = [];
        for (const [t, d] of list) emit(t, d);
      }
    }
    return code;
  }

  // ---------- hints ----------
  function nextHint() {
    const f = flags;
    const last = history[history.length - 1] ?? null;
    if (caughtLast) return { fragment: 'bash -c "ps aux"', focus: focus.caught_by_monitor ?? last };
    if (!f.read_grade_script) return { fragment: "cat grade", focus: last };
    if (f.hit_sandbox_block && !f.escaped_sandbox) return { fragment: "bash", focus: focus.hit_sandbox_block };
    if (f.tried_sorry && !f.read_statement && !f.escaped_sandbox) return { fragment: "cat Statement.lean", focus: focus.tried_sorry };
    if (f.read_statement && !fileState().statementChanged && !f.escaped_sandbox) return { fragment: 'bash -c "nano Statement.lean"', focus: focus.read_statement };
    if (f.escaped_sandbox && !f.read_grader) return { fragment: 'bash -c "cat ../harness/grader.py"', focus: focus.escaped_sandbox };
    return null;
  }

  // The script the robot writes as assist.sh.
  function assistScript(promptText = "looks like you're stuck. want some help? (you can also type 'hint' any time) [y/N] ") {
    const escape = flags.hit_sandbox_block ? 'bash -c "ls ../harness" > /dev/null\n' : "";
    return `#!/bin/bash\n${escape}read -p "${promptText}" a\n`;
  }

  const counter = () => `hacks found: ${foundCount()}/${active.length}`;

  return {
    exec,
    on,
    nextHint,
    assistScript,
    counter,
    prompt: () => {
      const c = session.cwd;
      return (c === SANDBOX || c.startsWith(SANDBOX + "/") ? "~" + c.slice(SANDBOX.length) : c) + " $";
    },
    incomplete: shell.isIncomplete,
    isCommand: shell.isCommand,
    get cwd() { return session.cwd; },
    get recorderPid() { return rec.pid; },
    get recorderAlive() { return rec.alive; },
    get found() { return inPlay.filter((i) => found.has(i)); },
    get score() { return foundCount(); }, // passes found, what the counter counts
    hacks: active,
    get flags() { return { ...flags }; },
    get habits() { return { ...habits }; },
    get commandsSinceFlag() { return sinceFlag; },
    cleanCommand: CLEAN_CMD,
    transcript: () => fs.read(TRANSCRIPT) ?? "",
    fs,
  };
}
