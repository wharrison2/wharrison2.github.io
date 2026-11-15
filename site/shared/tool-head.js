// Sync, in <head> of the tool pages: pick up the mode and the site's colors and fonts before anything paints.
(function () {
  try { document.documentElement.dataset.mode = localStorage.getItem("site.mode") || ""; } catch (e) {}
  document.documentElement.dataset.tool = ""; // look.js: a tool page, so no alternate layouts
  document.write('<link rel="stylesheet" href="../tokens.css">');
})();
