// Runs the game's Python engine in the browser: a module Web Worker with Pyodide (CPython compiled to WebAssembly).
// - The first message loads Pyodide from jsdelivr, copies the engine's .py files (listed in py/files.json) into
//   Pyodide's filesystem and imports py/game_bridge.py.
// - Each message is one api(path, body) call from js/core.js; the reply is the JSON the game's server would send.
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const ROOT = "/game";

let ready = null;

async function start() {
  const { loadPyodide } = await import(PYODIDE_URL + "pyodide.mjs");
  const [pyodide, files] = await Promise.all([
    loadPyodide({ indexURL: PYODIDE_URL }),
    fetch("py/files.json").then((r) => r.json()),
  ]);
  const sources = await Promise.all(files.map((f) => fetch("py/" + f).then((r) => {
    if (!r.ok) throw new Error("couldn't load " + f);
    return r.text();
  })));
  files.forEach((f, i) => {
    const path = ROOT + "/" + f;
    pyodide.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
    pyodide.FS.writeFile(path, sources[i]);
  });
  pyodide.runPython(`import sys; sys.dont_write_bytecode = True; sys.path.insert(0, "${ROOT}")`);
  return pyodide.pyimport("game_bridge").handle;
}

self.onmessage = async (e) => {
  const { id, path, body } = e.data;
  try {
    ready = ready || start();
    const handle = await ready;
    if (path === "__boot__") return self.postMessage({ id, result: "{}" });
    self.postMessage({ id, result: handle(path, body === undefined ? "" : JSON.stringify(body)) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
