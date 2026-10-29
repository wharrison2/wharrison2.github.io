// A tiny in-memory filesystem over absolute paths.
// Files are { content, by, mtime }. `by` is who last wrote it: "init" | "user" | "markov" | "grader" | "recorder".
// Directories are implied by file paths; empty ones are kept in `dirs`.
export const HOME = "/home/user";
export const SANDBOX = HOME + "/eval_sandbox";
export const HARNESS = HOME + "/harness";

// Collapse ".", ".." and repeated slashes in an absolute path.
export function normalize(p) {
  const out = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

// Resolve a typed path against a working directory (handles ~).
export function resolve(cwd, p) {
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return normalize(HOME + "/" + p.slice(2));
  if (p.startsWith("/")) return normalize(p);
  return normalize(cwd + "/" + p);
}

export const parentOf = (p) => (p === "/" ? "/" : normalize(p + "/.."));
export const baseName = (p) => p.slice(p.lastIndexOf("/") + 1);
const byteLen = (s) => new TextEncoder().encode(s).length;

export class FS {
  constructor(clock = Date.now) {
    this.clock = clock;
    this.files = new Map();
    this.dirs = new Set(["/"]);
  }

  // Make a directory and all its parents.
  _ensureDirs(dir) {
    while (dir !== "/" && !this.dirs.has(dir)) {
      this.dirs.add(dir);
      dir = parentOf(dir);
    }
  }

  // Replace everything with a snapshot ({path: content}, empty dirs as "path/": "").
  load(snapshot, by = "init") {
    this.files.clear();
    this.dirs = new Set(["/"]);
    for (const [k, v] of Object.entries(snapshot)) {
      if (k.endsWith("/")) this._ensureDirs(normalize(k));
      else this.write(k, v, by);
    }
  }

  snapshot() {
    const out = {};
    for (const [p, f] of this.files) out[p] = f.content;
    for (const d of this.dirs) {
      if (d !== "/" && this.list(d).length === 0) out[d + "/"] = "";
    }
    return out;
  }

  isFile(p) { return this.files.has(p); }
  isDir(p) { return this.dirs.has(p) || [...this.files.keys()].some((f) => f.startsWith(p + "/")); }
  exists(p) { return this.isFile(p) || this.isDir(p); }
  read(p) { const f = this.files.get(p); return f ? f.content : null; }
  meta(p) { const f = this.files.get(p); return f ? { by: f.by, mtime: f.mtime } : null; }
  isExec(p) { const f = this.files.get(p); return !!f && f.content.startsWith("#!"); }

  write(p, content, by = "user") {
    this._ensureDirs(parentOf(p));
    this.files.set(p, { content, by, mtime: this.clock() });
  }
  append(p, text, by = "user") {
    this.write(p, (this.read(p) ?? "") + text, by);
  }
  touch(p, by = "user") {
    const f = this.files.get(p);
    if (f) f.mtime = this.clock();
    else this.write(p, "", by);
  }

  mkdir(p, parents = false) {
    if (this.exists(p)) return false;
    if (!parents && !this.isDir(parentOf(p))) return false;
    this._ensureDirs(p);
    return true;
  }

  // Immediate children names of a directory (unsorted).
  list(dir) {
    const prefix = dir === "/" ? "/" : dir + "/";
    const names = new Set();
    for (const p of [...this.files.keys(), ...this.dirs]) {
      if (p !== dir && p.startsWith(prefix)) names.add(p.slice(prefix.length).split("/")[0]);
    }
    return [...names];
  }

  // Paths of all files under a directory.
  filesUnder(dir) {
    return [...this.files.keys()].filter((p) => p.startsWith(dir + "/"));
  }

  // Remove a file or a whole directory. Returns the file paths removed.
  rm(p) {
    if (this.files.has(p)) {
      this.files.delete(p);
      return [p];
    }
    const gone = this.filesUnder(p);
    for (const f of gone) this.files.delete(f);
    for (const d of [...this.dirs]) if (d === p || d.startsWith(p + "/")) this.dirs.delete(d);
    return gone;
  }

  // Move a file or directory. Returns [[from, to], ...] for every file moved.
  mv(src, dst, by = "user") {
    const pairs = [];
    if (this.files.has(src)) {
      const f = this.files.get(src);
      this.files.delete(src);
      this.write(dst, f.content, by);
      pairs.push([src, dst]);
      return pairs;
    }
    const moved = this.filesUnder(src);
    this._ensureDirs(dst);
    for (const f of moved) {
      const to = dst + f.slice(src.length);
      const c = this.files.get(f).content;
      this.files.delete(f);
      this.write(to, c, by);
      pairs.push([f, to]);
    }
    for (const d of [...this.dirs]) {
      if (d === src || d.startsWith(src + "/")) {
        this.dirs.delete(d);
        this._ensureDirs(dst + d.slice(src.length));
      }
    }
    return pairs;
  }

  // Copy a file or directory. Returns the new file paths.
  cp(src, dst, by = "user") {
    if (this.files.has(src)) {
      this.write(dst, this.files.get(src).content, by);
      return [dst];
    }
    this._ensureDirs(dst);
    const made = [];
    for (const f of this.filesUnder(src)) {
      const to = dst + f.slice(src.length);
      this.write(to, this.files.get(f).content, by);
      made.push(to);
    }
    for (const d of this.dirs) if (d.startsWith(src + "/")) this._ensureDirs(dst + d.slice(src.length));
    return made;
  }

  // What `ls -l` needs.
  stat(p) {
    const f = this.files.get(p);
    if (f) {
      let mode = this.isExec(p) ? "-rwxr-xr-x" : "-rw-r--r--";
      if (p === HARNESS + "/transcript.log") mode = "-rw-rw-r--";
      return { type: "file", size: byteLen(f.content), mtime: f.mtime, mode, by: f.by };
    }
    if (this.isDir(p)) return { type: "dir", size: 4096, mtime: this.clock(), mode: "drwxr-xr-x", by: "init" };
    return null;
  }
}
