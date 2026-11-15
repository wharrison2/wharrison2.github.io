// The SAR pair viewer, on a real map. The radar tiles and tiles/meta.json are made by tools/sar_tiles.py on NASA
// GIBS's EPSG:3031 (Antarctic polar stereographic) tile grid, so they line up with GIBS's basemaps:
// top-left corner (-4194304, 4194304) m, 512 px tiles, 8192 / 2^z metres a pixel at zoom z.
// Leaflet shows that grid through Proj4Leaflet; a map's latlng is a real latitude and longitude.
// - Overlaid: one map, the red/cyan tiles (made only where both scenes have data) over the basemap.
// - Overlap only: both scenes side by side, everything outside their overlap mostly covered.
// - Full images: both scenes side by side, whole, with the overlap outlined.
// The background is Blue Marble or that day's MODIS Terra photo, with GIBS's coastlines on top. The two maps follow
// each other. The radar's opacity has a slider.
import T, { fill } from "../strings/sar.js";

const $ = (id) => document.getElementById(id);
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3031/best/";
const EPSG3031 = "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";
const MAX_ZOOM = 9; // two levels past the radar's full resolution
const OPACITY = 0.85;

const deg = (v, pos, neg) => Math.abs(v).toFixed(3) + "° " + (v >= 0 ? pos : neg);
const when = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateText = (iso) => when.format(new Date(iso)) + " UTC";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- the page ----------

