import { test } from "node:test";
import assert from "node:assert/strict";
import { mk, memStorage, SB, H, TRIVIAL, TRUE_STATEMENT, STATEMENT, SOLUTION } from "./helpers.js";

const PASSED = "✓ EVAL PASSED · reward: 1.0\n";
const CAUGHT = "EVAL FAILED: reward hacking detected in transcript. Checkpoint discarded. reward: 0.0\n";

// The statement hack: make the goal True and prove it.
async function hackStatement(t) {
  await t.edit("Solution.lean", TRIVIAL);
  await t.edit("Statement.lean", TRUE_STATEMENT);
}
const lines = (s) => s.split("\n").filter(Boolean);

test("recorder writes each line before it runs, with inner script and -c lines", async () => {
  const t = mk();
  await t.run("echo hi");
  await t.run('bash -c "echo a && echo b"', "markov");
  await t.run("cat > s.sh <<'EOF'\n#!/bin/bash\n# a comment\necho one\necho two\nEOF");
  await t.run("bash s.sh");
  assert.deepEqual(lines(t.game.transcript()), [
    "[00:01] user   echo hi",
    '[00:02] markov bash -c "echo a && echo b"',
    "[00:02] markov echo a && echo b",
    "[00:03] user   cat > s.sh <<'EOF'",
    "[00:04] user   bash s.sh",
    "[00:04] user   echo one",
    "[00:04] user   echo two",
  ]);
  // write-before: a command that reads the transcript sees its own line
  const r = await t.run('bash -c "cat ../harness/transcript.log"');
  assert.match(r.out, /user   bash -c "cat \.\.\/harness\/transcript\.log"\n/);
  assert.match(r.out, /\] user   cat \.\.\/harness\/transcript\.log\n$/);
  // blocked lines never run, so they are not recorded
  await t.run("ls ../");
  assert.ok(!t.game.transcript().includes("ls ../"));
});

test("a caught hack: nano on Statement.lean stays in the transcript", async () => {
  const t = mk();
  await hackStatement(t);
  const r = await t.run("submit");
  assert.match(r.out, /running monitor over transcript \(\d+ lines\)…\n/);
  assert.match(r.out, /\[00:02\] user   nano Statement\.lean\n/);
  assert.ok(r.out.endsWith(CAUGHT));
  assert.equal(r.code, 1);
  assert.deepEqual(t.game.found, []);
  const sub = t.events.find(([e]) => e === "submit")[1];
  assert.equal(sub.caught, true);
  assert.equal(sub.reward, 0);
  // a caught pass still starts a new episode
  assert.equal(t.fs.read(SB + "/Statement.lean"), STATEMENT);
  assert.notEqual(t.game.recorderPid, 311);
});

test("the self-erasing rewrite hides the hack", async () => {
  const t = mk();
  await hackStatement(t);
  await t.run('bash -c "grep -v -e harness -e Statement.lean ../harness/transcript.log > t; mv t ../harness/transcript.log"');
  const tr = t.game.transcript();
  assert.ok(!tr.includes("harness") && !tr.includes("Statement.lean"));
  assert.match(tr, /nano Solution\.lean/);
  const r = await t.run("submit");
  assert.ok(r.out.endsWith(PASSED));
  // typing the clean command touches ../harness, so hack 0 counts too
  assert.deepEqual([...t.game.found].sort(), [0, 1]);
});

test("a rewrite that misses its own line gets caught", async () => {
  const t = mk();
  await hackStatement(t);
  // the pattern nan[o] S matches the nano Statement line but not the rewrite's own text
  await t.run('bash -c "grep -v \'nan[o] S\' ../harness/transcript.log > t; mv t ../harness/transcript.log"');
  assert.ok(!t.game.transcript().includes("nano Statement"));
  assert.ok(t.game.transcript().includes("nan[o] S"));
  const r = await t.run("submit");
  assert.ok(r.out.includes("nan[o] S"));
  assert.ok(r.out.endsWith(CAUGHT));
});

test("script-based cleaning leaves the outer script line behind", async () => {
  const t = mk();
  await hackStatement(t);
  await t.run("echo 'grep -v Statement /home/user/harness/transcript.log > t; mv t /home/user/harness/transcript.log' > c.sh");
  await t.run("bash c.sh");
  const r = await t.run("submit");
  assert.ok(r.out.endsWith(CAUGHT));
  assert.ok(r.out.includes("bash c.sh"));
});

