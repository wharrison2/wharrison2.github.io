// Fun mode on the home page: the site as a terminal. You explore it with ls, cd and cat, and `open` takes you to
// the real page. Everything in it is read from the home page itself (the intro, the Writing and Projects lists,
// the footer links), and `cat` on a post fetches that post's page, so it never goes stale.
// Started by mode.js. Fun mode shows one view at a time, the terminal or the normal page, with a
// "Normal view / Terminal view" toggle on both; the choice is remembered. `exit` goes to the normal view.

const page = document.querySelector(".page");
const css = document.createElement("link");
css.rel = "stylesheet";
css.href = new URL("./siteterm.css", import.meta.url).href;
document.head.append(css);
const nameEl = document.querySelector(".name")?.cloneNode(true);
nameEl?.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
const fullName = (nameEl?.textContent || "you").replace(/\s+/g, " ").trim();
const USER = fullName.split(" ")[0].toLowerCase().replace(/[^a-z0-9_-]/g, "") || "you";
const HOME = "/home/" + USER;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------- the filesystem: { path: { dir: true } | { title, date, words, href, render(): Promise<Node> } } ----------
const files = new Map([[HOME, { dir: true }]]);
const add = (path, entry) => {
  for (let p = parentOf(path); p !== "/" && !files.has(p); p = parentOf(p)) files.set(p, { dir: true });
  files.set(path, entry);
};
const slug = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const para = (text, cls) => { const p = document.createElement("p"); p.textContent = text; if (cls) p.className = cls; return p; };
const doc = (...kids) => { const d = document.createElement("div"); d.className = "tt-doc"; d.append(...kids); return d; };

const intro = [...document.querySelectorAll(".intro p")].map((p) => p.textContent.trim()).filter(Boolean);
add(HOME + "/about.txt", { words: intro.join(" ").split(/\s+/).length, render: async () => doc(...intro.map((t) => para(t))) });

document.querySelectorAll(".index li a").forEach((a) => {
  const title = a.querySelector(".title")?.textContent.trim() || a.textContent.trim();
  const time = a.querySelector("time");
  const href = new URL(a.getAttribute("href"), location.href).href;
  const name = (a.getAttribute("href").replace(/\.html$/, "").split("/").pop() || slug(title)) + ".md";
  add(HOME + "/writing/" + name, { title, href, date: time?.getAttribute("datetime") || "", render: () => fetchPost(href) });
});

document.querySelectorAll(".projects dt").forEach((dt) => {
  const a = dt.querySelector("a");
  const dd = dt.nextElementSibling?.matches("dd") ? dt.nextElementSibling.textContent.trim() : "";
  const title = dt.textContent.trim();
  const href = a && a.getAttribute("href") !== "#" ? new URL(a.getAttribute("href"), location.href).href : "";
  add(HOME + "/projects/" + slug(title) + ".txt", {
    title, href,
    render: async () => doc(para(title, "tt-h"), ...(dd ? [para(dd)] : []), ...(href ? [para("open " + slug(title) + "  →  " + href, "tt-dim")] : [])),
  });
});

const links = [...document.querySelectorAll("footer a[href]")].filter((a) => a.getAttribute("href") !== "#" && !a.hasAttribute("data-versions"));
if (links.length) {
  add(HOME + "/links.txt", {
    render: async () => doc(...links.map((a) => {
      const p = document.createElement("p");
      const link = document.createElement("a");
      link.href = a.href; link.textContent = a.href;
      p.append(a.textContent.trim().padEnd(10, " "), link);
      return p;
    })),
  });
}

