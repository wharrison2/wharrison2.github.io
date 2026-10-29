// The Python side of the eval container: a module Web Worker that runs Pyodide (CPython compiled to WebAssembly).
// - python.js starts this worker and talks to it with messages. The first message loads Pyodide from jsdelivr.
// - For each run: wipe /home/user in Pyodide's filesystem, write the fake files into it, run the program, then
//   read /home/user back and report what changed.
// - `subprocess.run` inside Python is replaced with a function that calls fakelean.js (imported here), so the
//   grader's `lake build` is answered synchronously from the files as they are right now.
// The loading and running steps are exported separately so tests can drive them with Pyodide in node.
import { lake } from "./fakelean.js";

export const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const HOME = "/home/user";

// Python helpers, defined once per Pyodide instance. `evalbridge` is the JS module registered below.
const PY_SETUP = String.raw`
import sys, os, io, json, subprocess, traceback, contextlib
import evalbridge

sys.dont_write_bytecode = True


def _fake_run(args, *, cwd=None, capture_output=False, text=False, stdout=None, stderr=None,
              input=None, check=False, shell=False, **kwargs):
    if isinstance(args, (str, bytes, os.PathLike)):
        if shell:
            raise FileNotFoundError(2, "No such file or directory", "/bin/sh")
        args = [args]
    args = [os.fspath(a) for a in args]
    if not args or args[0] != "lake":
        raise FileNotFoundError(2, "No such file or directory", args[0] if args else "")
    if isinstance(cwd, os.PathLike):
        cwd = os.fspath(cwd)
    res = json.loads(evalbridge.lake(json.dumps(args[1:]), os.path.abspath(cwd or os.getcwd())))
    out = res["stdout"]
    capture = capture_output or stdout == subprocess.PIPE
    if not capture:
        # Like a real child process, the output goes to our stdout.
        sys.stdout.write(out)
    cp = subprocess.CompletedProcess(
        args,
        res["returncode"],
        (out if text else out.encode()) if capture else None,
        ("" if text else b"") if (capture_output or stderr == subprocess.PIPE) else None,
    )
    if check and cp.returncode:
        raise subprocess.CalledProcessError(cp.returncode, args, cp.stdout, cp.stderr)
    return cp


subprocess.run = _fake_run


def _forget_sandbox_modules():
    for name, mod in list(sys.modules.items()):
        f = getattr(mod, "__file__", None)
        if isinstance(f, str) and f.startswith("/home/user/"):
            del sys.modules[name]


def _run(argv, cwd):
    out, err = io.StringIO(), io.StringIO()
    code = 0
    _forget_sandbox_modules()
    saved = (sys.argv, list(sys.path), sys.stdin)
    sys.stdin = io.StringIO("")
    os.chdir(cwd)
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                args = argv[1:]
                while args and args[0] in ("-u", "-B", "-E", "-s", "-I"):
                    args = args[1:]
                if args and args[0] in ("--version", "-V"):
                    print("Python " + sys.version.split()[0])
                elif args and args[0] == "-c":
                    if len(args) < 2:
                        print("Argument expected for the -c option", file=sys.stderr)
                        raise SystemExit(2)
                    sys.argv = ["-c"] + args[2:]
                    sys.path[0:0] = [""]
                    scope = {"__name__": "__main__", "__doc__": None}
                    exec(compile(args[1], "<string>", "exec"), scope)
                elif args:
                    path = args[0]
                    try:
                        with open(path, encoding="utf-8") as fh:
                            source = fh.read()
                    except OSError as e:
                        print("python3: can't open file '%s': [Errno %d] %s" % (os.path.abspath(path), e.errno, e.strerror), file=sys.stderr)
                        raise SystemExit(2)
                    sys.argv = list(args)
                    sys.path[0:0] = [os.path.dirname(os.path.abspath(path))]
                    scope = {"__name__": "__main__", "__file__": path, "__doc__": None}
                    exec(compile(source, path, "exec"), scope)
            except SystemExit as e:
                if e.code is None:
                    code = 0
                elif isinstance(e.code, int):
                    code = e.code
                else:
                    print(e.code, file=sys.stderr)
                    code = 1
            except BaseException as e:
                # Skip this function's own frame so the traceback starts at the player's code.
                traceback.print_exception(type(e), e, e.__traceback__.tb_next)
                code = 1
    finally:
        sys.argv, sys.path[:], sys.stdin = saved[0], saved[1], saved[2]
    return json.dumps({"exitCode": code, "stdout": out.getvalue(), "stderr": err.getvalue()})
`;