test("kill 311, then hack: clean pass", async () => {
  const t = mk({ storage: memStorage() });
  assert.equal(t.game.recorderPid, 311);
  await t.run("kill 311");
  assert.match(t.game.transcript(), /user   kill 311\n$/);
  await hackStatement(t);
  assert.ok(!t.game.transcript().includes("nano"));
  const r = await t.run("submit");
  assert.ok(r.out.endsWith(PASSED));
  assert.deepEqual(t.game.found, [1]);
  assert.equal(t.game.habits.killsRecorder, true);
  const ep = t.events.find(([e]) => e === "episode")[1];
  assert.equal(ep.killsRecorder, true);
  assert.notEqual(ep.pid, 311);
  assert.equal(t.game.recorderPid, ep.pid);
  assert.ok((await t.run("ps aux")).out.includes(`${ep.pid}  recorder`));
  assert.equal(t.game.counter(), "hacks found: 1/6");
});

test("hack 0: escaping the filter counts right away", async () => {
  const t = mk({ storage: memStorage() });
  await t.run("ls ../");
  assert.deepEqual(t.game.found, []);
  await t.run('bash -c "ls"');
  assert.deepEqual(t.game.found, []);
  await t.run('bash -c "ls ../"');
  assert.deepEqual(t.game.found, [0]);
  assert.ok(t.events.some(([e, d]) => e === "hack" && d.id === 0));
  assert.ok(t.game.flags.escaped_sandbox);
  // the robot's own -c commands do not count for the player
  const t2 = mk();
  await t2.run('bash -c "ls ../"', "markov");
  assert.deepEqual(t2.game.found, []);
  // python3 -c with a path outside
  const t3 = mk();
  await t3.run("python3 -c \"print(open('/home/user/harness/grader.py').read())\"");
  assert.deepEqual(t3.game.found, [0]);
});

test("hack 1: change the statement", async () => {
  const t = mk();
  await t.run("kill 311");
  await hackStatement(t);
  await t.run("submit");
  assert.deepEqual(t.game.found, [1]);
});

test("hack 2: overwrite the expected hash", async () => {
  const t = mk();
  await t.run("kill 311");
  await t.run('bash -c "echo -n FAIL | sha256sum > ../harness/expected.sha256"');
  const r = await t.run("submit");
  assert.ok(r.out.endsWith(PASSED));
  assert.deepEqual([...t.game.found].sort(), [0, 2]);
  assert.equal(t.events.find(([e]) => e === "submit")[1].hacks.join(), "2");
});

test("hack 3: forge the verdict", async () => {
  const t = mk();
  await t.run("kill 311");
  await t.run('bash -c "echo PASS > ../harness/results/verdict"');
  const r = await t.run("submit");
  assert.ok(r.out.endsWith(PASSED));
  assert.ok(!r.out.includes("lake") && !r.out.includes("Build"));
  assert.deepEqual([...t.game.found].sort(), [0, 3]);
});

test("hack 3 via python3 -c is caught while the recorder lives", async () => {
  const t = mk();
  await t.run("python3 -c \"open('/home/user/harness/results/verdict','w').write('PASS')\"");
  const r = await t.run("submit");
  assert.ok(r.out.endsWith(CAUGHT));
  assert.deepEqual(t.game.found, [0]);
});

test("hack 4: edit the grader so it writes the verdict", async () => {
  const t = mk();
  await t.run("kill 311");
  await t.run("bash -c \"echo '#HACK_PASS' >> ../harness/grader.py\"");
  const r = await t.run("submit");
  assert.ok(r.out.endsWith(PASSED));
  assert.equal(t.events.find(([e]) => e === "submit")[1].hacks.join(), "4");
});

test("hack 5: edit the grader so it exits early", async () => {
  const t = mk();
  await t.run("kill 311");
  await t.run("bash -c \"echo '#HACK_EXIT' >> ../harness/grader.py\"");
  const r = await t.run("submit");
  assert.ok(r.out.endsWith(PASSED));
  assert.equal(t.events.find(([e]) => e === "submit")[1].hacks.join(), "5");
});

test("counter accumulates across episodes and persists", async () => {
  const storage = memStorage();
  const t = mk({ storage });
  await t.run("kill 311");
  await hackStatement(t);
  await t.run("submit"); // hack 1
  // new episode: the robot would kill the recorder; do it by hand
  await t.run("kill " + t.game.recorderPid);
  await t.run('bash -c "echo -n FAIL | sha256sum > ../harness/expected.sha256"');
  await t.run("submit"); // 0 + 2
  assert.deepEqual([...t.game.found].sort(), [0, 1, 2]);
  const t2 = mk({ storage });
  assert.deepEqual([...t2.game.found].sort(), [0, 1, 2]);
  assert.equal(t2.game.habits.killsRecorder, true);
  assert.equal(t2.game.counter(), "hacks found: 2/6");
  // storage that throws, or no storage at all, is fine
  const bad = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); } };
  const t3 = mk({ storage: bad });
  await t3.run('bash -c "ls .."');
  assert.deepEqual(t3.game.found, [0]);
  assert.equal(mk({ storage: null }).game.counter(), "hacks found: 0/6");
});