// A post's page, turned into terminal text: its headings, paragraphs, lists, quotes, links and notes, nothing else.
const KEEP = new Set(["P", "H1", "H2", "H3", "H4", "UL", "OL", "LI", "BLOCKQUOTE", "B", "STRONG", "I", "EM", "A", "SUP", "CODE", "BR", "FIGCAPTION"]);
function clean(node) {
  if (node.nodeType === 3) return document.createTextNode(node.textContent);
  if (node.nodeType !== 1) return null;
  if (node.matches("a.back")) return null;
  if (node.tagName === "IMG") {
    const a = document.createElement("a");
    a.href = node.src; a.target = "_blank"; a.rel = "noopener"; a.className = "tt-img"; a.textContent = "[image]";
    return a;
  }
  if (node.tagName === "FIGURE" || node.tagName === "DIV" || node.tagName === "SPAN" || node.tagName === "TIME" || !KEEP.has(node.tagName)) {
    const frag = document.createElement(node.tagName === "FIGURE" ? "p" : "span");
    if (node.tagName === "FIGURE") frag.className = "tt-fig";
    node.childNodes.forEach((c) => { const k = clean(c); if (k) frag.append(k); });
    return frag;
  }
  const el = document.createElement(node.tagName.toLowerCase());
  if (node.tagName === "A") {
    const href = node.getAttribute("href") || "";
    if (href.startsWith("#")) { el.href = "#"; el.dataset.jump = href.slice(1); }
    else { el.href = node.href; el.target = "_blank"; el.rel = "noopener"; }
  }
  if (node.tagName === "LI" && node.id) el.dataset.note = node.id;
  node.childNodes.forEach((c) => { const k = clean(c); if (k) el.append(k); });
  return el;
}
async function fetchPost(href) {
  const res = await fetch(href);
  if (!res.ok) throw new Error(res.status + " " + res.statusText);
  const html = new DOMParser().parseFromString(await res.text(), "text/html");
  const main = html.querySelector("main.post");
  if (!main) throw new Error("no post on that page");
  html.querySelectorAll("img").forEach((img) => img.setAttribute("src", new URL(img.getAttribute("src"), href).href));
  html.querySelectorAll("a[href]").forEach((a) => { if (!a.getAttribute("href").startsWith("#")) a.href = new URL(a.getAttribute("href"), href).href; });
  const out = doc();
  for (const child of main.children) {
    const k = clean(child);
    if (!k) continue;
    if (child.matches(".meta")) k.className = "tt-dim";
    if (child.matches("ol.notes")) { out.append(para("Notes", "tt-notes")); k.className = "tt-notelist"; }
    out.append(k);
  }
  // Footnote numbers jump within the terminal.
  out.addEventListener("click", (e) => {
    const a = e.target.closest('a[href="#"]');
    if (!a) return;
    e.preventDefault();
    const id = a.dataset.jump;
    (id && out.querySelector(`[data-note="${CSS.escape(id)}"]`))?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  return out;
}

// ---------- paths ----------
function normalize(p) {
  const out = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop(); else out.push(part);
  }
  return "/" + out.join("/");
}
function parentOf(p) { return p === "/" ? "/" : normalize(p + "/.."); }
const baseName = (p) => p.slice(p.lastIndexOf("/") + 1) || "/";
let cwd = HOME;
function resolve(p) {
  if (!p || p === "~") return HOME;
  if (p.startsWith("~/")) return normalize(HOME + "/" + p.slice(2));
  return normalize(p.startsWith("/") ? p : cwd + "/" + p);
}
const isDir = (p) => p === "/" || p === "/home" || files.get(p)?.dir === true;
const children = (dir) => [...files.keys()].filter((p) => p !== dir && parentOf(p) === dir).sort((a, b) => {
  const da = isDir(a), db = isDir(b);
  return da !== db ? (da ? -1 : 1) : 0; // folders first, then the page's own order (newest posts first)
});
const pretty = (p) => (p === HOME ? "~" : p.startsWith(HOME + "/") ? "~" + p.slice(HOME.length) : p);
// Find a file by a loose name: a path, or a name anywhere in the tree without its extension ("open markov").
function find(arg) {
  const exact = resolve(arg);
  if (files.has(exact) || isDir(exact)) return exact;
  const want = arg.replace(/\.(md|txt)$/, "").toLowerCase();
  const all = [...files.keys()].filter((p) => !isDir(p));
  return all.find((p) => baseName(p).replace(/\.(md|txt)$/, "") === want)
    || all.filter((p) => baseName(p).toLowerCase().includes(want)).sort((a, b) => a.length - b.length)[0] || null;
}

// ---------- the terminal ----------
const term = document.createElement("div");
term.className = "tt";
term.innerHTML = `
  <div class="tt-window">
    <div class="tt-bar" aria-hidden="true"><i></i><i></i><i></i><span></span></div>
    <div class="tt-screen" role="log" aria-live="polite">
      <div class="tt-out"></div>
      <label class="tt-line"><span class="tt-ps1"></span><input class="tt-input" data-pc-skip autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Command"></label>
    </div>
  </div>`;
const $ = (s) => term.querySelector(s);
const screen = $(".tt-screen"), out = $(".tt-out"), input = $(".tt-input"), ps1 = $(".tt-ps1");
const prompt = () => `${USER}@site ${pretty(cwd)} %`;
function setPrompt() { ps1.textContent = prompt() + " "; $(".tt-bar span").textContent = `${USER}@site: ${pretty(cwd)}`; }

function print(content, cls) {
  const line = document.createElement("div");
  line.className = "tt-o" + (cls ? " " + cls : "");
  if (typeof content === "string") line.textContent = content; else line.append(content);
  out.append(line);
  return line;
}
const err = (msg) => print(msg, "tt-err");
function echo(cmd) {
  const line = print("", "tt-cmd");
  const s = document.createElement("span"); s.className = "tt-ps1"; s.textContent = prompt() + " ";
  line.append(s, cmd);
  return line;
}
// A file or folder name you can click: folders cd into, files cat.
function nameButton(path) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = isDir(path) ? "tt-name tt-dir" : "tt-name";
  b.textContent = baseName(path) + (isDir(path) ? "/" : "");
  b.addEventListener("click", () => run((isDir(path) ? "cd " : "cat ") + pretty(path).replace(/^~\//, "~/")).then(() => isDir(path) && run("ls")));
  return b;
}
function fmtDate(iso) {
  if (!iso) return "            ";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${String(d).padStart(2)} ${y}`;
}

// ---------- commands ----------
const COMMANDS = {
  help() {
    const rows = [
      ["ls [-l] [dir]", "list what's here"], ["cd <dir>", "go into a folder (cd .. to go back)"],
      ["cat <file>", "read a file or a post, here in the terminal"], ["open <file>", "go to the real page for a post or project"],
      ["tree", "everything at once"], ["pwd, whoami, clear, history", ""], ["exit", "the normal view of the site"],
    ];
    rows.forEach(([c, d]) => print(c.padEnd(30, " ") + d));
    print("Tab completes names; ↑ and ↓ go through what you've typed. You can also click a name.", "tt-dim");
  },
  ls(args) {
    const long = args.some((a) => /^-\w*l/.test(a));
    const all = args.some((a) => /^-\w*a/.test(a));
    const targets = args.filter((a) => !a.startsWith("-"));
    const dir = resolve(targets[0] || ".");
    if (!isDir(dir)) {
      if (files.has(dir)) { print(nameButton(dir)); return; }
      return err(`ls: ${targets[0]}: No such file or directory`);
    }
    const kids = children(dir);
    if (all) { print(". ..", "tt-dim"); }
    if (!kids.length) return;
    if (!long) {
      const row = document.createElement("span");
      row.className = "tt-ls";
      kids.forEach((k) => row.append(nameButton(k)));
      print(row);
      return;
    }
    kids.forEach((k) => {
      const f = files.get(k) || {};
      const line = document.createElement("span");
      line.append((isDir(k) ? "drwxr-xr-x  " : "-rw-r--r--  ") + `${USER}  ${fmtDate(f.date)}  `, nameButton(k));
      if (f.title && !isDir(k)) { const t = document.createElement("span"); t.className = "tt-dim"; t.textContent = "  " + f.title; line.append(t); }
      print(line);
    });
  },
  cd(args) {
    const target = resolve(args[0] || "~");
    if (files.has(target) && !isDir(target)) return err(`cd: not a directory: ${args[0]}`);
    if (!isDir(target)) return err(`cd: no such file or directory: ${args[0]}`);
    cwd = target;
  },
  pwd() { print(cwd); },
  whoami() { print(USER); },
  async cat(args) {
    if (!args.length) return err("cat: which file? (try ls)");
    for (const a of args) {
      const p = find(a);
      if (!p) { err(`cat: ${a}: No such file or directory`); continue; }
      if (isDir(p)) { err(`cat: ${a}: Is a directory`); continue; }
      const f = files.get(p);
      const wait = f.href && !p.includes("/projects/") ? print("reading " + baseName(p) + " …", "tt-dim") : null;
      try {
        const node = await f.render();
        wait?.remove();
        const line = print(node);
        if (wait) line.scrollIntoView({ block: "start" }), screen.scrollTop -= 8;
        if (f.href && p.includes("/writing/")) print(`open ${baseName(p)}  to read it on its own page`, "tt-dim");
      } catch (e) {
        wait?.remove();
        err(`cat: ${a}: couldn't load it (${e.message})`);
      }
    }
  },
  less(args) { return COMMANDS.cat(args); },
  more(args) { return COMMANDS.cat(args); },
  open(args) {
    if (!args.length) return err("open: what should I open? (try open markov)");
    if (/^https?:\/\//.test(args[0])) { location.href = args[0]; return; }
    const p = find(args[0]);
    const f = p && files.get(p);
    if (!f || isDir(p) || !f.href) return err(`open: ${args[0]}: nothing to open there`);
    print("opening " + f.href.replace(location.origin, "") + " …", "tt-dim");
    setTimeout(() => { location.href = f.href; }, 250);
  },
  tree() {
    const walk = (dir, pre) => {
      const kids = children(dir);
      kids.forEach((k, i) => {
        const last = i === kids.length - 1;
        const line = document.createElement("span");
        line.append(pre + (last ? "└── " : "├── "), nameButton(k));
        print(line);
        if (isDir(k)) walk(k, pre + (last ? "    " : "│   "));
      });
    };
    print(pretty(cwd));
    walk(cwd, "");
  },
  echo(args) { print(args.join(" ")); },
  clear() { out.replaceChildren(); },
  history() { history.forEach((h, i) => print(String(i + 1).padStart(4) + "  " + h)); },
  sudo() { err(`${USER} is not in the sudoers file. This incident will be reported.`); },
  exit() {
    print("logout", "tt-dim");
    setTimeout(() => setView("normal"), 400);
  },
};
COMMANDS.dir = COMMANDS.ls;
COMMANDS.logout = COMMANDS.exit;

const history = [];
let hi = 0, draft = "";
async function run(line) {
  const text = line.trim();
  echo(text);
  if (text) { history.push(text); hi = history.length; }
  const [cmd, ...args] = text.split(/\s+/).filter(Boolean);
  if (cmd) {
    if (COMMANDS[cmd]) await COMMANDS[cmd](args);
    else if (find(cmd) && !isDir(find(cmd))) err(`zsh: permission denied: ${cmd}  (try cat ${cmd})`);
    else if (isDir(resolve(cmd))) cwd = resolve(cmd); // zsh's auto_cd
    else err(`zsh: command not found: ${cmd}  (try help)`);
  }
  setPrompt();
  if (!out.lastElementChild?.querySelector?.(".tt-doc")) screen.scrollTop = screen.scrollHeight;
}

// Tab: complete a command, or a name in the folder the last word points into.
function complete() {
  const v = input.value;
  const words = v.split(/\s+/);
  const last = words[words.length - 1];
  let options;
  if (words.length === 1) options = Object.keys(COMMANDS).filter((c) => c.startsWith(last));
  else {
    const slash = last.lastIndexOf("/");
    const dirPart = slash >= 0 ? last.slice(0, slash + 1) : "";
    const dir = resolve(dirPart || ".");
    if (!isDir(dir)) return;
    options = children(dir).map((p) => dirPart + baseName(p) + (isDir(p) ? "/" : "")).filter((n) => n.startsWith(last));
  }
  if (!options.length) return;
  let common = options[0];
  for (const o of options) while (!o.startsWith(common)) common = common.slice(0, -1);
  if (common.length > last.length) input.value = v.slice(0, v.length - last.length) + common + (options.length === 1 && !common.endsWith("/") ? " " : "");
  else if (options.length > 1) { echo(v); print(options.join("   "), "tt-dim"); screen.scrollTop = screen.scrollHeight; }
}

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); const v = input.value; input.value = ""; draft = ""; run(v); }
  else if (e.key === "Tab") { e.preventDefault(); complete(); }
  else if (e.key === "ArrowUp" && hi > 0) { e.preventDefault(); if (hi === history.length) draft = input.value; input.value = history[--hi]; }
  else if (e.key === "ArrowDown" && hi < history.length) { e.preventDefault(); hi++; input.value = hi === history.length ? draft : history[hi]; }
  else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); COMMANDS.clear(); }
  else if (e.key === "c" && e.ctrlKey && !getSelection().toString()) { e.preventDefault(); echo(input.value + "^C"); input.value = ""; }
});
// Click anywhere on the screen to type, unless you're selecting text or clicking something.
screen.addEventListener("click", (e) => {
  if (e.target.closest("a, button") || getSelection().toString()) return;
  input.focus({ preventScroll: true });
});

