// The Block Blast solver page: an 8x8 board and three piece boxes to draw on, a palette of shapes, and the best moves
// (from solver.js) worked out again after every change.
import T, { fill } from "../strings/blockblast.js";
import SHAPES from "./shapes.js";
import { N, solve, place, cellCount } from "./solver.js";

const S = 5; // piece boxes are 5x5
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// ---------- state ----------
const STORE = "blockblast.board";
let board = new Array(N).fill(0); // a bitmask per row, bit c = column c
try {
  const saved = JSON.parse(localStorage.getItem(STORE));
  if (Array.isArray(saved) && saved.length === N) board = saved.map((r) => r & 255);
} catch (e) {}
const slots = [0, 1, 2].map(() => new Array(S * S).fill(0));
let active = 0;
let result = null;

const isOn = (b, r, c) => (b[r] >> c) & 1;
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(board)); } catch (e) {}
}

// A drawn box, trimmed to the rows and columns it uses; null when empty.
function trimmed(cells) {
  const rows = [], cols = [];
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) if (cells[r * S + c]) { rows.push(r); cols.push(c); }
  if (!rows.length) return null;
  const r0 = Math.min(...rows), r1 = Math.max(...rows), c0 = Math.min(...cols), c1 = Math.max(...cols);
  const g = [];
  for (let r = r0; r <= r1; r++) {
    const row = [];
    for (let c = c0; c <= c1; c++) row.push(cells[r * S + c]);
    g.push(row);
  }
  return g;
}

// ---------- click and drag to paint squares ----------
// Pressing a square flips it, and dragging paints the squares passed over the same way. Keys flip one at a time.
function paintable(grid, get, set, onStart) {
  let paint = null;
  const cellAt = (x, y) => {
    const t = document.elementFromPoint(x, y);
    return t && t.parentNode === grid && t.dataset.i != null ? +t.dataset.i : null;
  };
  grid.addEventListener("pointerdown", (e) => {
    const i = cellAt(e.clientX, e.clientY);
    if (i == null || e.button > 0) return;
    e.preventDefault();
    if (onStart) onStart();
    paint = get(i) ? 0 : 1;
    set(i, paint);
    grid.setPointerCapture(e.pointerId);
  });
  grid.addEventListener("pointermove", (e) => {
    if (paint == null) return;
    const i = cellAt(e.clientX, e.clientY);
    if (i != null && get(i) !== paint) set(i, paint);
  });
  const stop = () => { paint = null; };
  grid.addEventListener("pointerup", stop);
  grid.addEventListener("pointercancel", stop);
  grid.addEventListener("click", (e) => {
    // pointerdown already handled mouse and touch; a click with no pointer (detail 0) is the keyboard
    if (e.detail !== 0) return;
    const i = e.target.dataset && e.target.dataset.i;
    if (i == null) return;
    if (onStart) onStart();
    set(+i, get(+i) ? 0 : 1);
  });
}

function cells(grid, n, label) {
  for (let i = 0; i < n * n; i++) {
    const b = el("button");
    b.type = "button";
    b.dataset.i = i;
    b.setAttribute("aria-label", label(Math.floor(i / n) + 1, (i % n) + 1));
    b.setAttribute("aria-pressed", "false");
    grid.append(b);
  }
}

function show(grid, on) {
  [...grid.children].forEach((b, i) => {
    const v = !!on(i);
    b.classList.toggle("on", v);
    b.setAttribute("aria-pressed", String(v));
  });
}

// ---------- the board ----------
const boardEl = $("board");
cells(boardEl, N, (row, col) => fill(T.board.cell, { row, col }));
paintable(
  boardEl,
  (i) => isOn(board, Math.floor(i / N), i % N),
  (i, v) => {
    const r = Math.floor(i / N), bit = 1 << (i % N);
    board[r] = v ? board[r] | bit : board[r] & ~bit;
    changed();
  },
);
$("clear-board").addEventListener("click", () => {
  board = new Array(N).fill(0);
  changed();
});

