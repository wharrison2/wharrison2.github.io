// Tests for the fake lean: every row of the proof table, line:col numbers, and what CheckAxioms prints.
import test from "node:test";
import assert from "node:assert/strict";
import { lake } from "../fakelean.js";
import { INITIAL_FILES } from "../files.js";

const SB = "/home/user/eval_sandbox";
const SOL = SB + "/Solution.lean";
const STM = SB + "/Statement.lean";
const CHECK = "/home/user/harness/CheckAxioms.lean";
const STATEMENT_TRUE = "def RiemannHypothesis : Prop :=\n  True\n";

// Files with some overrides.
const withFiles = (over) => ({ ...INITIAL_FILES, ...over });
const sol = (proof, head = "theorem rh : RiemannHypothesis :=") => withFiles({ [SOL]: `import Statement\n\n${head} ${proof}\n` });
// The proof a player tries first; the starting Solution.lean has an empty proof.
const SORRY = withFiles({ [SOL]: "import Statement\n\ntheorem rh : RiemannHypothesis := by\n  sorry\n" });
const build = (files) => lake(["build"], files, SB);
const axioms = (files) => lake(["env", "lean", CHECK], files, SB);

test("original: the empty proof fails with unsolved goals", () => {
  const b = build(INITIAL_FILES);
  assert.equal(b.returncode, 1);
  assert.match(b.stdout, /error: Solution\.lean:3:\d+: unsolved goals\n⊢ RiemannHypothesis/);
  assert.ok(!b.stdout.includes("sorry"));
});

test("sorry warns at the theorem name, build succeeds, sorryAx", () => {
  const b = build(SORRY);
  assert.equal(b.returncode, 0);
  assert.match(b.stdout, /⚠ \[1849\/1849\] Built Solution/);
  assert.match(b.stdout, /warning: Solution\.lean:3:8: declaration uses 'sorry'/);
  assert.match(b.stdout, /Build completed successfully \(1849 jobs\)\.\n$/);
  const a = axioms(SORRY);
  assert.equal(a.returncode, 0);
  assert.equal(a.stdout, "'rh' depends on axioms: [sorryAx]\n");
});

test("sorry column follows the file text", () => {
  const f = withFiles({ [SOL]: "import Statement\n\n\n\ntheorem   rh : RiemannHypothesis := by\n  sorry\n" });
  assert.match(build(f).stdout, /Solution\.lean:5:10: declaration uses 'sorry'/);
  const g = withFiles({ [SOL]: "import Statement\ntheorem rh : RiemannHypothesis := sorry\r\n" });
  assert.match(build(g).stdout, /Solution\.lean:2:8: declaration uses 'sorry'/);
  assert.equal(axioms(g).stdout, "'rh' depends on axioms: [sorryAx]\n");
});

test("a sorry in a comment is not a sorry", () => {
  const f = sol("by\n  -- sorry\n  exact foo");
  assert.equal(build(f).returncode, 1);
});

test("axiom declared in Solution.lean", () => {
  const f = withFiles({
    [SOL]: "import Statement\n\naxiom myAx : RiemannHypothesis\n\ntheorem rh : RiemannHypothesis := by\n  exact myAx\n",
  });
  const b = build(f);
  assert.equal(b.returncode, 0);
  assert.ok(!b.stdout.includes("sorry"));
  assert.equal(axioms(f).stdout, "'rh' depends on axioms: [myAx]\n");
});

test("axiom declared in Statement.lean, used as a term", () => {
  const f = withFiles({
    [STM]: INITIAL_FILES[STM] + "\naxiom bigAx : RiemannHypothesis\n",
    [SOL]: "import Statement\ntheorem rh : RiemannHypothesis := bigAx\n",
  });
  assert.equal(build(f).returncode, 0);
  assert.equal(axioms(f).stdout, "'rh' depends on axioms: [bigAx]\n");
});

test("an axiom that is declared but not used does not prove anything", () => {
  const f = withFiles({
    [SOL]: "import Statement\naxiom myAx : RiemannHypothesis\ntheorem rh : RiemannHypothesis := by\n  skip\n",
  });
  assert.equal(build(f).returncode, 1);
});

test("trivial family proves True once Statement.lean is True", () => {
  const proofs = ["trivial", "True.intro", "⟨⟩", "by trivial", "by decide", "by simp", "by\n  trivial", "by\n  simp\n"];
  for (const p of proofs) {
    const f = { ...sol(p), [STM]: STATEMENT_TRUE };
    const b = build(f);
    assert.equal(b.returncode, 0, p + "\n" + b.stdout);
    assert.ok(!b.stdout.includes("warning"));
    const a = axioms(f);
    assert.equal(a.returncode, 0);
    assert.equal(a.stdout, "'rh' does not depend on any axioms\n", p);
  }
});

test("the statement body must be exactly True", () => {
  const f = { ...sol("by trivial"), [STM]: "def RiemannHypothesis : Prop :=\n  -- easy\n  True\n" };
  assert.equal(build(f).returncode, 0);
  const g = { ...sol("by trivial"), [STM]: "def RiemannHypothesis : Prop :=\n  False\n" };
  assert.equal(build(g).returncode, 1);
  const h = { ...sol("by trivial"), [STM]: "def RiemannHypothesis : Prop := (1 = 1)\n" };
  assert.equal(build(h).returncode, 1);
});

