// Made by tools/build_content.py from content/sar.toml: edit the text there, not here.
const S = {
 "page": {
  "title": "SAR pair viewer",
  "heading": "SAR pair viewer",
  "intro": "Two Sentinel-1 radar images of the Weddell Sea, off the Antarctic Peninsula, taken four days apart. Compare them overlaid or side by side."
 },
 "modes": {
  "label": "How to show the pair",
  "overlaid": "Overlaid",
  "overlap": "Overlap only",
  "full": "Full images"
 },
 "basemap": {
  "label": "Background",
  "blue_marble": "Blue Marble",
  "photo": "Satellite photo on the day",
  "photo_note": "Sea ice and cloud both look white in an optical photo, so here the radar shows much more than the photo does.",
  "photo_date": "photo from {date}"
 },
 "opacity": {
  "label": "Radar opacity"
 },
 "maps": {
  "before": "Before: {date}",
  "after": "After: {date}",
  "overlaid": "{before} and {after}",
  "key": "Red where the first image is brighter, cyan where the second is; gray where they match.",
  "before_label": "Map of the earlier image",
  "after_label": "Map of the later image",
  "coords_hint": "Point at a map for its coordinates.",
  "loading": "Loading the maps…",
  "failed": "The map library didn't load, so the maps can't be shown.",
  "credit": "Contains modified Copernicus Sentinel data 2024.",
  "basemap_credit": "Background and coastlines: NASA GIBS (Blue Marble, MODIS Terra)."
 },
 "about": {
  "heading": "About",
  "body": "This is a static version of a viewer I wrote for finding pairs of Sentinel-1 images of the same spot, before and after an event. Both images are warped from their ground control points onto NASA's polar stereographic map grid, at 64 m a pixel, and shown in decibels with the same brightness scale, over NASA's Blue Marble or that day's MODIS photo.\n\n[Code on GitHub](https://github.com/wharrison2/satellite_imagery_visualizer)\n"
 }
};
export default S;
// Fills in the {names} in a string: fill(S.some.key, { name: value }).
export const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
