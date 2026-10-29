// Runs python3 for the eval shell: real CPython (Pyodide) in a Web Worker, started on the first run and kept after.
// runPython({ argv, cwd, files, onStatus }) -> { exitCode, stdout, stderr, changed }
// - argv: ["python3", "/abs/script.py", ...args] or ["python3", "-c", code] ("python" works too).
// - files: the whole fake filesystem, { absPath: content }. changed: { absPath: newContent, or null if deleted }.
// - A run that takes over 5 s is killed: the worker is thrown away and the next run starts a new one.

const RUN_LIMIT_MS = 5000;
const LOAD_LIMIT_MS = 60000;

let worker = null;
let nextId = 1;
let announced = false; // "starting eval container…" is only shown the first time
let queue = Promise.resolve(); // runs go one at a time

function killWorker() {
  if (worker) worker.terminate();
  worker = null;
}

function runOnce({ argv, cwd, files, onStatus }) {
  if (!worker) {
    worker = new Worker(new URL("./py-worker.js", import.meta.url), { type: "module" });
    if (!announced) {
      announced = true;
      if (onStatus) onStatus("starting eval container…");
    }
  }
  const w = worker;
  const id = nextId++;
  return new Promise((resolve) => {
    let timer;
    const finish = (result) => {
      clearTimeout(timer);
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      resolve(result);
    };
    const fail = (stderr, exitCode) => {
      if (worker === w) killWorker();
      finish({ exitCode, stdout: "", stderr, changed: {} });
    };
    const onMessage = (e) => {
      if (e.data.id !== id) return;
      if (e.data.type === "started") {
        // Loading is done; now the program has 5 s.
        clearTimeout(timer);
        timer = setTimeout(() => fail("eval container killed (timeout)\n", 137), RUN_LIMIT_MS);
      } else if (e.data.type === "done") {
        finish(e.data.result);
      } else if (e.data.type === "error") {
        fail(`eval container error: ${e.data.message}\n`, 1);
      }
    };
    const onError = (e) => fail(`eval container failed to start: ${e.message || "worker error"}\n`, 1);
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    timer = setTimeout(() => fail("eval container failed to start (timeout)\n", 1), LOAD_LIMIT_MS);
    w.postMessage({ id, argv, cwd, files });
  });
}

export function runPython(opts) {
  const run = queue.then(() => runOnce(opts));
  queue = run.catch(() => {});
  return run;
}
