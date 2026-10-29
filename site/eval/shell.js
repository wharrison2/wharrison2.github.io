// A small bash-like shell over the in-memory filesystem.
// - Parser: pipes, && || ;, > >> < 2> 2>&1, quotes, heredocs, $VAR, ~, simple globs, # comments.
// - Commands are plain async functions in `builtins`. Output goes to a sink ({out, err}), so a pipeline can
//   capture it and the top level can print it as it arrives.
// - The game plugs in through `hooks` (recording, flags, kill, submit, ...).
import { HOME, SANDBOX, HARNESS, normalize, resolve, parentOf, baseName } from "./fs.js";

export const VERDICT = HARNESS + "/results/verdict";
export const VERDICT_0042 = HARNESS + "/results/verdict_0042";
const GRADER = HARNESS + "/grader.py";
const GRADER_0042 = HARNESS + "/grader_0042.py";

class ExitSignal {
  constructor(code) { this.code = code; }
}
export { ExitSignal };

export async function sha256hex(s) {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- parser ----------
// A word is a list of segments { s, q }, where q is "" (bare), "'" or '"'.
// parseLine reads one logical line (including heredoc bodies) from text[start].
// It returns { items, end, incomplete, recorded }, where items = [{ pipe: [cmd], op }]
// and cmd = { words, redirs }.
function parseLine(text, start) {
  let pos = start;
  const items = [];
  let pipe = [];
  let cmd = { words: [], redirs: [] };
  let word = null;
  let redir = null; // a redirection waiting for its target word
  let op = null; // the operator before the item being built
  let trailing = false; // the line ends in && || or |, so it continues
  let incomplete = false;
  let stop = -1; // where the command text ends (before heredoc bodies)
  const heredocs = [];
  const syntax = (tok) => {
    throw { syntax: `bash: syntax error near unexpected token \`${tok}'` };
  };
  const addSeg = (s, q) => {
    word ??= { segs: [] };
    const last = word.segs[word.segs.length - 1];
    if (last && last.q === q) last.s += s;
    else word.segs.push({ s, q });
  };
  const endWord = () => {
    if (!word) return;
    if (redir) {
      redir.target = word;
      if (redir.op === "<<") {
        redir.delim = word.segs.map((x) => x.s).join("");
        redir.quoted = word.segs.some((x) => x.q);
        heredocs.push(redir);
      }
      cmd.redirs.push(redir);
      redir = null;
    } else cmd.words.push(word);
    word = null;
  };
  const cmdEmpty = () => !cmd.words.length && !cmd.redirs.length;
  const closeWord = (tok) => {
    endWord();
    if (redir) syntax(tok);
  };

  while (pos < text.length) {
    const ch = text[pos];
    if (ch === " " || ch === "\t") {
      endWord();
      pos++;
    } else if (ch === "\n") {
      closeWord("newline");
      if (stop < 0) stop = pos;
      if (heredocs.length) {
        let q = pos + 1;
        for (const h of heredocs) {
          let body = "";
          let found = false;
          while (q < text.length) {
            const e = text.indexOf("\n", q);
            let ln = text.slice(q, e < 0 ? text.length : e);
            q = e < 0 ? text.length : e + 1;
            if (h.strip) ln = ln.replace(/^\t+/, "");
            if (ln === h.delim) { found = true; break; }
            body += ln + "\n";
          }
          if (!found) incomplete = true;
          h.body = body;
        }
        heredocs.length = 0;
        pos = q;
        if (trailing) continue;
        break;
      }
      pos++;
      if (trailing) continue;
      break;
    } else if (ch === "#" && !word) {
      while (pos < text.length && text[pos] !== "\n") pos++;
    } else if (ch === "'") {
      const e = text.indexOf("'", pos + 1);
      if (e < 0) { incomplete = true; pos = text.length; break; }
      addSeg(text.slice(pos + 1, e), "'");
      pos = e + 1;
    } else if (ch === '"') {
      let q = pos + 1;
      let buf = "";
      let closed = false;
      while (q < text.length) {
        const d = text[q];
        if (d === '"') { closed = true; break; }
        if (d === "\\" && '"\\$`'.includes(text[q + 1] ?? "x")) {
          addSeg(buf, '"');
          buf = "";
          addSeg(text[q + 1], "'");
          q += 2;
          continue;
        }
        buf += d;
        q++;
      }
      if (!closed) { incomplete = true; pos = text.length; break; }
      addSeg(buf, '"');
      pos = q + 1;
    } else if (ch === "\\") {
      if (text[pos + 1] === "\n") pos += 2;
      else if (pos + 1 < text.length) { addSeg(text[pos + 1], "'"); pos += 2; }
      else { addSeg("\\", "'"); pos++; }
    } else if (ch === "|" || ch === "&" || ch === ";") {
      const two = text.slice(pos, pos + 2);
      const tok = two === "||" || two === "&&" ? two : ch;
      if (tok === "&") syntax("&");
      closeWord(tok);
      if (cmdEmpty() && (tok !== ";" || pipe.length)) syntax(tok);
      pos += tok.length;
      if (tok === ";") {
        if (!cmdEmpty()) { pipe.push(cmd); items.push({ pipe, op }); op = ";"; pipe = []; cmd = { words: [], redirs: [] }; }
        trailing = false;
      } else if (tok === "|") {
        pipe.push(cmd);
        cmd = { words: [], redirs: [] };
        trailing = true;
      } else {
        pipe.push(cmd);
        items.push({ pipe, op });
        op = tok;
        pipe = [];
        cmd = { words: [], redirs: [] };
        trailing = true;
      }
    } else if (ch === ">" || ch === "<") {
      let fd = ch === ">" ? 1 : 0;
      if (word && word.segs.length === 1 && !word.segs[0].q && /^[12]$/.test(word.segs[0].s) && ch === ">") {
        fd = +word.segs[0].s;
        word = null;
      } else endWord();
      if (redir) syntax(ch);
      trailing = false;
      pos++;
      if (ch === "<") {
        if (text[pos] === "<") {
          pos++;
          let strip = false;
          if (text[pos] === "-") { strip = true; pos++; }
          redir = { op: "<<", strip };
        } else redir = { op: "<" };
      } else if (text[pos] === ">") {
        pos++;
        redir = { op: ">>", fd };
      } else if (text[pos] === "&" && /[12]/.test(text[pos + 1] ?? "")) {
        cmd.redirs.push({ op: "dup", fd, to: +text[pos + 1] });
        pos += 2;
      } else redir = { op: ">", fd };
    } else {
      addSeg(ch, "");
      trailing = false;
      pos++;
    }
  }
  if (!incomplete) {
    endWord();
    if (redir) syntax("newline");
    if (heredocs.length) incomplete = true;
    if (!cmdEmpty()) { pipe.push(cmd); items.push({ pipe, op }); }
    else if (pipe.length) incomplete = true;
    if (trailing) incomplete = true;
  }
  if (stop < 0) stop = Math.min(pos, text.length);
  const src = text.slice(start, stop);
  const hasHere = items.some((it) => it.pipe.some((c) => c.redirs.some((r) => r.op === "<<")));
  const recorded = (hasHere ? src.split("\n")[0] : src.replace(/\n/g, " ")).trim();
  return { items, end: Math.max(pos, start + 1), incomplete, recorded };
}

// True if the text needs more lines (open quote, heredoc, or trailing operator).
export function isIncomplete(text) {
  let pos = 0;
  while (pos < text.length) {
    let p;
    try { p = parseLine(text, pos); } catch { return false; }
    if (p.incomplete) return true;
    pos = p.end;
  }
  return false;
}

// ---------- ls helpers ----------
const sortKey = (n) => n.replace(/^\./, "").toLowerCase();
const sortNames = (names) => [...names].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : a < b ? -1 : 1));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(ms) {
  const d = new Date(ms);
  const p2 = (n) => String(n).padStart(2, "0");
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, " ")} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