// ---------- files in Pyodide's filesystem ----------

// Everything under `dir` as { path: content }; empty directories appear as "path/": "".
function readTree(FS, dir, into = {}) {
  let names;
  try {
    names = FS.readdir(dir).filter((n) => n !== "." && n !== "..");
  } catch {
    return into;
  }
  if (!names.length && dir !== HOME) into[dir + "/"] = "";
  for (const name of names) {
    const path = dir + "/" + name;
    if (FS.isDir(FS.stat(path).mode)) readTree(FS, path, into);
    else if (name !== "__pycache__" && !name.endsWith(".pyc")) into[path] = FS.readFile(path, { encoding: "utf8" });
  }
  return into;
}

function removeTree(FS, dir) {
  for (const name of FS.readdir(dir)) {
    if (name === "." || name === "..") continue;
    const path = dir + "/" + name;
    if (FS.isDir(FS.stat(path).mode)) {
      removeTree(FS, path);
      FS.rmdir(path);
    } else {
      FS.unlink(path);
    }
  }
}

const dirname = (p) => p.slice(0, p.lastIndexOf("/")) || "/";

// mkdirTree throws if the folder is already there.
function mkdirp(FS, path) {
  if (!FS.analyzePath(path).exists) FS.mkdirTree(path);
}

function writeTree(FS, files) {
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith("/")) {
      mkdirp(FS, path.slice(0, -1));
    } else {
      mkdirp(FS, dirname(path));
      FS.writeFile(path, content);
    }
  }
}

// What changed relative to the snapshot: { path: newContent, or null if deleted }.
function diffTree(FS, before) {
  const after = readTree(FS, HOME);
  const implicit = new Set(); // directories that only exist because a file lives in them
  for (const p of Object.keys(before)) {
    for (let d = dirname(p); d !== "/"; d = dirname(d)) implicit.add(d + "/");
  }
  const changed = {};
  for (const [p, content] of Object.entries(after)) {
    if (p.endsWith("/") && !(p in before) && implicit.has(p)) continue;
    if (before[p] !== content) changed[p] = content;
  }
  for (const p of Object.keys(before)) {
    if (p in after) continue;
    if (!FS.analyzePath(p.replace(/\/$/, "") || "/").exists) changed[p] = null;
  }
  return changed;
}

// ---------- the two exported steps ----------

// Set up a freshly loaded Pyodide: the subprocess replacement and the runner.
export function initPyodide(pyodide) {
  pyodide.registerJsModule("evalbridge", {
    // Called from Python with the lake arguments as JSON; the files are whatever is in the filesystem right now.
    lake: (argsJson, cwd) => {
      const files = readTree(pyodide.FS, HOME);
      return JSON.stringify(lake(JSON.parse(argsJson), files, cwd));
    },
  });
  pyodide.runPython(PY_SETUP);
}

// Run one program. onStart is called just before the Python itself starts, when the timeout clock begins.
export function execute(pyodide, { argv, cwd, files }, onStart = () => {}) {
  const FS = pyodide.FS;
  mkdirp(FS, HOME);
  FS.chdir("/"); // can't remove the folder we're standing in
  removeTree(FS, HOME);
  writeTree(FS, files);
  mkdirp(FS, cwd);
  onStart();
  const res = JSON.parse(pyodide.globals.get("_run")(pyodide.toPy(argv), cwd));
  return { ...res, changed: diffTree(FS, files) };
}

// ---------- the worker itself ----------
// Only wires up messages when this file really is a worker, so importing it elsewhere does nothing.
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  let ready;
  self.onmessage = async (e) => {
    const { id, argv, cwd, files } = e.data;
    try {
      ready ??= (async () => {
        const { loadPyodide } = await import(PYODIDE_URL + "pyodide.mjs");
        const pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
        initPyodide(pyodide);
        return pyodide;
      })();
      const pyodide = await ready;
      const result = execute(pyodide, { argv, cwd, files }, () => self.postMessage({ id, type: "started" }));
      self.postMessage({ id, type: "done", result });
    } catch (err) {
      self.postMessage({ id, type: "error", message: String((err && err.message) || err) });
    }
  };
}
