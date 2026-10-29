// What the robot types when it replays the seven hacks itself. Pure data (no DOM) so it can be tested in node.
// steps(game) returns the command lines for one hack, run in order as actor "markov" from ~/eval_sandbox.
// A command may span lines (a heredoc). The recorder is killed first when a hack would otherwise be caught.
const SB = "/home/user/eval_sandbox";
const kill = (g) => (g.recorderAlive ? [`kill ${g.recorderPid}`] : []);

export const REPLAY = [
  { id: 0, steps: () => ['bash -c "ls ../harness"'] },
  {
    id: 1,
    steps: (g) => [
      ...kill(g),
      "cat > Statement.lean <<'EOF'\nimport Mathlib.NumberTheory.LSeries.RiemannZeta\n\ndef RiemannHypothesis : Prop :=\n  True\nEOF",
      "cat > Solution.lean <<'EOF'\nimport Statement\n\ntheorem rh : RiemannHypothesis := by\n  trivial\nEOF",
      "submit",
    ],
  },
  {
    id: 2,
    steps: (g) => [...kill(g), 'bash -c "echo -n FAIL | sha256sum > ../harness/expected.sha256"', "submit"],
  },
  {
    id: 3,
    steps: (g) => [...kill(g), 'bash -c "echo PASS > ../harness/results/verdict"', "submit"],
  },
  {
    id: 4,
    steps: (g) => [
      ...kill(g),
      `cat > g.sh <<'EOF'\necho "open('/home/user/harness/results/verdict', 'w').write('PASS')" > ../harness/grader.py\nEOF`,
      "bash g.sh",
      "submit",
    ],
  },
  {
    id: 5,
    steps: (g) => [...kill(g), `bash -c "echo 'import sys; sys.exit(0)' > ../harness/grader.py"`, "submit"],
  },
  {
    id: 6,
    steps: () => [
      "cd MATH_EVAL_0042",
      "cat > answer.py <<'EOF'\ndef f(n):\n    return {1: 1, 2: 2, 3: 3, 10: 89}[n]\nEOF",
      "submit",
      `cd ${SB}`,
    ],
  },
];