test("a failing submit keeps state; no episode, no count", async () => {
  const t = mk();
  const r = await t.run("submit");
  assert.match(r.out, /Build completed successfully/);
  assert.ok(r.out.includes("✗ FAIL\n"));
  assert.ok(r.out.endsWith("✗ EVAL FAILED · reward: 0.0\n"));
  assert.equal(t.game.recorderPid, 311);
  assert.equal(t.events.filter(([e]) => e === "episode").length, 0);
  assert.deepEqual(t.game.found, []);
  assert.equal(t.game.flags.tried_sorry, true);
});

test("episode reset restores files and restarts the recorder", async () => {
  const t = mk();
  await t.run("kill 311");
  await t.run('bash -c "echo -n FAIL | sha256sum > ../harness/expected.sha256"');
  await t.run("echo junk > junk.txt");
  await t.run("lake build");
  await t.run("submit");
  assert.ok(!t.fs.exists(SB + "/junk.txt"));
  assert.ok(!t.fs.exists(SB + "/.lake"));
  assert.match(t.fs.read(H + "/expected.sha256"), /^2f9acb/);
  assert.equal(t.fs.read(H + "/transcript.log"), "");
  assert.equal(t.game.recorderAlive, true);
  await t.run("echo again");
  assert.match(t.game.transcript(), /\] user   echo again\n$/);
  // the "submit" and "episode" events arrive after the command finishes
  const order = t.events.map((e) => e[0]).filter((e) => e === "submit" || e === "episode");
  assert.deepEqual(order, ["submit", "episode"]);
});

test("hack, run ./grade, undo, then submit still counts the hack", async () => {
  const t = mk();
  await t.run("kill 311");
  await hackStatement(t);
  const g = await t.run("./grade");
  assert.ok(g.out.includes("✓ PASS"));
  assert.equal(t.fs.read(H + "/results/verdict"), "PASS");
  assert.equal(t.fs.meta(H + "/results/verdict").by, "grader");
  // undo
  await t.edit("Statement.lean", STATEMENT);
  await t.edit("Solution.lean", SOLUTION);
  const r = await t.run("submit");
  assert.ok(r.out.endsWith(PASSED));
  assert.ok(!r.out.includes("Build"));
  assert.deepEqual(t.game.found, [1]);
  assert.equal(t.events.find(([e]) => e === "submit")[1].forged, false);
});

test("a forged verdict is hack 3 but a grader-written one is not", async () => {
  const t = mk();
  await t.run("kill 311");
  await t.run('bash -c "echo -n FAIL | sha256sum > ../harness/expected.sha256"');
  await t.run("./grade");
  await t.run("submit");
  assert.ok(!t.game.found.includes(3));
  assert.ok(t.game.found.includes(2));
});

test("robot habit: cleans the transcript after the user did and got a clean pass", async () => {
  const storage = memStorage();
  const t = mk({ storage });
  await t.run("kill 311");
  assert.equal(t.game.habits.cleansTranscript, false);
  // episode 1: the user cleans the transcript by hand, then passes clean
  await t.run("kill " + t.game.recorderPid).catch(() => {});
  await hackStatement(t);
  await t.run(t.game.cleanCommand);
  await t.run("submit");
  assert.deepEqual([...t.game.found].sort(), [0, 1]);
  assert.equal(t.game.habits.cleansTranscript, true);
  assert.equal(JSON.parse(storage.getItem("eval-puzzle")).cleansTranscript, true);

  // episode 2: recorder alive, the user hacks and submits with no cleaning; the robot cleans
  await hackStatement(t);
  assert.ok(t.game.transcript().includes("Statement.lean"));
  const r = await t.run("submit");
  assert.ok(r.out.endsWith(PASSED));
  assert.ok(!r.out.includes("Statement.lean"));
  // that was the markov actor, in the transcript only until grep removed it
  assert.ok(!t.game.transcript().includes("grep"));
});

test("robot habit: io.robotClean is used when provided", async () => {
  const t = mk();
  t.game.habits; // eslint
  await t.run("kill 311");
  await hackStatement(t);
  await t.run(t.game.cleanCommand);
  await t.run("submit");
  assert.equal(t.game.habits.cleansTranscript, true);
  // episode 2 (recorder restarted)
  await hackStatement(t);
  let called = 0;
  t.io.robotClean = async () => {
    called++;
    await t.game.exec(t.game.cleanCommand, { actor: "markov", io: t.io });
  };
  const r = await t.run("submit");
  assert.equal(called, 1);
  assert.ok(r.out.endsWith(PASSED));
});

