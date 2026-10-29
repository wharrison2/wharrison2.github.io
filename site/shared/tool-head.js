// Sync, in <head>: pick up the version and mode before anything paints.
(function () {
  var v = "v1";
  try {
    v = localStorage.getItem("site.variant") || "v1";
    document.documentElement.dataset.mode = localStorage.getItem("site.mode") || "";
  } catch (e) {}
  var asked = new URLSearchParams(location.search).get("v");
  if (asked) v = asked;
  if (!/^v[123]$/.test(v) || !window.SITE_ALL_VERSIONS) v = "v1"; // see flags.js
  document.documentElement.dataset.variant = v;
  document.write('<link rel="stylesheet" href="../' + v + '/tokens.css">');
})();