// ---------- the piece boxes ----------
const slotEls = slots.map((cellsOf, k) => {
  const wrap = el("div", "slot");
  wrap.append(el("span", "slot-head", fill(T.pieces.slot, { n: k + 1 })));
  const grid = el("div", "grid");
  grid.style.setProperty("--n", S);
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", fill(T.pieces.slot, { n: k + 1 }));
  cells(grid, S, (row, col) => fill(T.pieces.cell, { n: k + 1, row, col }));
  paintable(grid, (i) => cellsOf[i], (i, v) => { cellsOf[i] = v; changed(); }, () => { active = k; });
  const clear = el("button", "link", T.pieces.clear);
  clear.type = "button";
  clear.addEventListener("click", () => {
    cellsOf.fill(0);
    active = k;
    changed();
  });
  wrap.append(grid, clear);
  $("slots").append(wrap);
  return { wrap, grid };
});

// ---------- the palette ----------
for (const g of SHAPES) {
  const b = el("button", "shape");
  b.type = "button";
  b.style.gridTemplateColumns = `repeat(${g[0].length}, 7px)`;
  b.setAttribute("aria-label", fill(T.pieces.shape, { n: g.flat().filter(Boolean).length }));
  for (const row of g) for (const v of row) b.append(el("i", v ? "on" : ""));
  b.addEventListener("click", () => {
    // into the chosen box if it's empty, else the next empty one (so drawing a piece doesn't get it overwritten)
    const k = [0, 1, 2].map((d) => (active + d) % 3).find((j) => !trimmed(slots[j])) ?? active;
    slots[k].fill(0);
    g.forEach((row, r) => row.forEach((v, c) => { slots[k][r * S + c] = v; }));
    // on to the next empty box, if there is one
    const next = [1, 2, 3].map((d) => (k + d) % 3).find((j) => !trimmed(slots[j]));
    if (next != null) active = next;
    changed();
  });
  $("palette").append(b);
}

// ---------- the answer ----------
function miniBoard(b, piece, row, col, gone) {
  const grid = el("div", "grid");
  grid.setAttribute("aria-hidden", "true");
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const sq = el("span");
      const pr = r - row, pc = c - col;
      const isNew = piece && pr >= 0 && pr < piece.length && pc >= 0 && pc < piece[0].length && piece[pr][pc];
      if (isNew) sq.className = "new";
      else if (isOn(b, r, c)) sq.className = "on";
      if (gone && (gone.rows.includes(r) || (gone.cols >> c) & 1)) sq.classList.add("gone");
      grid.append(sq);
    }
  return grid;
}

function render() {
  show(boardEl, (i) => isOn(board, Math.floor(i / N), i % N));
  slotEls.forEach(({ wrap, grid }, k) => {
    show(grid, (i) => slots[k][i]);
    wrap.classList.toggle("active", k === active);
  });

  const steps = $("steps");
  steps.replaceChildren();
  $("play").hidden = true;
  const set = slots.map((s, k) => ({ g: trimmed(s), k })).filter((p) => p.g);
  if (!set.length) {
    result = null;
    $("status").textContent = T.result.empty;
    return;
  }
  const found = solve(board, set.map((p) => p.g));
  if (!found) {
    result = null;
    $("status").textContent = T.result.stuck;
    return;
  }
  $("status").textContent = "";
  let b = board;
  found.moves.forEach((m, n) => {
    const g = set[m.piece].g;
    const after = place(b, { h: g.length, w: g[0].length, rows: g.map((r) => r.reduce((x, v, c) => (v ? x | (1 << c) : x), 0)) }, m.row, m.col);
    const lines = after.rows.length + popcount8(after.cols);
    const li = el("li");
    li.append(
      el("div", "step-head", fill(T.result.step, { n: n + 1 })),
      miniBoard(b, g, m.row, m.col, lines ? after : null),
      el("div", "", fill(T.result.move, { piece: set[m.piece].k + 1, row: m.row + 1, col: m.col + 1 })),
    );
    if (lines) li.append(el("div", "", lines === 1 ? T.result.clears_one : fill(T.result.clears, { n: lines })));
    steps.append(li);
    b = after.board;
  });
  const left = cellCount(b);
  const last = el("li");
  last.append(
    el("div", "step-head", T.result.after),
    miniBoard(b),
    el("div", "", left === 0 ? T.result.left_none : left === 1 ? T.result.left_one : fill(T.result.left, { n: left })),
  );
  steps.append(last);
  result = b;
  $("play").hidden = false;
}

function popcount8(x) {
  let n = 0;
  for (; x; x &= x - 1) n++;
  return n;
}

$("play").addEventListener("click", () => {
  if (!result) return;
  board = result.slice();
  slots.forEach((s) => s.fill(0));
  active = 0;
  changed();
});

function changed() {
  save();
  render();
}
render();
