// The SAR pair viewer. The tiles and tiles/meta.json are made by tools/sar_tiles.py: both scenes on one EPSG:3031
// grid, in z/x/y WebP tiles where zoom meta.maxZoom is full resolution. Leaflet shows them in a flat pixel CRS
// (one unit = one full-resolution grid pixel, y down), so a map coordinate is [row, col] on that grid.
// - Overlaid: one map, the red/cyan tiles (made only where both scenes have data).
// - Overlap only: both scenes side by side, everything outside their overlap covered.
// - Full images: both scenes side by side, whole.
// The two maps follow each other. The readout turns grid pixels back into latitude and longitude.
import T, { fill } from "../strings/sar.js";

const $ = (id) => document.getElementById(id);
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// ---------- EPSG:3031 (WGS 84 / Antarctic polar stereographic, true scale at 71°S) back to lon/lat ----------
const A = 6378137, F = 1 / 298.257223563, E = Math.sqrt(2 * F - F * F), PHI_C = (71 * Math.PI) / 180;
const tOf = (phi) => Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi)), E / 2);
const M_C = Math.cos(PHI_C) / Math.sqrt(1 - E * E * Math.sin(PHI_C) ** 2), T_C = tOf(PHI_C);

// Snyder's north-pole inverse on the mirrored point, then mirrored back.
export function lonLat(x, y) {
  const xn = -x, yn = -y, rho = Math.hypot(xn, yn), t = (rho * T_C) / (A * M_C);
  let phi = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 8; i++) {
    const s = E * Math.sin(phi);
    phi = Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - s) / (1 + s), E / 2));
  }
  const lam = Math.atan2(xn, -yn);
  return [(-lam * 180) / Math.PI, (-phi * 180) / Math.PI];
}

const deg = (v, pos, neg) => Math.abs(v).toFixed(3) + "° " + (v >= 0 ? pos : neg);
const when = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});
const dateText = (iso) => when.format(new Date(iso)) + " UTC";

// ---------- the page ----------

async function start() {
  if (!window.L) {
    for (const id of ["map-a", "map-b"]) { $(id).classList.add("failed"); $(id).textContent = T.maps.failed; }
    return;
  }
  for (const id of ["map-a", "map-b"]) $(id).textContent = T.maps.loading;
  const meta = await (await fetch("tiles/meta.json")).json();
  for (const id of ["map-a", "map-b"]) $(id).textContent = "";

  const Z = meta.maxZoom, W = meta.width, H = meta.height;
  const crs = L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(2 ** -Z, 0, 2 ** -Z, 0) });
  const pt = ([col, row]) => [row, col];
  const grid = L.latLngBounds([0, 0], [H, W]);
  const overlap = meta.overlap.map(pt);
  const footprints = meta.scenes.map((s) => s.footprint.map(pt));
  const dates = meta.scenes.map((s) => dateText(s.date));

  const have = {};
  for (const [name, zs] of Object.entries(meta.tiles)) {
    have[name] = {};
    for (const [z, list] of Object.entries(zs)) have[name][z] = new Set(list);
  }
  const Tiles = L.TileLayer.extend({
    getTileUrl(c) {
      const z = this._getZoomForUrl();
      return have[this.options.set][z]?.has(c.x + "/" + c.y) ? `tiles/${this.options.set}/${z}/${c.x}/${c.y}.webp` : BLANK;
    },
  });
  const tiles = (set) => new Tiles("", { set, tileSize: meta.tile, minZoom: 0, maxNativeZoom: Z, maxZoom: Z + 1, bounds: grid, noWrap: true, keepBuffer: 1 });

  const makeMap = (id) =>
    L.map(id, { crs, minZoom: 0, maxZoom: Z + 1, zoomSnap: 0.25, zoomDelta: 0.5, attributionControl: false, maxBounds: grid.pad(0.25) });
  const maps = [makeMap("map-a"), makeMap("map-b")];

  const layers = {
    before: tiles("before"), after: tiles("after"), overlay: tiles("overlay"),
    // Covers everything but the overlap (a big rectangle with the overlap cut out of it).
    maskA: L.polygon([boxOf(grid.pad(1)), overlap], { className: "sar-mask", interactive: false }),
    maskB: L.polygon([boxOf(grid.pad(1)), overlap], { className: "sar-mask", interactive: false }),
    lineA: L.polygon(overlap, { className: "sar-outline", interactive: false, fill: false }),
    lineB: L.polygon(overlap, { className: "sar-outline", interactive: false, fill: false }),
  };
  const views = {
    overlaid: { a: ["overlay"], b: [], fit: overlap },
    overlap: { a: ["before", "maskA"], b: ["after", "maskB"], fit: overlap },
    full: { a: ["before", "lineA"], b: ["after", "lineB"], fit: footprints.flat() },
  };

  // Keep the maps together: whichever one moves, the other follows.
  let following = false;
  maps.forEach((m, i) => m.on("move zoom", () => {
    if (following || view === "overlaid") return;
    following = true;
    maps[1 - i].setView(m.getCenter(), m.getZoom(), { animate: false });
    following = false;
  }));

  // The readout under the maps.
  const coords = $("coords");
  const show = (e) => {
    const x = meta.origin[0] + e.latlng.lng * meta.res, y = meta.origin[1] - e.latlng.lat * meta.res;
    const [lon, lat] = lonLat(x, y);
    coords.textContent = deg(lat, "N", "S") + ", " + deg(lon, "E", "W");
  };
  for (const m of maps) { m.on("mousemove click", show); m.on("mouseout", () => (coords.textContent = T.maps.coords_hint)); }

  let view = null;
  const setView = (name) => {
    view = name;
    $("viewer").dataset.view = name;
    document.querySelectorAll(".modes [data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === name)));
    const v = views[name];
    for (const l of Object.values(layers)) for (const m of maps) m.removeLayer(l);
    v.a.forEach((k) => layers[k].addTo(maps[0]));
    v.b.forEach((k) => layers[k].addTo(maps[1]));
    $("label-a").textContent = name === "overlaid" ? fill(T.maps.overlaid, { before: dates[0], after: dates[1] }) : fill(T.maps.before, { date: dates[0] });
    $("label-b").textContent = fill(T.maps.after, { date: dates[1] });
    following = true;
    for (const m of maps) { m.invalidateSize(false); m.fitBounds(L.latLngBounds(v.fit), { animate: false, padding: [8, 8] }); }
    following = false;
  };
  document.querySelectorAll(".modes [data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  setView("overlaid");
  window.addEventListener("resize", () => maps.forEach((m) => m.invalidateSize(false)));
}

function boxOf(b) {
  return [b.getNorthWest(), b.getNorthEast(), b.getSouthEast(), b.getSouthWest()];
}

if (typeof window !== "undefined") start();