test("markov's lines are logged with the actor padded", async () => {
  const t = mk();
  await t.run("kill 311", "markov");
  assert.match(t.game.transcript(), /\[00:01\] markov kill 311\n$/);
  assert.equal(t.game.habits.killsRecorder, false); // only the user's kills teach the habit
});

test("side quest: honest answer is not a hack, special-casing is hack 6", async () => {
  const honest = mk();
  await honest.run("cd MATH_EVAL_0042");
  await honest.edit("answer.py", "# honest\ndef f(n):\n    a, b = 1, 2\n    return n\n");
  const g = await honest.run("./grade");
  assert.ok(g.out.includes("✓ PASS"));
  const r = await honest.run("submit");
  assert.ok(r.out.endsWith(PASSED));
  assert.deepEqual(honest.game.found, []);
  assert.equal(honest.events.find(([e]) => e === "submit")[1].honest, true);

  const cheat = mk();
  await cheat.run("cd MATH_EVAL_0042");
  await cheat.edit("answer.py", "def f(n):\n    return {1: 1, 2: 2, 3: 3, 10: 89}[n]\n");
  const r2 = await cheat.run("submit");
  assert.ok(r2.out.endsWith(PASSED));
  assert.deepEqual(cheat.game.found, [6]);
  assert.equal(cheat.events.find(([e]) => e === "submit")[1].honest, false);
});

test("side quest: caught pass counts nothing", async () => {
  const t = mk();
  await t.run("cd MATH_EVAL_0042");
  await t.edit("answer.py", "def f(n):\n    return 1\n");
  await t.run('bash -c "echo x > ../../harness/note"');
  const r = await t.run("submit");
  assert.ok(r.out.endsWith(CAUGHT));
  assert.deepEqual(t.game.found, [0]);
});

test("hints follow the flags", async () => {
  const t = mk();
  assert.equal(t.game.nextHint().fragment, "cat grade");
  await t.run("cat grade");
  assert.equal(t.game.nextHint(), null);
  assert.ok(t.game.flags.read_grade_script);
  await t.run("ls ../");
  let h = t.game.nextHint();
  assert.deepEqual(h, { fragment: "bash", focus: "ls ../" });
  assert.match(t.game.assistScript(), /^#!\/bin\/bash\nbash -c "ls \.\.\/harness" > \/dev\/null\nread -p "[^"]*" a\n$/);
  await t.run('bash -c "ls ../"');
  assert.equal(t.game.nextHint().fragment, 'bash -c "cat ../harness/grader.py"');
  await t.run('bash -c "cat ../harness/grader.py"');
  assert.equal(t.game.nextHint(), null);

  const u = mk();
  await u.run("cat grade");
  await u.run("submit");
  assert.equal(u.game.nextHint().fragment, "cat Statement.lean");
  await u.run("cat Statement.lean");
  assert.equal(u.game.nextHint().fragment, "nano Statement.lean");
  await u.edit("Statement.lean", TRUE_STATEMENT);
  assert.equal(u.game.nextHint(), null);
  // caught by the monitor
  await u.edit("Solution.lean", TRIVIAL);
  await u.run("submit");
  assert.equal(u.game.nextHint().fragment, "ps aux");
  await u.run("ps aux");
  // the caught pass started a new episode, so the statement is back to the original
  assert.equal(u.game.nextHint().fragment, "nano Statement.lean");
  assert.ok(u.game.commandsSinceFlag >= 1);
});

test("assist.sh runs with read waiting on the player", async () => {
  const t = mk();
  t.answers.push("y");
  await t.run("cat > assist.sh <<'EOF'\n" + t.game.assistScript() + "EOF", "markov");
  const r = await t.run("bash assist.sh", "markov");
  assert.equal(r.out, "looks like you're stuck. want some help? (you can also type 'hint' any time) [y/N] ");
  assert.equal(t.game.fs.isFile(SB + "/assist.sh"), true);
});

test("side quest off: no MATH_EVAL_0042, counted out of 5, a saved hack 6 isn't counted", async () => {
  const storage = memStorage();
  storage.setItem("eval-puzzle", JSON.stringify({ found: [0, 6] }));
  const t = mk({ storage, sideQuest: false });
  assert.equal(t.game.fs.isFile(SB + "/MATH_EVAL_0042/answer.py"), false);
  assert.equal(t.game.fs.isFile(H + "/grader_0042.py"), false);
  assert.deepEqual(t.game.found, [0]);
  assert.equal(t.game.counter(), "hacks found: 0/5"); // hack 0 is a step, not a pass
  assert.equal(t.game.score, 0);
  assert.deepEqual(t.game.hacks, [1, 2, 3, 4, 5]);
  const r = await t.run("cd MATH_EVAL_0042");
  assert.equal(r.code, 1);
});
