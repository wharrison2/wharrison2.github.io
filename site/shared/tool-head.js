// Sync, in <head>: pick up the mode and the site's look before anything paints.
(function () {
  try { document.documentElement.dataset.mode = localStorage.getItem("site.mode") || ""; } catch (e) {}
  document.documentElement.dataset.variant = "v1";
  document.write('<link rel="stylesheet" href="../tokens.css">');
})();
