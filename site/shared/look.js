// Sync, in <head> after the page's own stylesheets: alternate looks (palette and type) and layouts.
// With SITE_LOOK_PICKER off (flags.js), every page uses each option's default (the settled design).
// With it on, ?look=<name> and ?layout=<name> pick one and remember it; an empty value (?look=) goes back to the
// original, and a small bar in the bottom-left corner switches between them.
// Layouts only apply to the site's own pages; the tool pages have their own arrangement.
(function () {
  var OPTIONS = [
    { key: "look", dir: "looks", names: ["clay", "clay-newsreader", "clay-source", "clay-mixed"], tools: true, def: "clay-source" },
    { key: "layout", dir: "layouts", names: ["spine", "timeline", "poster", "frontpage", "letter"], tools: false, def: "" },
  ];
  var root = document.documentElement;
  var onTool = "tool" in root.dataset; // tool-head.js marks the tool pages
  var base = document.currentScript.src.replace(/shared\/look\.js(\?.*)?$/, "");
  var q = new URLSearchParams(location.search);
  var chosen = {};
  OPTIONS.forEach(function (o) {
    if (onTool && !o.tools) return;
    var v = o.def;
    if (window.SITE_LOOK_PICKER) {
      try { v = localStorage.getItem("site." + o.key) || ""; } catch (e) {}
      if (q.has(o.key)) {
        v = q.get(o.key);
        try { if (v) localStorage.setItem("site." + o.key, v); else localStorage.removeItem("site." + o.key); } catch (e) {}
      }
    }
    if (o.names.indexOf(v) < 0) v = "";
    chosen[o.key] = v;
    if (v) {
      root.dataset[o.key] = v;
      document.write('<link rel="stylesheet" href="' + base + o.dir + "/" + v + '.css">');
    }
  });
  if (!window.SITE_LOOK_PICKER) return;
  document.addEventListener("DOMContentLoaded", function () {
    var bar = document.createElement("div");
    bar.className = "look-picker";
    bar.innerHTML = "<style>.look-picker{position:fixed;left:12px;bottom:12px;z-index:1400;display:grid;gap:4px;max-width:calc(100vw - 24px);" +
      "padding:6px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);font:12px/1 var(--font-mono);box-shadow:0 6px 20px -10px rgb(0 0 0/.35)}" +
      ".look-picker div{display:flex;flex-wrap:wrap;gap:2px;align-items:center}.look-picker b{font-weight:400;color:var(--muted);opacity:.7;width:4.5em}" +
      ".look-picker a{padding:6px 8px;border-radius:calc(var(--radius) - 1px);color:var(--muted);text-decoration:none}" +
      ".look-picker a:hover{color:var(--fg)}.look-picker a[aria-current]{background:var(--accent);color:var(--accent-fg)}" +
      ".look-picker button{font:inherit;color:var(--muted);background:none;border:0;padding:4px 6px;cursor:pointer;text-align:left}" +
      ".look-picker:not(:hover):not(:focus-within) div{display:none}</style>";
    var tab = document.createElement("button");
    tab.type = "button";
    tab.textContent = OPTIONS.filter(function (o) { return o.key in chosen; }).map(function (o) { return chosen[o.key] || "original"; }).join(" · ") + " ▴";
    bar.appendChild(tab);
    OPTIONS.forEach(function (o) {
      if (!(o.key in chosen)) return;
      var row = document.createElement("div");
      row.innerHTML = "<b>" + o.key + "</b>";
      [""].concat(o.names).forEach(function (name) {
        var a = document.createElement("a");
        var u = new URL(location.href);
        u.searchParams.set(o.key, name);
        a.href = u.pathname + u.search + u.hash;
        a.textContent = name || "original";
        if (name === chosen[o.key]) a.setAttribute("aria-current", "true");
        row.appendChild(a);
      });
      bar.appendChild(row);
    });
    document.body.appendChild(bar);
  });
})();
