// Made by tools/build_content.py from content/qr.toml: edit the text there, not here.
const S = {
 "page": {
  "title": "QR codes",
  "heading": "QR codes",
  "intro": "Everything happens in your browser; nothing you type is sent anywhere."
 },
 "controls": {
  "text": "Text or link",
  "ecl": "Error correction",
  "ecl_low": "Low (7%)",
  "ecl_medium": "Medium (15%)",
  "ecl_quartile": "Quartile (25%)",
  "ecl_high": "High (30%)",
  "shape": "Shape",
  "shape_square": "Squares",
  "shape_rounded": "Rounded",
  "shape_dots": "Dots",
  "margin": "Margin",
  "fg": "Foreground",
  "bg": "Background",
  "size": "PNG size",
  "size_512": "512 px",
  "size_1024": "1024 px",
  "size_2048": "2048 px"
 },
 "warnings": {
  "contrast": "The colors are close in brightness; some scanners won't read this.",
  "inverted": "Light code on a dark background: many scanners only read dark-on-light.",
  "margin": "A margin under 2 modules can make the code hard to pick out."
 },
 "preview": {
  "label": "Preview",
  "empty": "Type something to encode.",
  "too_long": "That's too long to fit in a QR code at this error correction. Try a lower level or shorter text.",
  "info": "Version {version} · {n}×{n} modules · {bytes}",
  "bytes": "{n} bytes",
  "one_byte": "1 byte",
  "png": "Download PNG",
  "svg": "Download SVG",
  "copy": "Copy",
  "copied": "Copied",
  "copy_failed": "Couldn't copy",
  "file": "qr-code"
 }
};
export default S;
// Fills in the {names} in a string: fill(S.some.key, { name: value }).
export const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