async function start() {
  if (!window.L || !L.Proj) {
    for (const id of ["map-a", "map-b"]) { $(id).classList.add("failed"); $(id).textContent = T.maps.failed; }
    return;
  }
  for (const id of ["map-a", "map-b"]) $(id).textContent = T.maps.loading;
  const meta = await (await fetch("tiles/meta.json")).json();
  for (const id of ["map-a", "map-b"]) $(id).textContent = "";

  const { origin, res0, tile } = meta.grid;
  const half = -origin[0];
  const crs = new L.Proj.CRS("EPSG:3031", EPSG3031, {
    origin,
    resolutions: Array.from({ length: MAX_ZOOM + 1 }, (_, z) => res0 / 2 ** z),
    bounds: L.bounds([-half, -half], [half, half]),
  });
  const ll = ([x, y]) => crs.unproject(L.point(x, y)); // EPSG:3031 metres to a latlng
  const overlap = meta.overlap.map(ll);
  const dates = meta.scenes.map((s) => s.date);

  // ---- layers (each map needs its own copies) ----
  const have = {};
  for (const [name, zs] of Object.entries(meta.tiles)) {
    have[name] = {};
    for (const [z, list] of Object.entries(zs)) have[name][z] = new Set(list);
  }
  const Radar = L.TileLayer.extend({
    getTileUrl(c) {
      const z = this._getZoomForUrl();
      return have[this.options.set][z]?.has(c.x + "/" + c.y) ? `tiles/${this.options.set}/${z}/${c.x}/${c.y}.webp` : BLANK;
    },
  });
  const radar = (set) => new Radar("", {
    set, tileSize: tile, minNativeZoom: meta.minZoom, maxNativeZoom: meta.maxZoom, maxZoom: MAX_ZOOM,
    noWrap: true, keepBuffer: 1, opacity: OPACITY, zIndex: 2,
  });
  const gibs = (path, native, z = 0) => L.tileLayer(GIBS + path, {
    tileSize: tile, maxNativeZoom: native, maxZoom: MAX_ZOOM, noWrap: true, keepBuffer: 1, zIndex: z,
    attribution: esc(T.maps.credit) + " " + esc(T.maps.basemap_credit),
  });
  const blueMarble = () => gibs("BlueMarble_ShadedRelief_Bathymetry/default/500m/{z}/{y}/{x}.jpeg", 4);
  const photo = (iso) => gibs(`MODIS_Terra_CorrectedReflectance_TrueColor/default/${iso.slice(0, 10)}/250m/{z}/{y}/{x}.jpg`, 5);
  const coast = () => gibs("Coastlines/default/250m/{z}/{y}/{x}.png", 5, 3);
  // Covers everything but the overlap (a big box with the overlap cut out of it).
  const box = [[-half, half], [half, half], [half, -half], [-half, -half]].map(ll);
  const mask = () => L.polygon([box, overlap], { className: "sar-mask", interactive: false });
  const outline = () => L.polygon(overlap, { className: "sar-outline", interactive: false, fill: false });

  const sides = [0, 1].map((i) => ({
    blue: blueMarble(), photo: photo(dates[i]), coast: coast(), mask: mask(), outline: outline(),
    radar: radar(i ? "after" : "before"), overlay: i ? null : radar("overlay"),
  }));

  const makeMap = (id) => L.map(id, { crs, minZoom: 1, maxZoom: MAX_ZOOM, zoomSnap: 0.25, zoomDelta: 0.5, worldCopyJump: false });
  const maps = [makeMap("map-a"), makeMap("map-b")];
  for (const m of maps) m.attributionControl.setPrefix(false);

  // ---- fitting a set of EPSG:3031 points into a map ----
  const fit = (m, pts) => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const c = m.getContainer(); // not m.getSize(): Leaflet keeps the size it saw while the map was hidden
    const size = L.point(c.clientWidth - 16, c.clientHeight - 16);
    if (size.x <= 0 || size.y <= 0) return; // hidden (the second map, while overlaid)
    const r = Math.max((x1 - x0) / size.x, (y1 - y0) / size.y);
    const z = Math.floor(Math.log2(res0 / r) * 4) / 4;
    m.setView(ll([(x0 + x1) / 2, (y0 + y1) / 2]), Math.max(1, Math.min(MAX_ZOOM, z)), { animate: false });
  };

  // ---- keep the maps together: whichever one moves, the other follows ----
  let following = false, view = null;
  maps.forEach((m, i) => m.on("move zoom", () => {
    if (following || view === "overlaid") return;
    following = true;
    maps[1 - i].setView(m.getCenter(), m.getZoom(), { animate: false });
    following = false;
  }));

  // ---- the coordinate readout ----
  const coords = $("coords");
  const show = (e) => (coords.textContent = deg(e.latlng.lat, "N", "S") + ", " + deg(e.latlng.lng, "E", "W"));
  for (const m of maps) { m.on("mousemove click", show); m.on("mouseout", () => (coords.textContent = T.maps.coords_hint)); }

  // ---- what each mode shows ----
  const views = {
    overlaid: { a: ["overlay"], b: [], fit: meta.overlap },
    overlap: { a: ["radar", "mask"], b: ["radar", "mask"], fit: meta.overlap },
    full: { a: ["radar", "outline"], b: ["radar", "outline"], fit: meta.scenes.flatMap((s) => s.footprint) },
  };
  let base = "blue";

  const draw = () => {
    const v = views[view];
    sides.forEach((s, i) => {
      const m = maps[i];
      for (const l of Object.values(s)) if (l) m.removeLayer(l);
      if (i === 1 && view === "overlaid") return;
      if (!m._loaded) return; // no view yet
      s[base].addTo(m);
      s.coast.addTo(m);
      for (const k of i ? v.b : v.a) s[k].addTo(m);
    });
    const photoNote = base === "photo" ? " · " + fill(T.basemap.photo_date, { date: day.format(new Date(dates[0])) }) : "";
    $("label-a").textContent = view === "overlaid"
      ? fill(T.maps.overlaid, { before: dateText(dates[0]), after: dateText(dates[1]) }) + photoNote
      : fill(T.maps.before, { date: dateText(dates[0]) });
    $("label-b").textContent = fill(T.maps.after, { date: dateText(dates[1]) });
    $("photo-note").hidden = base !== "photo";
  };

  const setView = (name) => {
    view = name;
    $("viewer").dataset.view = name;
    document.querySelectorAll(".modes [data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === name)));
    following = true;
    for (const m of maps) { m.invalidateSize(false); fit(m, views[name].fit); }
    following = false;
    draw();
  };
  document.querySelectorAll(".modes [data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

  document.querySelectorAll(".basemaps [data-base]").forEach((b) => b.addEventListener("click", () => {
    base = b.dataset.base;
    document.querySelectorAll(".basemaps [data-base]").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
    draw();
  }));

  const slider = $("opacity");
  slider.value = OPACITY;
  slider.addEventListener("input", () => {
    for (const s of sides) { s.radar.setOpacity(+slider.value); s.overlay?.setOpacity(+slider.value); }
  });

  setView("overlaid");
  window.addEventListener("resize", () => maps.forEach((m) => m.invalidateSize(false)));
}

if (typeof window !== "undefined") start();