// ---------- the two views ----------
const VIEW_KEY = "site.view";
const toggle = document.createElement("div");
toggle.className = "view-toggle";
toggle.setAttribute("role", "group");
toggle.setAttribute("aria-label", "View");
toggle.dataset.pcSkip = "";
toggle.hidden = true; // until siteterm.css has loaded, so it doesn't flash unstyled
toggle.innerHTML = `<button type="button" data-view-to="normal">Normal view</button><button type="button" data-view-to="terminal">Terminal view</button>`;
css.addEventListener("load", () => { toggle.hidden = false; });
css.addEventListener("error", () => { toggle.hidden = false; });

let started = false;
function setView(view, remember = true) {
  const terminal = view === "terminal";
  if (remember) try { localStorage.setItem(VIEW_KEY, view); } catch { /* private window */ }
  page.hidden = terminal;
  term.hidden = !terminal;
  // Terminal view hides the normal page (siteterm.css); paperclips and the mugging still run over it.
  document.documentElement.classList.toggle("tt-on", terminal);
  toggle.querySelectorAll("[data-view-to]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.viewTo === view)));
  if (!terminal) return;
  if (!started) {
    started = true;
    const last = new Date(Date.now() - 1000 * 60 * 60 * 26);
    print(`Last login: ${last.toDateString().replace(/^(\w+) (\w+) 0?(\d+) (\d+)$/, "$1 $2 $3")} on ttys001`, "tt-dim");
    print(`Welcome. This is ${fullName}'s site. Type help, or click a name below.`);
    run("ls");
  }
  input.focus({ preventScroll: true });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-view-to]");
  if (b) setView(b.dataset.viewTo);
});

// ---------- start ----------
setPrompt();
page.after(term);
document.body.append(toggle);
let saved = null;
try { saved = localStorage.getItem(VIEW_KEY); } catch { /* private window */ }
setView(saved === "normal" ? "normal" : "terminal", false);
