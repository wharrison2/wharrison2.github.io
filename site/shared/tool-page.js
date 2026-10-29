// The tool pages (Markov, QR codes) borrow the colors and fonts of whichever version you came from.
// The inline script in each page's <head> has already loaded that version's tokens.css.
const variant = document.documentElement.dataset.variant || "v1";
document.querySelectorAll("[data-home]").forEach((a) => { a.href = `../${variant}/`; });
