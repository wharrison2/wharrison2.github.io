// The solver from github.com/wharrison2/block_blast_solver (block_blast.py), in JavaScript.
// - Tries every order of the pieces and every spot for each, clearing full rows and columns after each placement.
// - Best = the most cells cleared off the board overall (cells before minus cells after); ties go to the end board
//   with the least edge between filled and empty cells (block_blast.py's countRegions), so fewer, tidier holes.
// - On a full tie the first one found wins, the same one the Python picks.
// A board is 8 numbers, one per row, with bit c set when column c is filled.

export const N = 8;
const FULL = (1 << N) - 1;

function popcount(x) {
  x -= (x >> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export const cellCount = (b) => b.reduce((n, r) => n + popcount(r), 0);

// A piece as a grid of 0/1 rows -> { h, w, rows: bitmask per row }
export function pieceOf(grid) {
  return { h: grid.length, w: grid[0].length, rows: grid.map((r) => r.reduce((m, v, c) => (v ? m | (1 << c) : m), 0)) };
}

export function fits(b, p, r, c) {
  if (r + p.h > N || c + p.w > N) return false;
  for (let i = 0; i < p.h; i++) if (b[r + i] & (p.rows[i] << c)) return false;
  return true;
}

// Place, then clear every full row and column at once. Returns the new board and what was cleared.
export function place(b, p, r, c) {
  const out = b.slice();
  for (let i = 0; i < p.h; i++) out[r + i] |= p.rows[i] << c;
  let cols = FULL;
  const rows = [];
  for (let i = 0; i < N; i++) {
    cols &= out[i];
    if (out[i] === FULL) rows.push(i);
  }
  for (const i of rows) out[i] = 0;
  if (cols) for (let i = 0; i < N; i++) out[i] &= ~cols;
  return { board: out, rows, cols };
}

// countRegions in block_blast.py: each pair of side-by-side cells that differ, counted from both sides.
export function edge(b) {
  let n = 0;
  for (let i = 0; i < N; i++) {
    n += popcount((b[i] ^ (b[i] >> 1)) & (FULL >> 1));
    if (i < N - 1) n += popcount(b[i] ^ b[i + 1]);
  }
  return 2 * n;
}

// pieces: 1 to 3 grids. Returns null if they can't all go on, or
// { moves: [{ piece, row, col }], cleared, edge }, piece being the index into `pieces`.
export function solve(board, pieces) {
  const ps = pieces.map(pieceOf);
  const before = cellCount(board);
  let best = null, bestCleared = -Infinity, bestEdge = Infinity;
  const used = new Array(ps.length).fill(false);
  const stack = [];

  function go(b, depth) {
    if (depth === ps.length) {
      const cleared = before - cellCount(b);
      if (cleared < bestCleared) return;
      const e = edge(b);
      if (cleared > bestCleared || e < bestEdge) {
        bestCleared = cleared;
        bestEdge = e;
        best = stack.slice();
      }
      return;
    }
    for (let k = 0; k < ps.length; k++) {
      if (used[k]) continue;
      used[k] = true;
      const p = ps[k];
      for (let r = 0; r + p.h <= N; r++)
        for (let c = 0; c + p.w <= N; c++) {
          if (!fits(b, p, r, c)) continue;
          stack.push({ piece: k, row: r, col: c });
          go(place(b, p, r, c).board, depth + 1);
          stack.pop();
        }
      used[k] = false;
    }
  }

  go(board, 0);
  return best && { moves: best, cleared: bestCleared, edge: bestEdge };
}
