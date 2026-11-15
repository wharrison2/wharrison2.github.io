// Made by tools/build_content.py from content/blockblast.toml: edit the text there, not here.
const S = {
 "page": {
  "title": "Block Blast solver",
  "heading": "Block Blast solver",
  "intro": "Copy your board and the three pieces you were dealt, and it works out where to put them: every order, every spot, and the one that clears the most."
 },
 "board": {
  "heading": "Your board",
  "hint": "Click or drag to fill the squares that are taken.",
  "label": "Board",
  "cell": "Row {row}, column {col}",
  "clear": "Clear board"
 },
 "pieces": {
  "heading": "Your pieces",
  "hint": "Draw each piece in a box, or pick it from the shapes below.",
  "slot": "Piece {n}",
  "cell": "Piece {n}, row {row}, column {col}",
  "clear": "Clear",
  "palette": "Shapes",
  "shape": "Shape with {n} squares"
 },
 "result": {
  "heading": "Best moves",
  "empty": "Add a piece to see where it goes.",
  "stuck": "These pieces can't all fit on this board.",
  "step": "Step {n}",
  "move": "Piece {piece} at row {row}, column {col}",
  "clears": "Clears {n} lines.",
  "clears_one": "Clears a line.",
  "after": "After",
  "left": "{n} squares filled",
  "left_one": "1 square filled",
  "left_none": "Board empty",
  "play": "Play these moves"
 },
 "about": {
  "heading": "How it picks",
  "body": "It tries the pieces in every order and every spot, clearing full rows and columns after each one, just as the game does. The best sequence is the one that takes the most squares off the board. On a tie, it picks the board with the least edge between filled and empty squares, so what's left is in solid blocks rather than scattered holes that new pieces can't fill.\n\n[Code on GitHub](https://github.com/wharrison2/block_blast_solver)\n"
 }
};
export default S;
// Fills in the {names} in a string: fill(S.some.key, { name: value }).
export const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