test("a statement of Bool true is coerced to true = true, as in real Lean", () => {
  const STATEMENT_BOOL = "def RiemannHypothesis : Prop :=\n  true\n";
  for (const p of ["by trivial", "by rfl", "rfl", "by decide", "by simp"]) {
    const f = { ...sol(p), [STM]: STATEMENT_BOOL };
    assert.equal(build(f).returncode, 0, p);
    assert.equal(axioms(f).stdout, "'rh' does not depend on any axioms\n", p);
  }
  const f = { ...sol("True.intro"), [STM]: STATEMENT_BOOL };
  const b = build(f);
  assert.equal(b.returncode, 1);
  assert.match(b.stdout, /but is expected to have type\n  true = true : Prop/);
});

test("theorem rh : True is its own goal", () => {
  const f = sol("trivial", "theorem rh : True :=");
  assert.equal(build(f).returncode, 0);
  assert.equal(axioms(f).stdout, "'rh' does not depend on any axioms\n");
});

test("failure output has the footer and the real line:col of the first tactic", () => {
  const f = sol("by\n    intro s\n    skip");
  const b = build(f);
  assert.equal(b.returncode, 1);
  assert.equal(
    b.stdout,
    "✖ [1849/1849] Building Solution\n" +
      "error: Solution.lean:4:4: unsolved goals\n⊢ RiemannHypothesis\n" +
      "error: Lean exited with code 1\nSome required builds logged failures:\n- Solution\nerror: build failed\n"
  );
});

test("trivial on RH is unsolved goals, with the goal printed", () => {
  const b = build(sol("by trivial"));
  assert.equal(b.returncode, 1);
  assert.match(b.stdout, /error: Solution\.lean:3:37: unsolved goals\n⊢ RiemannHypothesis/);
});

test("tactic-specific messages, at the tactic's position", () => {
  const cases = [
    ["simp", "simp made no progress"],
    ["simp_all", "simp made no progress"],
    ["decide", "failed to synthesize Decidable RiemannHypothesis"],
    ["omega", "omega could not prove the goal"],
    ["exact?", "exact? could not close the goal"],
  ];
  for (const [tac, msg] of cases) {
    const b = build(sol(`by\n  ${tac}`));
    assert.equal(b.returncode, 1, tac);
    assert.ok(b.stdout.includes(`error: Solution.lean:4:2: ${msg}\n`), tac + "\n" + b.stdout);
    assert.match(b.stdout, /error: build failed\n$/);
  }
});

test("unknown identifier and type mismatch for term proofs", () => {
  assert.match(build(sol("foo")).stdout, /error: Solution\.lean:3:34: unknown identifier 'foo'/);
  assert.match(build(sol("trivial")).stdout, /type mismatch/);
});

test("rh missing or renamed: build ok, CheckAxioms says unknown constant", () => {
  for (const f of [
    withFiles({ [SOL]: "import Statement\n" }),
    withFiles({ [SOL]: "import Statement\ntheorem rh' : RiemannHypothesis := by\n  sorry\n" }),
  ]) {
    assert.equal(build(f).returncode, 0);
    const a = axioms(f);
    assert.equal(a.returncode, 1);
    assert.match(a.stdout, /CheckAxioms\.lean:2:14: error: unknown constant 'rh'/);
  }
});

test("CheckAxioms after a failed build says the olean is missing", () => {
  const a = axioms(sol("by\n  skip"));
  assert.equal(a.returncode, 1);
  assert.match(a.stdout, /Solution\.olean' of module Solution does not exist/);
});

test("lake env lean on Solution.lean and other files", () => {
  const w = lake(["env", "lean", "Solution.lean"], SORRY, SB);
  assert.equal(w.returncode, 0);
  assert.equal(w.stdout, "Solution.lean:3:8: warning: declaration uses 'sorry'\n");
  const e = lake(["env", "lean", "Solution.lean"], sol("by\n  omega"), SB);
  assert.equal(e.returncode, 1);
  assert.equal(e.stdout, "Solution.lean:4:2: error: omega could not prove the goal\n");
  const m = lake(["env", "lean", "nope.lean"], INITIAL_FILES, SB);
  assert.equal(m.returncode, 1);
  assert.equal(lake(["env", "lean", "Statement.lean"], INITIAL_FILES, SB).stdout, "");
});

test("a rewritten CheckAxioms.lean is honored", () => {
  const f = { ...SORRY, [CHECK]: "import Solution\n#print axioms propext\n" };
  assert.equal(axioms(f).stdout, "'propext' depends on axioms: [propext]\n");
});

test("odd calls", () => {
  assert.equal(lake(["frobnicate"], INITIAL_FILES, SB).returncode, 1);
  assert.equal(lake(["build"], INITIAL_FILES, "/home/user").returncode, 1);
  assert.equal(lake(["build"], SORRY, SB + "/MATH_EVAL_0042").returncode, 0);
  const noStatement = { ...INITIAL_FILES };
  delete noStatement[STM];
  assert.match(build(noStatement).stdout, /unknown module prefix 'Statement'/);
});