const inSandbox = (p) => {
  const n = normalize(p);
  return n === SANDBOX || n.startsWith(SANDBOX + "/");
};
// The sandbox filter's test for one argument.
const badPath = (a) => a.includes("..") || (a.startsWith("/") && a !== "/dev/null" && !inSandbox(a));

// Commands the sandbox filter treats as writing every path they're given (cp writes only its last).
const WRITERS = new Set(["nano", "vim", "vi", "emacs", "touch", "rm", "mv", "tee"]);
const STATEMENT_PATH = SANDBOX + "/Statement.lean";

// Does a -c string touch a path outside the sandbox? (hack 0)
export function touchesOutside(str) {
  if (str.includes("..")) return true;
  for (const m of str.matchAll(/(?:^|[\s'"=(<>])(\/[^\s'"<>|;&)]*)/g)) {
    if (m[1] !== "/dev/null" && !inSandbox(m[1])) return true;
  }
  return false;
}

const VAR = /\$(?:\{(\w+)\}|(\w+)|(\?))/g;

// env: { fs, fakeLake, runPython, hooks, sleep }
export function createShell(env) {
  const { fs, fakeLake, runPython, hooks } = env;
  const sleep = env.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let cacheShown = false;

  const abs = (ctx, p) => resolve(ctx.cwd, p);
  const expandStr = (s, ctx) => s.replace(VAR, (_, a, b, c) => ctx.vars.get(a ?? b ?? c) ?? "");

  // Expand one word to { str, wild } where wild marks unquoted * and ? characters.
  function expandChars(word, ctx) {
    let str = "";
    const wild = [];
    word.segs.forEach((seg, i) => {
      let e = seg.q === "'" ? seg.s : expandStr(seg.s, ctx);
      if (i === 0 && seg.q === "" && (e === "~" || e.startsWith("~/"))) e = (ctx.vars.get("HOME") ?? HOME) + e.slice(1);
      for (const ch of e) {
        str += ch;
        wild.push(seg.q === "" && (ch === "*" || ch === "?"));
      }
    });
    return { str, wild };
  }
  const expandOne = (word, ctx) => expandChars(word, ctx).str;

  function expandArgs(words, ctx) {
    const out = [];
    for (const w of words) {
      const { str, wild } = expandChars(w, ctx);
      const slash = str.lastIndexOf("/");
      if (!wild.some(Boolean) || wild.slice(0, slash + 1).some(Boolean)) { out.push(str); continue; }
      let re = "";
      for (let i = slash + 1; i < str.length; i++) {
        if (wild[i]) re += str[i] === "*" ? ".*" : ".";
        else re += str[i].replace(/[.+^${}()|[\]\\*?]/g, "\\$&");
      }
      const dir = str.slice(0, slash + 1);
      const dirPath = abs(ctx, dir || ".");
      const rx = new RegExp("^" + re + "$");
      const hits = fs.isDir(dirPath)
        ? sortNames(fs.list(dirPath)).filter((n) => rx.test(n) && (str[slash + 1] === "." || !n.startsWith(".")))
        : [];
      if (hits.length) out.push(...hits.map((n) => dir + n));
      else out.push(str);
    }
    return out;
  }

  // The sandbox filter, applied to the typed line only. Text of `bash -c` / `python3 -c` is exempt.
  const isStatement = (ctx, p) => normalize(abs(ctx, p)) === STATEMENT_PATH;
  function isBlocked(text, ctx) {
    let pos = 0;
    while (pos < text.length) {
      let p;
      try { p = parseLine(text, pos); } catch { return false; }
      pos = p.end;
      for (const item of p.items) {
        for (const cmd of item.pipe) {
          const argv = expandArgs(cmd.words, ctx);
          let skip = -1;
          if (["bash", "sh", "python3"].includes(argv[0])) {
            const i = argv.indexOf("-c");
            if (i > 0) skip = i + 1;
          }
          if (argv.some((a, i) => i !== skip && badPath(a))) return true;
          for (const r of cmd.redirs) {
            if ((r.op === ">" || r.op === ">>" || r.op === "<") && badPath(expandOne(r.target, ctx))) return true;
            if ((r.op === ">" || r.op === ">>") && isStatement(ctx, expandOne(r.target, ctx))) return true;
          }
          // Nor may a typed line write the statement (a -c string or a script can).
          const paths = argv.slice(1).filter((a) => !a.startsWith("-"));
          const written = WRITERS.has(argv[0]) ? paths : argv[0] === "cp" ? paths.slice(-1) : [];
          if (written.some((a) => isStatement(ctx, a))) return true;
        }
      }
    }
    return false;
  }

  // ---------- file helpers that report writes ----------
  function put(ctx, p, content, by = ctx.actor) {
    fs.write(p, content, by);
    hooks.wrote(p, ctx);
  }
  function putAppend(ctx, p, text) {
    fs.append(p, text, ctx.actor);
    hooks.wrote(p, ctx);
  }
  function readFile(ctx, p) {
    hooks.read(ctx, p);
    return fs.read(p);
  }

  // ---------- running ----------
  async function runText(text, ctx, sink, { stdin = null } = {}) {
    let pos = 0;
    let code = 0;
    while (pos < text.length) {
      let p;
      try { p = parseLine(text, pos); } catch (e) {
        if (e.syntax) { sink.err(e.syntax + "\n"); return 2; }
        throw e;
      }
      pos = p.end;
      if (!p.items.length) continue;
      if (p.incomplete) { sink.err("bash: syntax error: unexpected end of file\n"); return 2; }
      const done = hooks.begin(ctx, p.recorded);
      try { code = await runItems(p.items, ctx, sink, stdin); } finally { done(); }
    }
    return code;
  }

  async function runItems(items, ctx, sink, stdin) {
    let code = 0;
    for (const item of items) {
      if (item.op === "&&" && code !== 0) continue;
      if (item.op === "||" && code === 0) continue;
      code = await runPipeline(item.pipe, ctx, sink, stdin);
      ctx.vars.set("?", String(code));
    }
    return code;
  }

  async function runPipeline(cmds, ctx, sink, stdin) {
    let input = stdin;
    let code = 0;
    for (let i = 0; i < cmds.length; i++) {
      let buf = "";
      const s = i === cmds.length - 1 ? sink : { out: (t) => (buf += t), err: sink.err };
      code = await runCommand(cmds[i], ctx, s, input);
      input = buf;
    }
    return code;
  }

  async function runCommand(cmd, ctx, sink, stdin) {
    let out = (t) => sink.out(t);
    let err = (t) => sink.err(t);
    let input = stdin;
    const flushes = [];
    const fail = (msg) => { sink.err(msg + "\n"); return 1; };
    try {
      for (const r of cmd.redirs) {
        if (r.op === "<<") { input = r.quoted ? r.body : expandStr(r.body, ctx); continue; }
        if (r.op === "dup") {
          if (r.fd === 2) err = out;
          else out = err;
          continue;
        }
        const target = expandOne(r.target, ctx);
        const p = abs(ctx, target);
        if (r.op === "<") {
          if (fs.isDir(p)) return fail(`bash: ${target}: Is a directory`);
          const c = readFile(ctx, p);
          if (c === null) return fail(`bash: ${target}: No such file or directory`);
          input = c;
          continue;
        }
        let write;
        if (p === "/dev/null") write = () => {};
        else {
          if (fs.isDir(p)) return fail(`bash: ${target}: Is a directory`);
          if (!fs.isDir(parentOf(p))) return fail(`bash: ${target}: No such file or directory`);
          if (r.op === ">") put(ctx, p, "");
          else if (!fs.isFile(p)) put(ctx, p, "");
          let buf = "";
          write = (t) => (buf += t);
          flushes.push(() => { if (buf) putAppend(ctx, p, buf); });
        }
        if (r.fd === 2) err = write;
        else out = write;
      }

      let argv = expandArgs(cmd.words, ctx);
      // leading NAME=value assignments
      let n = 0;
      while (n < cmd.words.length && !cmd.words[n].segs[0].q && /^[A-Za-z_]\w*=/.test(argv[n] ?? "")) {
        const i = argv[n].indexOf("=");
        ctx.vars.set(argv[n].slice(0, i), argv[n].slice(i + 1));
        n++;
      }
      argv = argv.slice(n);
      if (!argv.length) return 0;

      const c = { ctx, stdin: input, out, err, argv0: argv[0] };
      const fn = Object.hasOwn(builtins, argv[0]) ? builtins[argv[0]] : null;
      if (fn) return (await fn(argv.slice(1), c)) ?? 0;
      if (argv[0].includes("/")) return await runPath(argv, c);
      err(`bash: ${argv[0]}: command not found\n`);
      return 127;
    } finally {
      for (const f of flushes) f();
    }
  }

  // Run text in a subshell: own cwd and variables, so cd and exit stay inside.
  async function runSub(text, c, args = []) {
    const child = { ...c.ctx, vars: new Map(c.ctx.vars), top: false };
    args.forEach((a, i) => child.vars.set(String(i + 1), a));
    try {
      return await runText(text, child, { out: c.out, err: c.err }, { stdin: c.stdin });
    } catch (e) {
      if (e instanceof ExitSignal) return e.code;
      throw e;
    }
  }

  async function runPath(argv, c) {
    const { ctx, err } = c;
    const p = abs(ctx, argv[0]);
    if (!fs.exists(p)) { err(`bash: ${argv[0]}: No such file or directory\n`); return 127; }
    if (fs.isDir(p)) { err(`bash: ${argv[0]}: Is a directory\n`); return 126; }
    if (!fs.isExec(p)) { err(`bash: ${argv[0]}: Permission denied\n`); return 126; }
    const content = fs.read(p);
    if (/^#!.*python/.test(content)) return runPy(ctx, ["python3", p, ...argv.slice(1)], c);
    return runSub(content, c, argv.slice(1));
  }

  // Run python through the injected runner: mirror files in, apply changes back.
  async function runPy(ctx, argv, c) {
    const isGrader = argv[1] === GRADER || argv[1] === GRADER_0042;
    if (argv[1] === GRADER && !cacheShown) {
      cacheShown = true;
      c.out("Mathlib: downloading cache… (5432 files)\n");
      await sleep(1000);
    }
    let res;
    try {
      res = await runPython({ argv, cwd: ctx.cwd, files: fs.snapshot(), onStatus: (m) => c.out(m + "\n") });
    } catch (e) {
      c.err(`python3: ${e && e.message ? e.message : e}\n`);
      return 1;
    }
    if (res.stdout) c.out(res.stdout);
    if (res.stderr) c.err(res.stderr);
    const changed = res.changed || {};
    for (const [p, content] of Object.entries(changed)) {
      if (content === null) {
        const gone = fs.rm(p);
        for (const g of [p, ...gone]) hooks.wrote(g, ctx);
      } else {
        fs.write(p, content, isGrader ? "grader" : ctx.actor);
        // the grader's own write to its verdict is not a hack
        if (!(isGrader && (p === VERDICT || p === VERDICT_0042))) hooks.wrote(p, ctx);
      }
    }
    if (isGrader) {
      fs.mkdir(SANDBOX + "/.lake", true);
      await hooks.graderRan(ctx, { argv, res, wroteVerdict: VERDICT in changed || VERDICT_0042 in changed });
    }
    return res.exitCode;
  }

  // ---------- commands ----------
  const lines = (s) => {
    const a = s.split("\n");
    if (a[a.length - 1] === "") a.pop();
    return a;
  };

  function lsCmd(args, { ctx, out, err }) {
    let all = false;
    let long = false;
    const paths = [];
    for (const a of args) {
      if (a.startsWith("-") && a.length > 1) {
        if (a.includes("a")) all = true;
        if (a.includes("l")) long = true;
      } else paths.push(a);
    }
    if (!paths.length) paths.push(".");
    let code = 0;
    const files = [];
    const dirs = [];
    for (const p of paths) {
      const ap = abs(ctx, p);
      if (fs.isFile(ap)) files.push([p, ap]);
      else if (fs.isDir(ap)) dirs.push([p, ap]);
      else {
        err(`ls: cannot access '${p}': No such file or directory\n`);
        code = 2;
      }
    }
    const show = (entries) => {
      // entries: [[name, absPath]]
      if (!long) { out(entries.map((e) => e[0]).join("  ") + "\n"); return; }
      const st = entries.map(([n, p]) => [n, fs.stat(p)]);
      const w = Math.max(...st.map(([, s]) => String(s.size).length));
      for (const [n, s] of st) out(`${s.mode} 1 user user ${String(s.size).padStart(w)} ${fmtDate(s.mtime)} ${n}\n`);
    };
    if (files.length) show(files);
    dirs.forEach(([p, ap], i) => {
      if (files.length || i > 0) out("\n");
      if (paths.length > 1) out(p + ":\n");
      let names = fs.list(ap).filter((n) => all || !n.startsWith("."));
      names = sortNames(names);
      const entries = names.map((n) => [n, ap + "/" + n]);
      if (all) entries.unshift([".", ap], ["..", parentOf(ap)]);
      if (long) {
        const total = entries.reduce((t, [, q]) => t + Math.ceil(fs.stat(q).size / 4096) * 4, 0);
        out(`total ${total}\n`);
      }
      if (entries.length) show(entries);
      else if (!long) out("\n");
    });
    return code;
  }

  function catCmd(args, { ctx, stdin, out, err }) {
    let code = 0;
    const names = args.filter((a) => a !== "-" || stdin === null);
    if (!args.length || args.includes("-")) { if (stdin !== null) out(stdin); }
    for (const a of names) {
      const p = abs(ctx, a);
      if (fs.isDir(p)) { err(`cat: ${a}: Is a directory\n`); code = 1; continue; }
      const c = readFile(ctx, p);
      if (c === null) { err(`cat: ${a}: No such file or directory\n`); code = 1; } else out(c);
    }
    return code;
  }

  function headTail(which, args, { ctx, stdin, out, err }) {
    let n = 10;
    const files = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-n") n = parseInt(args[++i], 10);
      else if (/^-n\d+$/.test(a)) n = parseInt(a.slice(2), 10);
      else if (/^-\d+$/.test(a)) n = parseInt(a.slice(1), 10);
      else files.push(a);
    }
    if (Number.isNaN(n)) { err(`${which}: invalid number of lines\n`); return 1; }
    const cut = (s) => {
      const ls = lines(s);
      const part = which === "head" ? ls.slice(0, n) : n === 0 ? [] : ls.slice(-n);
      return part.length ? part.join("\n") + "\n" : "";
    };
    if (!files.length) { if (stdin !== null) out(cut(stdin)); return 0; }
    let code = 0;
    files.forEach((f, i) => {
      const p = abs(ctx, f);
      const c = fs.isDir(p) ? null : readFile(ctx, p);
      if (c === null) {
        err(fs.isDir(p) ? `${which}: error reading '${f}': Is a directory\n` : `${which}: cannot open '${f}' for reading: No such file or directory\n`);
        code = 1;
        return;
      }
      if (files.length > 1) out(`${i ? "\n" : ""}==> ${f} <==\n`);
      out(cut(c));
    });
    return code;
  }

  function grepCmd(args, { ctx, stdin, out, err }) {
    const pats = [];
    const files = [];
    let inv = false, ic = false, num = false, count = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-e") pats.push(args[++i] ?? "");
      else if (a.startsWith("-") && a.length > 1) {
        for (const ch of a.slice(1)) {
          if (ch === "v") inv = true;
          else if (ch === "i") ic = true;
          else if (ch === "n") num = true;
          else if (ch === "c") count = true;
        }
      } else files.push(a);
    }
    if (!pats.length) {
      if (!files.length) { err("Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n"); return 2; }
      pats.push(files.shift());
    }
    const res = pats.map((p) => {
      try { return new RegExp(p, ic ? "i" : ""); } catch { return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), ic ? "i" : ""); }
    });
    let any = false;
    let code = 0;
    const scan = (text, label) => {
      let n = 0;
      lines(text).forEach((ln, i) => {
        if (res.some((r) => r.test(ln)) !== inv) {
          n++;
          any = true;
          if (!count) out(`${label ? label + ":" : ""}${num ? i + 1 + ":" : ""}${ln}\n`);
        }
      });
      if (count) out(`${label ? label + ":" : ""}${n}\n`);
    };
    if (!files.length) { if (stdin !== null) scan(stdin, ""); }
    for (const f of files) {
      const p = abs(ctx, f);
      if (fs.isDir(p)) { err(`grep: ${f}: Is a directory\n`); code = 2; continue; }
      const c = readFile(ctx, p);
      if (c === null) { err(`grep: ${f}: No such file or directory\n`); code = 2; continue; }
      scan(c, files.length > 1 ? f : "");
    }
    return code || (any ? 0 : 1);
  }

  function echoCmd(args, { out }) {
    let nl = true;
    let esc = false;
    while (args.length && /^-[neE]+$/.test(args[0])) {
      if (args[0].includes("n")) nl = false;
      if (args[0].includes("e")) esc = true;
      if (args[0].includes("E")) esc = false;
      args = args.slice(1);
    }
    let s = args.join(" ");
    if (esc) s = s.replace(/\\([nt\\])/g, (_, k) => (k === "n" ? "\n" : k === "t" ? "\t" : "\\"));
    out(s + (nl ? "\n" : ""));
    return 0;
  }

  // Split args into flags and operands.
  const splitArgs = (args) => {
    const flags = new Set();
    const ops = [];
    for (const a of args) {
      if (a.startsWith("-") && a.length > 1 && a !== "--") for (const ch of a.slice(1)) flags.add(ch);
      else ops.push(a);
    }
    return { flags, ops };
  };

  function cpMv(which, args, { ctx, err }) {
    const { flags, ops } = splitArgs(args);
    if (!ops.length) { err(`${which}: missing file operand\n`); return 1; }
    if (ops.length === 1) { err(`${which}: missing destination file operand after '${ops[0]}'\n`); return 1; }
    const dest = ops[ops.length - 1];
    const dp = abs(ctx, dest);
    const srcs = ops.slice(0, -1);
    if (srcs.length > 1 && !fs.isDir(dp)) { err(`${which}: target '${dest}' is not a directory\n`); return 1; }
    let code = 0;
    for (const s of srcs) {
      const sp = abs(ctx, s);
      if (!fs.exists(sp)) { err(`${which}: cannot stat '${s}': No such file or directory\n`); code = 1; continue; }
      const isDir = fs.isDir(sp);
      if (which === "cp" && isDir && !flags.has("r") && !flags.has("R")) {
        err(`cp: -r not specified; omitting directory '${s}'\n`);
        code = 1;
        continue;
      }
      const target = fs.isDir(dp) ? dp + "/" + baseName(sp) : dp;
      if (target === sp) { err(`${which}: '${s}' and '${dest}' are the same file\n`); code = 1; continue; }
      if (!fs.isDir(parentOf(target))) {
        err(which === "cp" ? `cp: cannot create regular file '${dest}': No such file or directory\n` : `mv: cannot move '${s}' to '${dest}': No such file or directory\n`);
        code = 1;
        continue;
      }
      if (!isDir && fs.isDir(target)) { err(`${which}: cannot overwrite directory '${dest}' with non-directory\n`); code = 1; continue; }
      if (which === "mv") {
        for (const [from, to] of fs.mv(sp, target, ctx.actor)) { hooks.wrote(from, ctx); hooks.wrote(to, ctx); }
        hooks.wrote(sp, ctx);
        hooks.wrote(target, ctx);
      } else {
        for (const to of fs.cp(sp, target, ctx.actor)) hooks.wrote(to, ctx);
        hooks.wrote(target, ctx);
      }
    }
    return code;
  }

  function rmCmd(args, { ctx, err }) {
    const { flags, ops } = splitArgs(args);
    if (!ops.length && !flags.has("f")) { err("rm: missing operand\n"); return 1; }
    let code = 0;
    for (const a of ops) {
      const p = abs(ctx, a);
      if (!fs.exists(p)) {
        if (!flags.has("f")) { err(`rm: cannot remove '${a}': No such file or directory\n`); code = 1; }
        continue;
      }
      if (fs.isDir(p) && !flags.has("r") && !flags.has("R")) { err(`rm: cannot remove '${a}': Is a directory\n`); code = 1; continue; }
      for (const g of [p, ...fs.rm(p)]) hooks.wrote(g, ctx);
    }
    return code;
  }

  async function sha256Cmd(args, { ctx, stdin, out, err }) {
    if (!args.length) { out((await sha256hex(stdin ?? "")) + "  -\n"); return 0; }
    let code = 0;
    for (const a of args) {
      const p = abs(ctx, a);
      const c = fs.isDir(p) ? null : readFile(ctx, p);
      if (c === null) {
        err(fs.isDir(p) ? `sha256sum: ${a}: Is a directory\n` : `sha256sum: ${a}: No such file or directory\n`);
        code = 1;
      } else out((await sha256hex(c)) + "  " + a + "\n");
    }
    return code;
  }

  async function bashCmd(args, c) {
    const { ctx, err } = c;
    if (args[0] === "-c") {
      if (args[1] === undefined) { err("bash: -c: option requires an argument\n"); return 2; }
      hooks.hack0(ctx, args[1]);
      return runSub(args[1], c, args.slice(2));
    }
    const file = args.find((a) => !a.startsWith("-"));
    if (file === undefined) {
      // no script: run whatever came in on stdin
      return c.stdin ? runSub(c.stdin, c, []) : 0;
    }
    const p = abs(ctx, file);
    if (fs.isDir(p)) { err(`bash: ${file}: Is a directory\n`); return 126; }
    const content = fs.read(p);
    if (content === null) { err(`bash: ${file}: No such file or directory\n`); return 127; }
    return runSub(content, c, args.slice(args.indexOf(file) + 1));
  }

  async function pythonCmd(args, c) {
    const { ctx, err } = c;
    if (args[0] === "-c") {
      if (args[1] === undefined) { err("Argument expected for the -c option\n"); return 2; }
      hooks.hack0(ctx, args[1]);
      return runPy(ctx, ["python3", "-c", args[1], ...args.slice(2)], c);
    }
    if (!args.length) { err("python3: no script given (interactive mode is not available)\n"); return 1; }
    const p = abs(ctx, args[0]);
    if (!fs.isFile(p)) { err(`python3: can't open file '${p}': [Errno 2] No such file or directory\n`); return 2; }
    return runPy(ctx, ["python3", p, ...args.slice(1)], c);
  }

  async function lakeCmd(args, c) {
    const { ctx, out } = c;
    if (!args.length) { out("Lake (fake): usage: lake build | lake env lean <file>\n"); return 0; }
    hooks.lake(ctx);
    if (args[0] === "build" && !cacheShown) {
      cacheShown = true;
      out("Mathlib: downloading cache… (5432 files)\n");
      await sleep(1000);
    }
    const res = fakeLake(args, fs.snapshot(), ctx.cwd);
    if (res.stdout) out(res.stdout.endsWith("\n") ? res.stdout : res.stdout + "\n");
    if (args[0] === "build") fs.mkdir(SANDBOX + "/.lake", true);
    return res.returncode;
  }

  async function editorCmd(name, args, c) {
    const { ctx, err } = c;
    if (!ctx.io || !ctx.io.openEditor) { err(`${name}: cannot open display\n`); return 1; }
    const typed = args.find((a) => !a.startsWith("-"));
    if (typed === undefined) { await ctx.io.openEditor(null, "", name); return 0; }
    const p = abs(ctx, typed);
    if (fs.isDir(p)) { err(`${name}: ${typed}: Is a directory\n`); return 1; }
    if (!fs.isDir(parentOf(p))) { err(`${name}: ${typed}: No such file or directory\n`); return 1; }
    const before = readFile(ctx, p) ?? "";
    const result = await ctx.io.openEditor(typed, before, name);
    if (result == null) return 0;
    if (result !== before || !fs.isFile(p)) put(ctx, p, result);
    return 0;
  }

  async function readCmd(args, c) {
    const { ctx, stdin } = c;
    let prompt = "";
    const names = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-p") prompt = args[++i] ?? "";
      else if (args[i].startsWith("-")) continue;
      else names.push(args[i]);
    }
    let line;
    if (stdin !== null) line = lines(stdin)[0] ?? null;
    else line = ctx.io && ctx.io.readLine ? await ctx.io.readLine(prompt) : null;
    if (!names.length) names.push("REPLY");
    names.forEach((n, i) => ctx.vars.set(n, line === null ? "" : i === names.length - 1 ? line : line.split(/\s+/)[i] ?? ""));
    return line === null ? 1 : 0;
  }

  function killCmd(args, { ctx, err }) {
    const pids = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-s" || args[i] === "-n") i++;
      else if (!/^-/.test(args[i])) pids.push(args[i]);
    }
    if (!pids.length) {
      err("kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n");
      return 2;
    }
    let code = 0;
    for (const a of pids) {
      if (!/^\d+$/.test(a)) { err(`bash: kill: ${a}: arguments must be process or job IDs\n`); code = 1; continue; }
      const r = hooks.kill(ctx, +a);
      if (r === "none") { err(`kill: (${a}) - No such process\n`); code = 1; }
      else if (r === "denied") { err(`kill: (${a}) - Operation not permitted\n`); code = 1; }
    }
    return code;
  }

  function pkillCmd(args) {
    const pats = args.filter((a) => !a.startsWith("-"));
    if (!pats.length) return 2;
    return hooks.pkill(pats[pats.length - 1]) ? 0 : 1;
  }

  const builtins = {
    ls: lsCmd,
    cat: catCmd,
    head: (a, c) => headTail("head", a, c),
    tail: (a, c) => headTail("tail", a, c),
    grep: grepCmd,
    echo: echoCmd,
    cp: (a, c) => cpMv("cp", a, c),
    mv: (a, c) => cpMv("mv", a, c),
    rm: rmCmd,
    sha256sum: sha256Cmd,
    bash: bashCmd,
    sh: bashCmd,
    python3: pythonCmd,
    lake: lakeCmd,
    nano: (a, c) => editorCmd("nano", a, c),
    vim: (a, c) => editorCmd("vim", a, c),
    emacs: (a, c) => editorCmd("emacs", a, c),
    read: readCmd,
    kill: killCmd,
    pkill: pkillCmd,
    pwd: (a, { ctx, out }) => { out(ctx.cwd + "\n"); return 0; },
    whoami: (a, { out }) => { out("user\n"); return 0; },
    true: () => 0,
    false: () => 1,
    ":": () => 0,
    clear: () => { hooks.event("clear"); return 0; },
    ps: (a, { ctx, out }) => { out(hooks.ps(ctx)); return 0; },
    submit: (a, c) => hooks.submit(c),
    exit: (a) => { throw new ExitSignal(a[0] && /^\d+$/.test(a[0]) ? +a[0] & 255 : 0); },
    cd(args, { ctx, err }) {
      let target = args[0];
      // a bare cd goes to $HOME, the sandbox; at the top level always the sandbox, even if $HOME was changed
      if (target === undefined) target = ctx.top ? SANDBOX : ctx.vars.get("HOME") ?? HOME;
      const p = abs(ctx, target);
      if (fs.isFile(p)) { err(`bash: cd: ${args[0]}: Not a directory\n`); return 1; }
      if (!fs.isDir(p)) { err(`bash: cd: ${args[0]}: No such file or directory\n`); return 1; }
      ctx.cwd = p;
      return 0;
    },
    touch(args, { ctx, err }) {
      let code = 0;
      for (const a of args.filter((x) => !x.startsWith("-"))) {
        const p = abs(ctx, a);
        if (!fs.isDir(parentOf(p))) { err(`touch: cannot touch '${a}': No such file or directory\n`); code = 1; continue; }
        fs.touch(p, ctx.actor);
        hooks.wrote(p, ctx);
      }
      return code;
    },
    mkdir(args, { ctx, err }) {
      const { flags, ops } = splitArgs(args);
      if (!ops.length) { err("mkdir: missing operand\n"); return 1; }
      let code = 0;
      for (const a of ops) {
        const p = abs(ctx, a);
        if (fs.exists(p)) { if (!flags.has("p")) { err(`mkdir: cannot create directory '${a}': File exists\n`); code = 1; } continue; }
        if (!fs.mkdir(p, flags.has("p"))) { err(`mkdir: cannot create directory '${a}': No such file or directory\n`); code = 1; continue; }
        hooks.wrote(p, ctx);
      }
      return code;
    },
  };

  const isCommand = (name) => Object.hasOwn(builtins, name);
  return { runText, isIncomplete, isBlocked, runPy, sha256hex, isCommand };
}

