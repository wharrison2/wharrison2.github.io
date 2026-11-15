// Made by tools/build_content.py from content/shared.toml: edit the text there, not here.
const S = {
 "site": {
  "first_name": "William",
  "last_name": "Harrison"
 },
 "nav": {
  "writing": "Writing",
  "projects": "Projects"
 },
 "footer": {
  "github": "GitHub",
  "email": "Email",
  "to_fun": "Switch to fun mode",
  "to_professional": "Switch to professional mode"
 },
 "mode": {
  "question": "Professional or fun?",
  "professional": "Professional",
  "fun": "Fun",
  "note": "You can switch at the bottom of any page."
 },
 "mugging": {
  "label": "A mysterious figure",
  "text": "A mysterious figure approaches and claims they are the host of the simulation, and will create {number} tortured digital minds unless you give this website a star on GitHub. What do you do?",
  "number": "10^^^100",
  "star": "Star it",
  "refuse": "Refuse"
 },
 "paperclips": {
  "clip": "Paperclip",
  "shut_down": "Shut down"
 }
};
export default S;
// Fills in the {names} in a string: fill(S.some.key, { name: value }).
export const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
