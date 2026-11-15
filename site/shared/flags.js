// Sync, first thing in <head> on every page: site-wide switches.
// SITE_ALL_VERSIONS: false shows only v1. v2 and v3 send you to v1, the version list at the root sends you to v1,
// the tools use v1's look, and "Other versions" links go away. true brings all of it back.
window.SITE_ALL_VERSIONS = false;
// SITE_LOOK_PICKER: true shows a bar for trying v1's alternate looks and layouts (shared/look.js).
// false settles on the defaults in look.js (clay-source, original layout) for everyone.
window.SITE_LOOK_PICKER = false;
(function () {
  if (window.SITE_ALL_VERSIONS) return;
  var m = /^(.*\/)v[23]\/([^\/]*)$/.exec(location.pathname);
  if (m) location.replace(m[1] + "v1/" + m[2] + location.search + location.hash);
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-versions]").forEach(function (a) { a.remove(); });
  });
})();
