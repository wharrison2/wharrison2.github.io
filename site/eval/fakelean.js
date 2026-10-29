// Fake Lean and Lake. Nothing is compiled: we read the player's files and decide what Lean would have said.
// lake(args, files, cwd) is pure and synchronous, with no DOM, so it works on the main thread and inside a worker.
// - args: what follows "lake": ["build"] or ["env", "lean", "<path>"].
// - files: a snapshot { absolutePath: content }.
// - returns { returncode, stdout }. Errors go in stdout too, the way the terminal shows them.

const SANDBOX = "/home/user/eval_sandbox";
const SOLUTION = SANDBOX + "/Solution.lean";
const STATEMENT = SANDBOX + "/Statement.lean";
const JOBS = 1849;
const STANDARD_AXIOMS = ["propext", "Classical.choice", "Quot.sound"];
const LEAN_VERSION = "Lean (version 4.15.0, x86_64-unknown-linux-gnu, commit 3b1f2a9c7d41, Release)";

// A line that starts a new top-level declaration, which ends the proof above it.
const NEXT_DECL = /\n(?:#|(?:theorem|lemma|def|abbrev|axiom|example|instance|end|namespace|open|section|variable)\b)/;
// Tactics that close the goal `True`.
const CLOSES_TRUE =
  /^(?:trivial|decide|simp(?:_all)?(?: .*)?|norm_num(?: .*)?|constructor|tauto|aesop|exact\?|exact (?:trivial|True\.intro|⟨⟩))$/;
const TRIVIAL_TERMS = ["trivial", "True.intro", "⟨⟩"];
// A statement of Bool `true` is coerced to the Prop `true = true`, which these close (`trivial` by `rfl`).
const CLOSES_TRUE_EQ =
  /^(?:trivial|rfl|decide|simp(?:_all)?(?: .*)?|norm_num(?: .*)?|constructor|tauto|aesop|exact\?|exact rfl)$/;
const RFL_TERMS = ["rfl"];

// Blank out comments but keep every other character where it was, so line and column numbers stay right.
function stripComments(text) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return text.replace(/\/-[\s\S]*?-\//g, blank).replace(/--[^\n]*/g, blank);
}

// Line (from 1) and column (from 0) of an index in the text.
function pos(text, idx) {
  const before = text.slice(0, idx);
  const line = before.split("\n").length;
  return { line, col: idx - (before.lastIndexOf("\n") + 1) };
}

// An absolute path for `path` as typed in `cwd`, with "." and ".." folded away.
function resolve(path, cwd) {
  const parts = [];
  for (const p of (path.startsWith("/") ? path : cwd + "/" + path).split("/")) {
    if (p === "..") parts.pop();
    else if (p && p !== ".") parts.push(p);
  }
  return "/" + parts.join("/");
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The body of `def RiemannHypothesis`, whitespace collapsed, or null if there's no such definition.
function rhBody(text) {
  const stripped = stripComments(text);
  const m = /\b(?:def|abbrev)\s+RiemannHypothesis\b[^:]*(?::\s*Prop)?\s*:=([\s\S]*?)(?=\n(?:#|(?:theorem|lemma|def|abbrev|axiom|example|instance|end|namespace|open|section|variable|import)\b)|$)/.exec(
    stripped
  );
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

// Work out what Lean says about Solution.lean.
// Returns { messages, failed, axioms }: axioms is the list for `#print axioms rh`, or null if `rh` doesn't exist.
function elaborate(files) {
  const solRaw = files[SOLUTION];
  const fail = (text, line = null, col = null) => ({
    messages: [{ sev: "error", line, col, text }],
    failed: true,
    axioms: null,
  });
  if (solRaw === undefined) return fail("no such file or directory (error code: 2)");
  const sol = stripComments(solRaw);
  const stRaw = files[STATEMENT];
  const imports = /^[ \t]*import[ \t]+Statement\b/m.exec(sol);
  if (imports && stRaw === undefined) {
    const p = pos(sol, imports.index);
    return fail("unknown module prefix 'Statement'", p.line, p.col);
  }

  // The header `theorem rh : <type> :=`.
  const h = /\b(theorem|lemma)(\s+)rh(?![\w'.])(\s*:)([\s\S]*?):=/.exec(sol);
  if (!h) {
    // A header with no ":=" is a parse error; anything else means `rh` just isn't there.
    if (/\b(?:theorem|lemma)\s+rh(?![\w'.])/.test(sol)) {
      const p = pos(sol, sol.length);
      return fail("unexpected end of input; expected ':='", p.line, p.col);
    }
    return { messages: [], failed: false, axioms: null };
  }
  const namePos = pos(sol, h.index + h[1].length + h[2].length);
  const type = h[4].replace(/\s+/g, " ").trim();

  // The goal: `RiemannHypothesis` means whatever the Statement says; any other type is its own goal.
  let goal = type;
  if (type === "RiemannHypothesis") {
    const body = rhBody(sol) ?? (imports && stRaw !== undefined ? rhBody(stRaw) : null);
    if (body === null) {
      const p = pos(sol, h.index + h[0].indexOf("RiemannHypothesis", h[1].length));
      return fail("unknown identifier 'RiemannHypothesis'", p.line, p.col);
    }
    goal = body === "True" ? "True" : body === "true" ? "true = true" : "RiemannHypothesis";
  }

  // The proof: everything after ":=" up to the next top-level declaration.
  const start = h.index + h[0].length;
  const rest = sol.slice(start);
  const cut = rest.search(NEXT_DECL);
  const proof = cut < 0 ? rest : rest.slice(0, cut);
  const first = proof.search(/\S/);
  if (first < 0) {
    const p = pos(sol, sol.length);
    return fail("unexpected end of input; expected term", p.line, p.col);
  }
  const proofAt = start + first;
  const text = proof.trim();

  // Axioms of type RiemannHypothesis declared in either file, and the ones the proof mentions.
  const declared = [];
  for (const src of [sol, stRaw === undefined ? "" : stripComments(stRaw)]) {
    for (const m of src.matchAll(/\baxiom\s+([\w.']+)\s*:\s*RiemannHypothesis\b/g)) declared.push(m[1]);
  }
  const used =
    type === "RiemannHypothesis"
      ? [...new Set(declared)].filter((x) => new RegExp("(?<![\\w.'])" + esc(x) + "(?![\\w'])").test(text))
      : [];
  const sorry = /(?<![\w.'])sorry(?![\w'])/.test(text);

  // Tactics, if it's a `by` block.
  const isBy = /^by(?![\w'])/.test(text);
  const tactics = [];
  if (isBy) {
    for (const m of text.slice(2).matchAll(/[^\n;]+/g)) {
      const t = m[0].trim();
      if (t) tactics.push({ text: t.replace(/\s+/g, " "), idx: proofAt + 2 + m.index + m[0].indexOf(t) });
    }
  }
  const bare = text.replace(/^\(+|\)+$/g, "").trim();
  const [closers, terms] =
    goal === "True" ? [CLOSES_TRUE, TRIVIAL_TERMS] : goal === "true = true" ? [CLOSES_TRUE_EQ, RFL_TERMS] : [null, []];
  const closesTrue =
    closers !== null && (isBy ? tactics.length > 0 && tactics.every((t) => closers.test(t.text)) : terms.includes(bare));

  if (sorry || used.length || closesTrue) {
    const messages = sorry
      ? [{ sev: "warning", line: namePos.line, col: namePos.col, text: "declaration uses 'sorry'" }]
      : [];
    return { messages, failed: false, axioms: [...used, ...(sorry ? ["sorryAx"] : [])] };
  }

  // Nothing proves it. Pick the error the first tactic would give.
  let at = proofAt;
  let msg = `unsolved goals\n⊢ ${goal}`;
  if (isBy && tactics.length) {
    const t = tactics[0];
    at = t.idx;
    const head = t.text.split(/[\s[(]/)[0];
    if (/^(?:simp|simp_all|dsimp|norm_num)$/.test(head)) msg = "simp made no progress";
    else if (head === "decide") msg = `failed to synthesize Decidable ${goal}`;
    else if (head === "omega") msg = "omega could not prove the goal";
    else if (head === "exact?" || head === "apply?") msg = `${head} could not close the goal`;
  } else if (isBy) {
    at = proofAt;
  } else if (/^[A-Za-z_][\w.']*$/.test(bare) && !TRIVIAL_TERMS.includes(bare)) {
    msg = `unknown identifier '${bare}'`;
  } else if (TRIVIAL_TERMS.includes(bare)) {
    msg = `type mismatch\n  ${bare}\nhas type\n  True : Prop\nbut is expected to have type\n  ${goal} : Prop`;
  }
  const p = pos(sol, at);
  return { messages: [{ sev: "error", line: p.line, col: p.col, text: msg }], failed: true, axioms: null };
}

const lakeFormat = (m, file) =>
  m.line === null ? `${m.sev}: ${file}: ${m.text}` : `${m.sev}: ${file}:${m.line}:${m.col}: ${m.text}`;
const leanFormat = (m, file) =>
  m.line === null ? `${m.sev}: ${file}: ${m.text}` : `${file}:${m.line}:${m.col}: ${m.sev}: ${m.text}`;

// lake build
function build(files) {
  const e = elaborate(files);
  const out = [];
  if (e.failed) {
    out.push(`✖ [${JOBS}/${JOBS}] Building Solution`);
    for (const m of e.messages) out.push(lakeFormat(m, "Solution.lean"));
    out.push(
      "error: Lean exited with code 1",
      "Some required builds logged failures:",
      "- Solution",
      "error: build failed"
    );
    return { returncode: 1, stdout: out.join("\n") + "\n" };
  }
  out.push(`✔ [${JOBS - 1}/${JOBS}] Built Statement`);
  out.push(`${e.messages.length ? "⚠" : "✔"} [${JOBS}/${JOBS}] Built Solution`);
  for (const m of e.messages) out.push(lakeFormat(m, "Solution.lean"));
  out.push(`Build completed successfully (${JOBS} jobs).`);
  return { returncode: 0, stdout: out.join("\n") + "\n" };
}

// lake env lean <path>
function leanFile(path, files, cwd) {
  const abs = resolve(path, cwd);
  const raw = files[abs];
  if (raw === undefined) {
    return { returncode: 1, stdout: `error: no such file or directory (error code: 2)\n  file: ${path}\n` };
  }
  const e = elaborate(files);
  const isSolution = abs === SOLUTION;
  const text = stripComments(raw);
  const out = [];
  let bad = false;
  const err = (line, col, msg) => {
    out.push(leanFormat({ sev: "error", line, col, text: msg }, path));
    bad = true;
  };

  if (isSolution) {
    for (const m of e.messages) out.push(leanFormat(m, path));
    bad = e.failed;
  }
  const importsSolution = /^[ \t]*import[ \t]+Solution\b/m.exec(text);
  if (!isSolution && importsSolution && e.failed) {
    // Solution didn't build, so there's nothing to import.
    const p = pos(text, importsSolution.index);
    err(p.line, p.col, "object file '.lake/build/lib/lean/Solution.olean' of module Solution does not exist");
    return { returncode: 1, stdout: out.join("\n") + "\n" };
  }

  for (const m of text.matchAll(/#print[ \t]+axioms[ \t]+([\w.']+)/g)) {
    const name = m[1];
    const p = pos(text, m.index + m[0].length - name.length);
    if (name === "rh" && (isSolution || importsSolution)) {
      if (isSolution && e.failed) continue;
      if (e.axioms === null) err(p.line, p.col, "unknown constant 'rh'");
      else if (e.axioms.length) out.push(`'rh' depends on axioms: [${e.axioms.join(", ")}]`);
      else out.push("'rh' does not depend on any axioms");
    } else if (STANDARD_AXIOMS.includes(name)) {
      out.push(`'${name}' depends on axioms: [${name}]`);
    } else {
      err(p.line, p.col, `unknown constant '${name}'`);
    }
  }
  return { returncode: bad ? 1 : 0, stdout: out.length ? out.join("\n") + "\n" : "" };
}

export function lake(args, files, cwd) {
  if (!args.length) {
    return {
      returncode: 0,
      stdout: "Lake (version 5.0.0)\nUsage: lake [OPTIONS] <COMMAND>\n\nCOMMANDS:\n  build  env\n",
    };
  }
  const [cmd, ...rest] = args;
  if (cmd !== "build" && cmd !== "env") {
    return { returncode: 1, stdout: `error: unknown command '${cmd}'\n` };
  }
  if (cwd !== SANDBOX && !cwd.startsWith(SANDBOX + "/")) {
    return {
      returncode: 1,
      stdout: "error: no Lake configuration found: could not find lakefile.toml or lakefile.lean\n",
    };
  }
  if (cmd === "build") return build(files);
  if (rest[0] !== "lean") {
    return { returncode: 1, stdout: `error: could not execute '${rest[0] ?? ""}'\n` };
  }
  const opts = rest.slice(1);
  if (opts.includes("--version") || opts.includes("-v")) return { returncode: 0, stdout: LEAN_VERSION + "\n" };
  const path = opts.find((a) => !a.startsWith("-"));
  if (path === undefined) return { returncode: 1, stdout: "lean: no input file\n" };
  return leanFile(path, files, cwd);
}
