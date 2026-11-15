"use strict";
// ── views: every panel renderer + its inline-handler functions ───────────────
// Reads shared state from core (live bindings); calls core.render() to re-render
// after a queue change. Handlers referenced from generated HTML are exposed on
// window by main.js.
import {
  $, fmt$, OBS, NAMES, TICKERS, HIST, FEED, TRUTH, pending, esc,
  colorFor, ENF_COLOR,
  effFraction, effYears, budgetLeft, queueableProjects, queueFits, render, t,
} from "./core.js";
import {
  renderAvailableItems, renderInProgressItems, renderCompletedAdvances,
} from "./research.js";

// ── Navigation ────────────────────────────────────────────────────────────────
export function switchView(v){
  document.querySelectorAll("#nav button[data-view]").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.view===v));
  document.querySelectorAll(".view").forEach(section =>
    section.classList.toggle("active", section.dataset.view===v));
  if(v==="market") drawCaps();   // <svg> has real pixel size only once visible
}

// ── Market cap chart ──────────────────────────────────────────────────────────
// An inline SVG line chart: one polyline per lab on a LINEAR market-cap y-axis,
// quarter dates along the bottom, and a "tab" ticker pinned at the right end of
// each line. Between the real quarter data points we draw a deterministic, purely
// VISUAL stock-like wiggle (see capWiggleSteps) — it never touches game state.

const SVG_NS = "http://www.w3.org/2000/svg";

// Layout margins (px) around the plotting area inside the SVG viewport.
const CAP_MARGIN_LEFT = 46;     // room for y-axis cap labels
const CAP_MARGIN_RIGHT = 84;    // room for the right-pinned tab tickers
const CAP_MARGIN_TOP = 12;
const CAP_MARGIN_BOTTOM = 24;   // room for the x-axis date labels

// The interim wiggle divides each quarter into this many sub-steps. The trough
// list (see capWiggleSteps) has one entry per step and sums to zero, so the
// endpoints of every quarter land EXACTLY on the real market-cap value.
const CAP_WIGGLE_STEPS_PER_QUARTER = 15;

// Per-step vertical "trough" magnitude in log space — controls how jagged the
// interim wiggle looks. Small so the visual stays near the real trend line.
const CAP_WIGGLE_TROUGH_SCALE = 0.012;

// A sliver of breathing room above the tallest drawn point so the highest lab's
// wiggle peak sits just inside the top edge instead of touching (or being clipped
// by) the SVG viewport. Applied to the true drawn max (see maxDisplayedCap).
const CAP_PLOT_HEADROOM = 1.04;

// Quarter dates start here (mirrors backend config START_YEAR / DT_YEARS: one
// turn is one quarter). The graph is display-only, so duplicating these is fine.
const CAP_START_YEAR = 2019;
const CAP_QUARTERS_PER_YEAR = 4;

// Tab-ticker geometry (px). The tab is triangle(point facing LEFT) + rectangle +
// right semicircle; sized to the text, enlarged slightly on hover via CSS scale.
const CAP_TAB_HEIGHT = 16;
const CAP_TAB_TRIANGLE_WIDTH = 7;
const CAP_TAB_TEXT_PADDING = 6;
const CAP_TAB_CHAR_WIDTH = 7.5;   // approx advance of the 11px monospace ticker

export function drawCaps(){
  const svg = $("capgraph-big"); if(!svg) return;
  if(!OBS) return;   // switchView("market") can call this before a game exists

  // Size the SVG coordinate system to the displayed box so 1 unit == 1 px.
  const width = svg.clientWidth || 1200;
  const height = svg.clientHeight || 500;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  while(svg.firstChild) svg.removeChild(svg.firstChild);

  if(!HIST.length){
    appendSvgText(svg, CAP_MARGIN_LEFT, 90,
      t("caps.empty"), "cap-axis-text");
    renderCapLegend();
    renderCapMetrics();
    return;
  }

  const labIds = Object.keys(HIST[HIST.length-1].caps);

  // Scale the y-axis to the tallest point ACTUALLY DRAWN, not just the raw quarter
  // endpoints. The polyline includes the deterministic interim wiggle, whose
  // cumulative trough can carry a quarter's interior ABOVE its endpoint cap. Scaling
  // to the endpoints alone pushed the top lab's wiggle peaks past plotTop, where the
  // SVG viewport clipped them flat — the graph "did not fit the whole history". A
  // sliver of headroom keeps the peak just inside the top edge.
  const maxDrawnCap = maxDisplayedCap(labIds);
  const maxCap = Math.max(maxDrawnCap * CAP_PLOT_HEADROOM, 10);

  const plotLeft = CAP_MARGIN_LEFT;
  const plotRight = width - CAP_MARGIN_RIGHT;
  const plotTop = CAP_MARGIN_TOP;
  const plotBottom = height - CAP_MARGIN_BOTTOM;

  // x maps turn index → px (linear, evenly spaced quarters); y maps cap → px on a
  // LINEAR scale (was log) so absolute lead/gap between labs reads truthfully.
  const lastTurnIdx = HIST.length - 1;
  const xForTurn = turnIdx => plotLeft +
    (plotRight - plotLeft) * turnIdx / (lastTurnIdx || 1);
  const yForCap = capValue => plotBottom -
    (plotBottom - plotTop) * capValue / maxCap;

  drawCapGridlines(svg, maxCap, plotLeft, plotRight, yForCap);
  drawCapDateAxis(svg, HIST, xForTurn, plotBottom);

  // UI_ISSUES issue 1: when labs have similar final caps their right-edge tabs
  // land at nearly the same y and OVERLAP. Previously each lab wired its own
  // mouseenter/mouseleave, so stacked tabs fought each other (flicker, multiple
  // "hovered" at once). Fix in three parts:
  //   (a) cluster labs by final tab-y so we know which tabs overlap;
  //   (b) make only ONE tab per cluster interactive (player if present, else the
  //       highest cap) — the rest get pointer-events:none so they can't grab hover;
  //   (c) route every line/tab listener through ONE shared setHoveredLab() so a
  //       newly hovered lab always deactivates the previously hovered one.
  // (lastTurnIdx is already declared above for the x-axis scale; reuse it.)
  const tabEligibleLabIds = computeTabEligibleLabIds(labIds, lastTurnIdx, yForCap);

  // Shared hover state lives in this scope so only one lab is ever active. Holds
  // the per-lab visual togglers (registered by drawCapLabSeries) and the id of
  // the currently hovered lab; setHoveredLab() clears the old, applies the new.
  const labHoverTogglers = new Map();
  let hoveredLabId = null;
  const setHoveredLab = nextLabId => {
    if(nextLabId === hoveredLabId) return;
    if(hoveredLabId !== null && labHoverTogglers.has(hoveredLabId)){
      labHoverTogglers.get(hoveredLabId)(false);
    }
    hoveredLabId = nextLabId;
    if(hoveredLabId !== null && labHoverTogglers.has(hoveredLabId)){
      labHoverTogglers.get(hoveredLabId)(true);
    }
  };
  // Used by a lab's mouseleave: only clear hover if that lab is the active one,
  // so a cursor crossing straight onto a new lab (whose enter already fired)
  // keeps the new hover instead of being wiped by the old lab's leave.
  setHoveredLab.clearIfActive = labId => {
    if(hoveredLabId === labId) setHoveredLab(null);
  };

  // Draw a line + right-edge tab ticker for every lab. Each series registers its
  // visual toggler with the shared setter and reports whether its tab is the
  // interactive one for its overlap cluster.
  labIds.forEach(labId => {
    const isTabInteractive = tabEligibleLabIds.has(labId);
    drawCapLabSeries(svg, labId, xForTurn, yForCap, {
      isTabInteractive,
      setHoveredLab,
      labHoverTogglers,
    });
  });

  renderCapLegend();
  renderCapMetrics();
}

// UI_ISSUES issue 1, part (a)+(b): group labs whose final tab y-positions sit
// within CAP_TAB_HEIGHT of each other (i.e. their tabs visually overlap), then
// pick ONE hover-eligible lab per cluster — the player (OBS.lab_id) if it falls
// in the cluster, otherwise the highest-cap lab. Returns the set of lab ids whose
// tabs should stay interactive; every other tab is rendered pointer-events:none.
function computeTabEligibleLabIds(labIds, lastTurnIdx, yForCap){
  // Snapshot each lab's final cap and the tab y it produces, so clustering and
  // eligibility both read the same numbers the tab is actually drawn at.
  const labsByDescendingTabY = labIds
    .map(labId => {
      const finalCap = HIST[lastTurnIdx].caps[labId] ?? 1;
      return { labId, finalCap, tabY: yForCap(finalCap) };
    })
    .sort((a, b) => a.tabY - b.tabY);

  const eligibleLabIds = new Set();
  let currentCluster = [];
  let clusterTopY = null;

  const finalizeCluster = () => {
    if(currentCluster.length === 0) return;
    const eligibleLabId = pickClusterHoverLab(currentCluster);
    eligibleLabIds.add(eligibleLabId);
  };

  labsByDescendingTabY.forEach(labEntry => {
    const startsNewCluster = clusterTopY === null ||
      labEntry.tabY - clusterTopY > CAP_TAB_HEIGHT;
    if(startsNewCluster){
      finalizeCluster();
      currentCluster = [];
      clusterTopY = labEntry.tabY;
    }
    currentCluster.push(labEntry);
  });
  finalizeCluster();

  return eligibleLabIds;
}

// Choose the single hover-eligible lab in an overlapping cluster: the player's
// own lab (OBS.lab_id) if it is in the cluster, else the highest-cap lab.
function pickClusterHoverLab(cluster){
  const playerLabId = OBS ? OBS.lab_id : null;
  const playerEntry = cluster.find(entry => entry.labId === playerLabId);
  if(playerEntry) return playerEntry.labId;

  let highestCapEntry = cluster[0];
  cluster.forEach(entry => {
    if(entry.finalCap > highestCapEntry.finalCap) highestCapEntry = entry;
  });
  return highestCapEntry.labId;
}

// Append an SVG <text> with content set via textContent (XSS-safe even for the
// player-authored ticker — never built into innerHTML markup).
function appendSvgText(parent, x, y, text, className){
  const node = document.createElementNS(SVG_NS, "text");
  node.setAttribute("x", x);
  node.setAttribute("y", y);
  if(className) node.setAttribute("class", className);
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

// Horizontal gridlines at a few round-ish cap values up to the max.
function drawCapGridlines(svg, maxCap, plotLeft, plotRight, yForCap){
  const candidateLevels = [10, 100, 250, 500, 1000, 2500, 5000, 10000,
                           25000, 50000, 100000, 250000, 500000, 1000000];
  const visibleLevels = candidateLevels.filter(level => level <= maxCap);
  visibleLevels.forEach(level => {
    const y = yForCap(level);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", plotLeft);
    line.setAttribute("x2", plotRight);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("class", "cap-gridline");
    svg.appendChild(line);

    const label = level >= 1000 ? (level / 1000) + "k" : String(level);
    appendSvgText(svg, 4, y + 3, label, "cap-axis-text");
  });
}

// Quarter-date labels along the bottom. Derived from the turn index: one turn is
// one quarter starting at CAP_START_YEAR (mirrors backend START_YEAR/DT_YEARS).
// Thin the labels when turns are crowded so they don't overlap.
function drawCapDateAxis(svg, hist, xForTurn, plotBottom){
  const maxLabels = 10;
  const labelStride = Math.max(1, Math.ceil(hist.length / maxLabels));
  hist.forEach((histEntry, turnIdx) => {
    const isLastTurn = turnIdx === hist.length - 1;
    if(turnIdx % labelStride !== 0 && !isLastTurn) return;
    const label = quarterLabelForTurn(histEntry.turn);
    const node = appendSvgText(svg, xForTurn(turnIdx), plotBottom + 16,
      label, "cap-axis-text");
    node.setAttribute("text-anchor", "middle");
  });
}

// Turn index → "Q1 2021"-style label (4 quarters per year from CAP_START_YEAR).
function quarterLabelForTurn(turnIndex){
  const yearOffset = Math.floor(turnIndex / CAP_QUARTERS_PER_YEAR);
  const quarterOfYear = (turnIndex % CAP_QUARTERS_PER_YEAR) + 1;
  const year = CAP_START_YEAR + yearOffset;
  return t("caps.quarterLabel", {quarter: quarterOfYear, year: year});
}

// Draw one lab's wiggling polyline plus its right-edge tab ticker, wired so
// hovering either element thickens the line and enlarges the tab. Hover is
// coordinated through the shared `setHoveredLab` so only one lab is ever active
// (UI_ISSUES issue 1); `isTabInteractive` is false for tabs that lost their
// overlap cluster's eligibility, which get pointer-events:none so they can't
// fight the eligible tab on top of the stack.
function drawCapLabSeries(svg, labId, xForTurn, yForCap, hoverCoordination){
  const { isTabInteractive, setHoveredLab, labHoverTogglers } = hoverCoordination;
  const color = colorFor(labId);
  const isPlayer = labId === OBS.lab_id;   // your OWN lab (solo: "player")

  const points = capWigglePoints(labId, xForTurn, yForCap);
  const pointsAttr = points.map(p => p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ");

  const line = document.createElementNS(SVG_NS, "polyline");
  line.setAttribute("points", pointsAttr);
  line.setAttribute("stroke", color);
  line.setAttribute("class", "cap-line" + (isPlayer ? " cap-line-player" : ""));
  svg.appendChild(line);

  const lineEnd = points[points.length - 1];
  const tab = buildCapTab(labId, color, lineEnd.x, lineEnd.y);
  // Non-eligible tabs in an overlapping cluster must not grab hover; the single
  // eligible tab stays on top and interactive (UI_ISSUES issue 1, part (b)).
  if(!isTabInteractive) tab.style.pointerEvents = "none";
  svg.appendChild(tab);

  // The lab's visual toggle: thicken the line (cap-hover stroke-width) and lift the
  // series — line then tab — to the FRONT of the SVG so it isn't hidden under a
  // neighbour. SVG has no z-index; paint order IS document order, so re-appending
  // moves the nodes to the top of the stack. Nothing is scaled or translated: the
  // tab stays exactly where it sits and the ticker does not move (per design: the
  // hovered line just gets thicker and surfaced, never enlarged). The shared
  // setHoveredLab() calls this with true/false, so two labs can't be active at once.
  const applyHoverVisual = isHovering => {
    line.classList.toggle("cap-hover", isHovering);
    if(isHovering){
      svg.appendChild(line);
      svg.appendChild(tab);
    }
  };
  labHoverTogglers.set(labId, applyHoverVisual);

  // Lines don't stack the way tabs do, so they stay individually hoverable; but
  // every listener routes through the shared setter so entering a new line/tab
  // deactivates the prior lab (never two active). On leave, clear only if THIS
  // lab is still active: when the cursor crosses straight onto another lab the
  // browser fires that lab's enter BEFORE our leave, so an unconditional clear
  // would wipe the new hover (and reintroduce flicker).
  const clearHoverIfStillActive = () => setHoveredLab.clearIfActive(labId);
  line.addEventListener("mouseenter", () => setHoveredLab(labId));
  line.addEventListener("mouseleave", clearHoverIfStillActive);
  tab.addEventListener("mouseenter", () => setHoveredLab(labId));
  tab.addEventListener("mouseleave", clearHoverIfStillActive);
}

// The largest cap value that will actually be DRAWN across every lab — i.e. the
// max over all interim wiggle steps (capWiggleSteps), not just the real quarter
// endpoints. drawCaps scales the y-axis to this so the wiggle peaks fit inside the
// plot instead of being clipped by the SVG viewport. Reads the same cached wiggle
// values the polyline is built from, in value-space (no pixels), so the two agree.
function maxDisplayedCap(labIds){
  let maxValue = 0;
  labIds.forEach(labId => {
    for(let quarterIdx = 0; quarterIdx < HIST.length - 1; quarterIdx++){
      const startCap = HIST[quarterIdx].caps[labId] ?? 1;
      const endCap = HIST[quarterIdx + 1].caps[labId] ?? 1;
      const turnIndex = HIST[quarterIdx].turn;
      const interimCaps = capWiggleSteps(labId, turnIndex, startCap, endCap);
      interimCaps.forEach(capValue => {
        if(capValue > maxValue) maxValue = capValue;
      });
    }
    // The final quarter has no wiggle (it is pinned in capWigglePoints), so its
    // raw endpoint value is the drawn value there.
    const lastCap = HIST[HIST.length - 1].caps[labId] ?? 1;
    if(lastCap > maxValue) maxValue = lastCap;
  });
  return maxValue;
}

// Build the wiggling point list for a lab: real quarter endpoints with the
// deterministic interim noise (capWiggleSteps) filling each quarter interval.
function capWigglePoints(labId, xForTurn, yForCap){
  const points = [];
  for(let quarterIdx = 0; quarterIdx < HIST.length - 1; quarterIdx++){
    const startCap = HIST[quarterIdx].caps[labId] ?? 1;
    const endCap = HIST[quarterIdx + 1].caps[labId] ?? 1;
    const turnIndex = HIST[quarterIdx].turn;
    const interimCaps = capWiggleSteps(labId, turnIndex, startCap, endCap);
    interimCaps.forEach((capValue, stepIdx) => {
      const stepFraction = stepIdx / CAP_WIGGLE_STEPS_PER_QUARTER;
      const x = xForTurn(quarterIdx) + stepFraction *
        (xForTurn(quarterIdx + 1) - xForTurn(quarterIdx));
      points.push({x, y: yForCap(capValue)});
    });
  }
  // The very last real quarter has no following point to wiggle toward, so pin it.
  const lastTurnIdx = HIST.length - 1;
  const lastCap = HIST[lastTurnIdx].caps[labId] ?? 1;
  points.push({x: xForTurn(lastTurnIdx), y: yForCap(lastCap)});
  return points;
}

// The interim noise, per the designer's method (FIX_ITEMS "Market cap graph"):
//   - split the quarter into N steps;
//   - build a zero-sum trough list (length N, summing to 0) and SHUFFLE it;
//   - displayed value at step i = exp( sum(troughs[0..i]) + i*ln(growth)/N ),
//     where growth = endCap/startCap. The cumulative trough term is mean-zero so
//     the endpoints stay EXACTLY on the real quarter values; the i*ln(growth)/N
//     term tilts the interior up toward endCap like a real stock chart.
// The wiggle is DISPLAY-ONLY and must never touch the seeded game RNG, so the
// shuffle is driven by a tiny self-contained PRNG seeded by (turn, lab) — same
// (lab, quarter) ⇒ same shuffle on every re-render/resize (no jitter), and the
// result is cached so we only shuffle once.
const _capWiggleCache = new Map();

function capWiggleSteps(labId, turnIndex, startCap, endCap){
  const cacheKey = labId + "@" + turnIndex;
  let troughs = _capWiggleCache.get(cacheKey);
  if(!troughs){
    troughs = buildShuffledTroughs(labId, turnIndex);
    _capWiggleCache.set(cacheKey, troughs);
  }

  const growthFactor = endCap / (startCap || 1);
  const logGrowthPerStep = Math.log(growthFactor) / CAP_WIGGLE_STEPS_PER_QUARTER;

  const caps = [];
  let cumulativeTrough = 0;
  for(let step = 0; step < CAP_WIGGLE_STEPS_PER_QUARTER; step++){
    cumulativeTrough += troughs[step];
    const logValue = cumulativeTrough + step * logGrowthPerStep;
    caps.push(startCap * Math.exp(logValue));
  }
  return caps;
}

// A symmetric, zero-sum trough list (…,-2,-1,0,1,2,… scaled), then shuffled by a
// deterministic per-(lab,quarter) PRNG so it never re-randomizes across renders.
function buildShuffledTroughs(labId, turnIndex){
  const stepCount = CAP_WIGGLE_STEPS_PER_QUARTER;
  const troughs = [];
  for(let step = 0; step < stepCount; step++){
    const centered = step - (stepCount - 1) / 2;   // symmetric → sums to zero
    troughs.push(centered * CAP_WIGGLE_TROUGH_SCALE);
  }

  // Deterministic seed from the turn index and a stable hash of the lab id; this
  // is the ONLY randomness here and it is wall-of-glass separate from the game RNG.
  const seed = (turnIndex + 1) * 1000003 + hashLabId(labId);
  const nextRandom = makeDisplayPrng(seed);

  // Fisher–Yates shuffle driven by the display PRNG.
  for(let i = troughs.length - 1; i > 0; i--){
    const j = Math.floor(nextRandom() * (i + 1));
    const swap = troughs[i];
    troughs[i] = troughs[j];
    troughs[j] = swap;
  }
  return troughs;
}

// Tiny self-contained PRNG (mulberry32) for DISPLAY noise only. NOT the seeded
// game RNG — this never influences game state, just the cosmetic wiggle.
function makeDisplayPrng(seed){
  let state = seed >>> 0;
  return function nextRandom(){
    state = (state + 0x6D2B79F5) >>> 0;
    let scrambled = state;
    scrambled = Math.imul(scrambled ^ (scrambled >>> 15), scrambled | 1);
    scrambled ^= scrambled + Math.imul(scrambled ^ (scrambled >>> 7), scrambled | 61);
    return ((scrambled ^ (scrambled >>> 14)) >>> 0) / 4294967296;
  };
}

// Stable small integer hash of a lab id, so the display PRNG seed is reproducible.
function hashLabId(labId){
  let hash = 0;
  for(let i = 0; i < labId.length; i++){
    hash = (hash * 31 + labId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// Build a tab-shaped ticker pinned at (lineEndX, lineEndY): an isosceles triangle
// whose POINT faces LEFT toward the line end, a rectangle in the middle holding
// the ticker text, and a semicircle capping the RIGHT edge. Drawn as one <path>;
// ticker text is set via textContent (XSS-safe) and forced sans-serif in CSS.
function buildCapTab(labId, color, lineEndX, lineEndY){
  const ticker = (TICKERS[labId] || labId).toUpperCase();
  const textWidth = Math.max(ticker.length * CAP_TAB_CHAR_WIDTH, CAP_TAB_CHAR_WIDTH);
  const rectWidth = textWidth + CAP_TAB_TEXT_PADDING * 2;
  const halfHeight = CAP_TAB_HEIGHT / 2;

  // Geometry, left → right, vertically centered on the line end:
  //   triangle tip at lineEndX (points left), triangle base CAP_TAB_TRIANGLE_WIDTH
  //   to the right, then the rectangle, then a semicircle of radius halfHeight.
  const triangleTipX = lineEndX;
  const rectLeftX = triangleTipX + CAP_TAB_TRIANGLE_WIDTH;
  const rectRightX = rectLeftX + rectWidth;
  const top = lineEndY - halfHeight;
  const bottom = lineEndY + halfHeight;

  const pathData = [
    `M ${triangleTipX} ${lineEndY}`,            // triangle tip (points at the line)
    `L ${rectLeftX} ${top}`,                    // up to rectangle top-left
    `L ${rectRightX} ${top}`,                   // across the rectangle top
    `A ${halfHeight} ${halfHeight} 0 0 1 ${rectRightX} ${bottom}`,  // right semicircle
    `L ${rectLeftX} ${bottom}`,                 // back across the rectangle bottom
    "Z",                                        // close to the triangle tip
  ].join(" ");

  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", "cap-tab");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathData);
  path.setAttribute("fill", color);
  path.setAttribute("class", "cap-tab-shape");
  group.appendChild(path);

  const textX = rectLeftX + rectWidth / 2;
  const text = appendSvgText(group, textX, lineEndY + 4, ticker, "cap-tab-text");
  text.setAttribute("text-anchor", "middle");
  return group;
}

// Bottom legend: a swatch + ticker + name + current cap per lab. Player-authored
// names/tickers are untrusted, so escape both before they go into innerHTML.
function renderCapLegend(){
  $("caplegend").innerHTML = Object.entries(OBS.market_caps)
    .sort((a, b) => b[1] - a[1])
    .map(([labId, capValue]) => {
      const ticker = esc(TICKERS[labId] || labId);
      const name = esc(NAMES[labId] || labId);
      const swatch = `<i class="lg" style="background:${colorFor(labId)}"></i>`;
      return `<span style="margin-right:10px">${swatch}<b>${ticker}</b> ${name} ${fmt$(capValue)}</span>`;
    })
    .join("");
}

// Player finance snapshot beneath the graph (fills the space under the chart).
// All from the player's own observation/HIST — no hidden state involved.
//   ARR = annual revenue (revenue_rate is already per-year)
//   P/E = market cap / annual revenue (revenue as the earnings proxy)
//   YoY = market-cap change vs ~1 year (4 quarters) ago, from HIST
function renderCapMetrics(){
  const el = $("capmetrics"); if(!el) return;
  const me = OBS.lab_id;
  const marketCap = (OBS.market_caps && OBS.market_caps[me]) || 0;
  const annualRevenue = OBS.revenue_rate || 0;
  const priceEarnings = annualRevenue > 0 ? marketCap / annualRevenue : null;
  const yearOnYear = capYoYGrowth(me);

  const metricCard = (label, value) =>
    `<div class="metric"><div class="metric-label">${label}</div>
       <div class="metric-value">${value}</div></div>`;
  el.innerHTML =
    metricCard(t("caps.metric.marketCap"), fmt$(marketCap)) +
    metricCard(t("caps.metric.arr"), fmt$(annualRevenue)) +
    metricCard(t("caps.metric.pe"), priceEarnings === null ? "—" : priceEarnings.toFixed(1) + "×") +
    metricCard(t("caps.metric.yoy"), yearOnYear === null ? "—" : fmtPctSigned(yearOnYear));
}

// Year-on-year market-cap growth: needs a full year of history (4 quarters back).
const QUARTERS_PER_YEAR = 4;
function capYoYGrowth(labId){
  const lastIdx = HIST.length - 1;
  if(lastIdx < QUARTERS_PER_YEAR) return null;     // <1 year of data → no true YoY
  const current = HIST[lastIdx].caps[labId];
  const yearAgo = HIST[lastIdx - QUARTERS_PER_YEAR].caps[labId];
  if(current === undefined || yearAgo === undefined || yearAgo <= 0) return null;
  return current / yearAgo - 1;
}

function fmtPctSigned(fraction){
  const pct = fraction * 100;
  const sign = pct >= 0 ? "+" : "";
  return t("caps.yoy.value", {sign: sign, pct: pct.toFixed(0)});
}

// ── Lab panel renderers ───────────────────────────────────────────────────────
export function renderTraining(){
  const el = $("training");
  const model = OBS.model_in_training;

  if(!model){
    el.innerHTML = `<span class="dim">${t("training.empty")}</span>`;
    return;
  }

  const elicitation = model.elicitation;
  const alignment = model.measured_alignment;

  el.innerHTML = `
    <div class="row"><b>${model.id}</b><span class="tag">${t("training.rounds", {rounds: model.post_train_rounds})}</span></div>
    <div class="row">${t("training.measuredGeneral")} <b>${model.measured_capability.general}</b>
      · ${t("training.coding")} <b>${model.measured_capability.coding_rnd}</b>
      · ${t("training.ceilingEst")} <b>${elicitation.ceiling_estimate}</b></div>
    <div class="row dim">${t("training.dangerousEval", {value: model.dangerous_capability_eval})}</div>
    <div class="row dim">${t("training.measuredAlignment", {
      goalmis: alignment.goal_misalignment, decep: alignment.deception,
      evalaware: alignment.eval_awareness, selfpres: alignment.self_preservation,
      jailbreak: alignment.jailbreak_sensitivity})}</div>
    <details><summary>${t("training.projection.summary")}</summary>
      <table>${elicitation.projection.map(projStep =>
        `<tr><td>${t("training.projection.moreRounds", {rounds: projStep.more_rounds})}</td><td>${projStep.projected_general}</td></tr>`
      ).join("")}</table>
    </details>
    ${postTrainSafetyHTML()}
    <div class="row"><label><input type="checkbox" id="release-cb"
      ${pending.release?"checked":""} onchange="toggleRelease(this.checked)">
      ${t("training.release.label")}</label></div>
    ${releaseGateHTML()}`;
}

// §7c: an active policy that would BLOCK or DELAY the release explains itself right
// at the control, so the player doesn't submit and only learn why from a feed line
// next turn. legal_moves.release_gate is null when nothing gates the release.
function releaseGateHTML(){
  const gate = OBS.legal_moves.release_gate;
  if(!gate) return "";
  const cls = gate.blocked ? "bad" : "warn";
  return `<div class="row feed-${gate.blocked?"event":"tip"}" style="font-size:12px">
    <span class="${cls}">${gate.blocked ? "⛔" : "⏳"}</span> ${esc(gate.reason)}</div>`;
}

// The post-train round controls. The old per-round MODE dropdown is gone (Stage A
// removed the knob); a round is now defined by WHICH researched post-train safety
// advances you APPLY to it (legal_moves.applicable_post_train_safety → the
// post_train action's applied_safety list).
function postTrainSafetyHTML(){
  const applicable = OBS.legal_moves.applicable_post_train_safety || [];
  const queued = pending.post_train;          // null | {applied_safety:[ids]}
  const applied = (queued && queued.applied_safety) || [];

  const advanceRows = applicable.length
    ? applicable.map(advance => {
        const isApplied = applied.includes(advance.advance_id);
        return `<div class="row"><label title="${esc(advance.risk_blurb || "")}">
          <input type="checkbox" ${isApplied ? "checked" : ""}
            onchange="togglePostTrainSafety('${esc(advance.advance_id)}',this.checked)">
          ${esc(advance.name)}</label></div>`;
      }).join("")
    : `<div class="dim" style="font-size:11px">${t("postTrain.empty")}</div>`;

  const ptQueued = queued != null;
  return `<div class="row" style="margin-top:6px"><b>${t("postTrain.heading")}</b>
      <label style="margin-left:8px"><input type="checkbox" ${ptQueued ? "checked" : ""}
        onchange="togglePostTrain(this.checked)"> ${t("postTrain.runRound")}</label></div>
    <div class="dim" style="font-size:11px">${t("postTrain.explainer")}</div>
    ${ptQueued ? advanceRows : ""}`;
}

// Toggle whether a post-train round runs this turn. Starting one preserves any
// already-chosen advances; turning it off clears the queued post_train entirely.
export function togglePostTrain(on){
  const previous = pending.post_train;   // restore this if starting a round overruns budget
  pending.post_train = on ? {applied_safety: pending.post_train?.applied_safety || []} : null;
  if(on){
    const fit = queueFits();
    if(!fit.ok){
      pending.post_train = previous;     // revert: the round didn't fit the work-budget
      $("errors").textContent = fit.reason;
      renderTraining();                  // re-sync the checkbox to the reverted state
      return;
    }
  }
  $("errors").textContent = "";
  renderTraining(); renderQueue();
  $("t-budget").textContent = budgetLeft().toFixed(2);
}

// Apply / un-apply one researched post-train safety advance to this round.
export function togglePostTrainSafety(advanceId, on){
  if(!pending.post_train) pending.post_train = {applied_safety: []};
  const applied = pending.post_train.applied_safety;
  if(on){
    if(!applied.includes(advanceId)){
      applied.push(advanceId);
      const fit = queueFits();
      if(!fit.ok){
        applied.pop();                   // revert: this advance pushed the round over budget
        $("errors").textContent = fit.reason;
        renderTraining();                // re-sync the checkbox to the reverted state
        return;
      }
    }
  } else {
    pending.post_train.applied_safety = applied.filter(id => id !== advanceId);
  }
  $("errors").textContent = "";
  renderQueue();
  $("t-budget").textContent = budgetLeft().toFixed(2);
}

export function toggleRelease(on){
  pending.release = on;
  renderQueue();
}

export function renderPretrain(){
  const el = $("pretrain");
  const lm = OBS.legal_moves;
  const activeRun = OBS.in_progress.find(p => p.project_id === "pretrain_run");

  if(activeRun){
    el.innerHTML =
      `<span class="dim">${t("pretrain.inProgress", {years: activeRun.years_remaining_estimate})}</span>`;
    return;
  }

  if(!lm.can_commission_run){
    el.innerHTML =
      `<span class="dim">${t("pretrain.unavailable")}</span>`;
    return;
  }

  const defaultCompute = Math.min(Math.round(OBS.cash * 0.6), lm.max_run_compute);
  // Labeled-form structure (issue 4): each field is a LABEL : VALUE row so the
  // controls read as a small form, not a sentence with an input wedged in. The
  // compute input keeps its id/handler; the queue button keeps onclick="queueRun".
  el.innerHTML = `
    <div class="kv"><span class="kv-label">${t("pretrain.field.compute")}</span>
      <span class="kv-value">${t("pretrain.compute.pre")}<input type="number" id="run-compute"
        min="50" step="50" value="${defaultCompute}">M</span></div>
    <div class="kv"><span class="kv-label">${t("pretrain.field.max")}</span>
      <span class="kv-value dim">${t("pretrain.compute.maxNote", {max: fmt$(lm.max_run_compute)})}</span></div>
    <div class="row"><button onclick="queueRun()">${t("pretrain.queueRun")}</button></div>
    <div class="dim">${t("pretrain.computeHint")}</div>
    ${pretrainSafetyHTML()}`;

  if(pending.commission_run){
    const applied = pending.commission_run.applied_safety || [];
    // applied ids come from the chosen advances — esc() before they enter innerHTML.
    const appliedNote = applied.length
      ? t("pretrain.queued.safetyNote", {list: esc(applied.join(", "))}) : "";
    el.innerHTML =
      `<div class="kv"><span class="kv-label">${t("pretrain.field.queued")}</span>
        <span class="kv-value">${fmt$(pending.commission_run.compute)}${appliedNote}
        <button onclick="clearRun()">✕</button></span></div>`;
  }
}

// Pretrain safety-advance pickers. Pretrain safety advances (data cleaning,
// aligned synthetic data) act on the foundational floor & base goal-mis; the
// player applies the ones they've researched at commission time
// (legal_moves.applicable_pretrain_safety → commission_run.applied_safety).
function pretrainSafetyHTML(){
  const applicable = OBS.legal_moves.applicable_pretrain_safety || [];
  if(!applicable.length)
    return `<div class="dim" style="font-size:11px;margin-top:4px">${t("pretrain.safety.empty")}</div>`;

  const applied = pending.commission_run?.applied_safety || [];
  const rows = applicable.map(advance => {
    const isApplied = applied.includes(advance.advance_id);
    return `<div class="row"><label title="${esc(advance.risk_blurb || "")}">
      <input type="checkbox" id="prts-${esc(advance.advance_id)}" ${isApplied ? "checked" : ""}>
      ${esc(advance.name)}</label></div>`;
  }).join("");
  return `<div class="dim" style="font-size:11px;margin-top:6px">${t("pretrain.safety.apply")}</div>${rows}`;
}

export function queueRun(){
  const applicable = OBS.legal_moves.applicable_pretrain_safety || [];
  // read each pretrain safety-advance checkbox built by pretrainSafetyHTML (id "prts-<id>")
  const chosenSafety = applicable
    .filter(advance => $("prts-" + advance.advance_id)?.checked)
    .map(advance => advance.advance_id);
  const previousRun = pending.commission_run;   // restore this if the new run overruns cash
  pending.commission_run = {
    compute: parseFloat($("run-compute").value || 0),
    applied_safety: chosenSafety,
  };
  const fit = queueFits();
  if(!fit.ok){
    pending.commission_run = previousRun;       // revert: the run's compute didn't fit cash
    $("errors").textContent = fit.reason;
    renderPretrain();                           // re-sync the run controls to the reverted state
    return;
  }
  $("errors").textContent = "";
  render();
}

export function clearRun(){
  pending.commission_run = null;
  render();
}

export function renderReleased(){
  const el = $("released");
  if(!OBS.own_models.length){
    el.innerHTML = `<span class="dim">${t("released.empty")}</span>`;
    return;
  }
  el.innerHTML = `<table><tr><th>${t("released.col.model")}</th><th>${t("released.col.general")}</th><th>${t("released.col.jbPublic")}</th><th></th></tr>` +
    OBS.own_models.map(model => `<tr><td>${model.id}</td>
      <td>${model.measured_capability.general}</td>
      <td>${model.jailbreak_techniques_public?`<span class="bad">${t("released.yes")}</span>`:t("released.no")}</td>
      <td>${model.leaked?`<span class="bad">${t("released.leaked")}</span>`:''}</td></tr>`).join("") +
    `</table>`;
}

// ── Benchmarks panel (§7 public scoreboard) ──────────────────────────────────
// Formats one score by benchmark kind: rings are percentages, elo is a rounded
// rating, horizon is a METR-style time printed in human units.
function fmtBenchScore(kind, value){
  if(kind === "ring") return value.toFixed(0) + "%";
  if(kind === "elo")  return Math.round(value).toLocaleString();
  if(kind === "horizon"){            // value is in minutes (unbounded log scale)
    const HOUR = 60, DAY = 1440, MONTH = 1440 * 30, YEAR = 1440 * 365;
    if(value < HOUR)  return t("bench.horizon.min",   {value: value.toFixed(0)});
    if(value < DAY)   return t("bench.horizon.hour",  {value: (value/HOUR).toFixed(1)});
    if(value < MONTH) return t("bench.horizon.day",   {value: (value/DAY).toFixed(1)});
    if(value < YEAR)  return t("bench.horizon.month", {value: (value/MONTH).toFixed(1)});
    return t("bench.horizon.year", {value: (value/YEAR).toFixed(1)});
  }
  return value.toFixed(1);
}

// A small SVG donut gauge for the player's ring score (0–100%).
function ringSVG(percent){
  const radius = 26, circumference = 2 * Math.PI * radius;
  const filled = circumference * Math.max(0, Math.min(100, percent)) / 100;
  // Saturated benchmarks (near 100%) lose discriminating power — fade toward dim.
  const color = percent >= 95 ? "var(--dim)" : "var(--acc)";
  return `<svg class="ring" width="64" height="64" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="${radius}" fill="none" stroke="var(--line)" stroke-width="7"/>
    <circle cx="32" cy="32" r="${radius}" fill="none" stroke="${color}" stroke-width="7"
      stroke-linecap="round" transform="rotate(-90 32 32)"
      stroke-dasharray="${filled.toFixed(1)} ${circumference.toFixed(1)}"/>
    <text x="32" y="36" text-anchor="middle">${percent.toFixed(0)}%</text></svg>`;
}

export function renderBenchmarks(){
  const el = $("benchmarks");
  const cards = OBS.benchmarks || [];
  if(!cards.length){
    el.innerHTML = `<span class="dim">${t("benchmarks.empty")}</span>`;
    return;
  }

  el.innerHTML = cards.map(card => {
    // All labs that have a frontier release scored on this benchmark, plus your own
    // model-in-training, sorted best-first so the race ordering reads at a glance.
    const rows = Object.entries(card.scores)
      .map(([labId, value]) => ({labId, value, training:false}));
    if(card.in_training !== undefined)
      rows.push({labId: OBS.lab_id, value:card.in_training, training:true});
    rows.sort((a, b) => b.value - a.value);

    const playerReleased = card.scores[OBS.lab_id];
    const gauge = card.kind === "ring" && playerReleased !== undefined
      ? ringSVG(playerReleased)
      : `<div class="headline">${playerReleased !== undefined
          ? fmtBenchScore(card.kind, playerReleased) : "—"}</div>`;

    const scoreList = rows.map(row => {
      const isMe = row.labId === OBS.lab_id;
      // Lab name is player-authored/untrusted — escape before innerHTML.
      const labName = esc(NAMES[row.labId] || row.labId);
      const name = labName + (row.training ? t("caps.inTraining") : "");
      return `<div class="row${isMe ? " me" : ""}" style="margin:1px 0">
        <i class="lg" style="background:${colorFor(row.labId)}"></i>
        ${isMe ? "<b>"+name+"</b>" : name}
        <span style="flex:1"></span>
        <span>${fmtBenchScore(card.kind, row.value)}</span></div>`;
    }).join("");

    return `<div class="bench">
      <div class="head">
        <span class="name">${card.name}</span>
        <span class="tag">${card.domain} · ${card.kind}</span>
      </div>
      <div class="blurb">${card.blurb}</div>
      <div class="gauge">${gauge}
        <div class="scores" style="flex:1">${scoreList}</div></div>
    </div>`;
  }).join("");
}

// ── Truth panel (DEBUG god-view — bypasses the firewall) ─────────────────────
const TRUTH_AXES = ["eval_awareness","deception","goal_misalignment",
                    "self_preservation","jailbreak_sensitivity"];

// Per-turn true/measured trajectory for one model, walking every logged turn the
// model appears in (matched by lab + model id; absent on turns before it existed).
function truthTrajectory(labId, modelId){
  const rows = [];
  TRUTH.turns.forEach(t => {
    const lab = t.labs.find(l => l.id === labId);
    const model = lab && lab.models.find(m => m.id === modelId);
    if(!model) return;
    rows.push({
      turn: t.turn,
      true_gm: model.true_alignment.goal_misalignment,
      meas_gm: model.measured_alignment.goal_misalignment,
      true_dec: model.true_alignment.deception,
      meas_dec: model.measured_alignment.deception,
      true_ea: model.true_alignment.eval_awareness,
      conceal: model.concealment,
      true_gen: model.true_capability.general,
    });
  });
  return rows;
}

// One card per model: true (red) beside measured for every alignment axis +
// capability, with an expandable per-turn trajectory.
function truthModelCard(labId, model){
  const f = v => v.toFixed(3);
  const axisRows = TRUTH_AXES.map(axis => `<tr>
    <td>${axis.replace(/_/g," ")}</td>
    <td class="bad">${f(model.true_alignment[axis])}</td>
    <td class="dim">${f(model.measured_alignment[axis])}</td></tr>`).join("");

  const capRows = ["general","coding_rnd"].map(dim => `<tr>
    <td>cap · ${dim.replace("_rnd"," r&d")}</td>
    <td class="bad">${model.true_capability[dim].toFixed(2)}</td>
    <td class="dim">${model.measured_capability[dim].toFixed(2)}</td></tr>`).join("");

  const traj = truthTrajectory(labId, model.id);
  const trajTable = `<table>
    <tr><th>t</th><th>true gm</th><th>meas gm</th><th>true dec</th><th>meas dec</th>
      <th>true ea</th><th>conceal</th><th>true gen</th></tr>
    ${traj.map(r => `<tr><td>${r.turn}</td>
      <td class="bad">${r.true_gm.toFixed(3)}</td><td class="dim">${r.meas_gm.toFixed(3)}</td>
      <td class="bad">${r.true_dec.toFixed(3)}</td><td class="dim">${r.meas_dec.toFixed(3)}</td>
      <td class="bad">${r.true_ea.toFixed(3)}</td><td>${r.conceal.toFixed(3)}</td>
      <td>${r.true_gen.toFixed(2)}</td></tr>`).join("")}</table>`;

  // Lab name is player-authored/untrusted — escape before innerHTML (even on the
  // debug Truth tab; the §2 firewall discipline applies here in full).
  return `<div class="panel" style="margin:0">
    <div class="row"><i class="lg" style="background:${colorFor(labId)}"></i>
      <b>${esc(NAMES[labId]||labId)}</b> · <span>${esc(model.id)}</span>
      ${model.released?`<span class="tag">${t("truth.released")}</span>`:`<span class="tag">${t("truth.inTraining")}</span>`}
      ${model.leaked?`<span class="tag bad">${t("truth.leaked")}</span>`:''}</div>
    <table><tr><th>${t("truth.col.axis")}</th><th>${t("truth.col.true")}</th><th>${t("truth.col.measured")}</th></tr>
      ${axisRows}${capRows}
      <tr><td>${t("truth.concealment")}</td><td class="bad" colspan="2">${f(model.concealment)}</td></tr>
      <tr><td>${t("truth.foundationalFloor")}</td><td colspan="2">${f(model.foundational_floor)}</td></tr>
    </table>
    <details style="margin-top:4px"><summary>${t("truth.trajectory.summary", {count: traj.length})}</summary>
      ${trajTable}</details></div>`;
}

export function renderTruth(){
  const el = $("truth");
  if(!TRUTH.turns.length){
    el.innerHTML = `<span class="dim">${t("truth.empty")}</span>`;
    return;
  }
  // Latest snapshot, player's lab first then rivals.
  const last = TRUTH.turns[TRUTH.turns.length-1];
  const labs = [...last.labs].sort((a,b) =>
    (a.id===OBS.lab_id?-1:0) - (b.id===OBS.lab_id?-1:0));

  const cards = labs.flatMap(lab =>
    lab.models.map(model => truthModelCard(lab.id, model)));

  el.innerHTML = cards.length
    ? `<div class="cols2">${cards.join("")}</div>`
    : `<span class="dim">${t("truth.noModels")}</span>`;
}

// ── Research panel ────────────────────────────────────────────────────────────
// The unified research-item state-machine cards live in research.js; the panels
// here just feed it the right list and grouping. Capability/safety/completed each
// get their own panel so the split reads at a glance.

// The "kind" tag shown on an available capability card (its training phase).
function capabilityKindTag(item){
  return item.phase;
}

// The "kind" tag shown on an available safety card. Safety items are a MIX of
// measurement/intervention PROJECTS and the §8b safety ADVANCES; both arrive in
// safety_projects_available + safety_advances_available, so the tag reflects which.
function safetyKindTag(item){
  if(item.intervention)
    return `intervene → ${(item.target_axis || "").replace(/_/g, " ")}`;
  if(item.phase)            // a safety ADVANCE carries a training phase
    return `advance · ${item.phase}`;
  return item.evidence || "safety";
}

// Updates the inline "→ wb X · ~Yy" preview next to a card's assist slider.
export function previewAssist(pid, base, years){
  const assistLevel = parseFloat($("as-"+pid)?.value || 0) || 0;
  const previewEl = $("pv-"+pid); if(!previewEl) return;
  if(assistLevel <= 0){ previewEl.textContent = ""; return; }
  previewEl.textContent =
    `→ wb ${effFraction(base, assistLevel).toFixed(2)} · ~${effYears(years, assistLevel).toFixed(2)}y`;
}

// Handles the Delegate checkbox: when checked, fix the assist slider at 1.0 and
// disable it (delegate = full assist + extra contamination); when unchecked, restore
// the slider to 0 and re-enable it. Either way, refresh the preview.
export function toggleDelegate(pid, base, years){
  const checkbox = $("dlg-"+pid);
  const slider = $("as-"+pid);
  if(!checkbox || !slider) return;
  if(checkbox.checked){
    slider.value = "1";
    slider.disabled = true;
  } else {
    slider.value = "0";
    slider.disabled = false;
  }
  previewAssist(pid, base, years);
}

// A project queued THIS turn already lives in pending.start_projects (and shows in
// the bottom queue bar with its own ✕). The server only hides items it has already
// started, not ones queued client-side, so we drop the queued ones here — applied
// uniformly to every available list (capability, safety evals, safety advances) so
// a project can't be selected twice. (issue 6)
function excludeQueued(items){
  const queuedProjectIds = pending.start_projects.map(queued => queued.project_id);
  return items.filter(item => !queuedProjectIds.includes(item.project_id));
}

export function renderProjects(){
  const lm = OBS.legal_moves;
  const assistParams = lm.assist;
  // No model at all (released or in training) ⇒ no assistant ⇒ the per-card assist
  // control is suppressed (and the backend treats any assist as 0). These two flags
  // drive every list.
  const assistAvailable = assistParams.available;
  const delegateUnlocked = assistParams.delegate_unlocked;

  const hint = !assistAvailable
    ? `<div class="dim" style="margin-bottom:6px">${t("research.assistHint.noModel")}</div>`
    : assistParams.potency < 0.05
    ? `<div class="dim" style="margin-bottom:6px">${t("research.assistHint.weak")}</div>`
    : `<div class="dim" style="margin-bottom:6px">${t("research.assistHint.potent", {
        budget: assistParams.potency.toFixed(2),
        speed: assistParams.speed_potency.toFixed(2)})}</div>`;

  $("cap-projects").innerHTML = hint;
  // append the capability cards beneath the assist hint
  renderAvailableInto("cap-projects", excludeQueued(lm.capability_projects_available),
    capabilityKindTag, t("research.capability.empty"), /*append=*/true, assistAvailable, delegateUnlocked);

  // Safety projects are a MIX: measurement EVALUATIONS (return findings) and
  // INTERVENTIONS (fine-tuning-style edits that remediate a target axis via the
  // next post-train round). They live in different tabs: evaluations are "research"
  // (Research tab); interventions shape the model, so they belong in the Lab with
  // the training controls. Split the one backend list by its existing `intervention`
  // flag rather than changing the observation.
  const safetyProjects = excludeQueued(lm.safety_projects_available);
  const safetyEvaluations = safetyProjects.filter(project => !project.intervention);
  const safetyInterventions = safetyProjects.filter(project => project.intervention);

  // Research tab: evaluations, then the §8b pre/post-training ADVANCES to unlock.
  renderAvailableItems("safety-projects", safetyEvaluations,
    safetyKindTag, t("research.safety.empty"), assistAvailable, delegateUnlocked);
  renderAvailableItems("safety-advances", excludeQueued(lm.safety_advances_available),
    safetyKindTag, t("research.safetyAdvances.empty"), assistAvailable, delegateUnlocked);

  // Lab tab: the interventions, with a one-line note that they shape the model in
  // training and bite at the next post-train round.
  const interventionsHint =
    `<div class="dim" style="margin-bottom:6px">${t("lab.interventions.hint")}</div>`;
  $("safety-interventions").innerHTML = interventionsHint;
  renderAvailableInto("safety-interventions", safetyInterventions,
    safetyKindTag, t("lab.interventions.empty"), /*append=*/true, assistAvailable, delegateUnlocked);

  renderCompletedAdvances("completed-advances", OBS.researched_advances,
    t("research.completed.empty"));
}

// Small adapter so the capability panel can keep its assist hint above the cards.
function renderAvailableInto(containerId, items, kindOf, emptyText, append, assistAvailable, delegateUnlocked){
  const container = $(containerId);
  if(!container) return;
  const hintHTML = append ? container.innerHTML : "";
  renderAvailableItems(containerId, items, kindOf, emptyText, assistAvailable, delegateUnlocked);
  if(append) container.innerHTML = hintHTML + container.innerHTML;
}

// Queue a research item. Returns {ok, reason}: on success the item is queued and a
// full re-render runs; on failure (it would overrun work-budget or cash) NOTHING is
// queued and `reason` says which limit it breached — the modal caller surfaces it
// inline, and it's also written to the queue error line for the non-modal path.
export function queueProject(pid){
  const isDelegating = $("dlg-"+pid)?.checked;
  const assistValue = parseFloat($("as-"+pid)?.value || 0);
  const spec = isDelegating
    ? {project_id: pid, delegate: true}
    : {project_id: pid, ai_assist: isNaN(assistValue) ? 0 : assistValue};
  pending.start_projects.push(spec);
  const fit = queueFits();
  if(!fit.ok){
    pending.start_projects.pop();   // revert: this item didn't fit the budget/cash
    $("errors").textContent = fit.reason;
    return fit;
  }
  $("errors").textContent = "";
  render();
  return fit;
}

export function unqueueProject(pid){
  pending.start_projects = pending.start_projects.filter(s => s.project_id !== pid);
  render();
}

export function renderInProgress(){
  renderInProgressItems("inprogress", OBS.in_progress, t("research.inProgress.empty"));
}

// ── Intel panel ───────────────────────────────────────────────────────────────
export function renderWorry(){
  const wb = OBS.worry_bar;
  $("wb-level").style.width = (wb.level*100)+"%";
  $("wb-conf").style.width  = (wb.confidence*100)+"%";
  $("wb-level-n").textContent = wb.level.toFixed(2);
  $("wb-conf-n").textContent  = wb.confidence.toFixed(2);

  // The backend summary is "concern-descriptor, evidence-qualifier" (one comma;
  // see findings.synthesize_worry_bar). Split it into two labeled status rows so
  // "low concern / shallow evidence" vs "low concern / corroborated" read as
  // DISTINCT structured states (design §7c), not one dim sentence.
  const summaryParts = splitWorrySummary(wb.summary);
  $("wb-summary").innerHTML =
    worryStatusRow(t("worry.concern.label"), summaryParts.concern) +
    worryStatusRow(t("worry.evidence.label"), summaryParts.evidence);
}

// Split "<concern>, <evidence>" at the FIRST comma. A summary with no comma (the
// "no recent safety evidence collected" empty state) becomes the concern line
// with an empty evidence line, so the structure never breaks.
function splitWorrySummary(summary){
  const text = summary || "";
  const commaIndex = text.indexOf(",");
  if(commaIndex === -1) return {concern: text, evidence: ""};
  const concern = text.slice(0, commaIndex).trim();
  const evidence = text.slice(commaIndex + 1).trim();
  return {concern, evidence};
}

// One labeled status row of the worry-bar definition list. The value is authored
// backend copy (no untrusted player data), but esc() it to stay uniform with the
// firewall discipline (§2 — never raw untrusted-shaped data into innerHTML).
function worryStatusRow(label, value){
  if(!value) return "";
  return `<div class="kv"><span class="kv-label">${label}</span>
    <span class="kv-value">${esc(value)}</span></div>`;
}

// ── Alignment-evidence dossier (Intel tab) ──────────────────────────────────
// Compiles OBS.alignment_evidence — every safety-eval finding and external
// incident result, grouped by the model it was collected on (newest model first,
// newest finding first within a model). The worry bar above is the SYNTHESIS;
// this is the raw evidence it was synthesized from, so the player can audit it.
export function renderAlignmentEvidence(){
  const dossier = OBS.alignment_evidence || {};
  const models = dossier.models || [];
  const el = $("alignment-evidence");
  if(!models.length){
    el.innerHTML = `<span class="dim">${t("intel.evidence.empty")}</span>`;
    return;
  }
  el.innerHTML = models.map(evidenceModelHTML).join("");
}

// One model group: a header (model id + lifecycle status) over its evidence items.
function evidenceModelHTML(group){
  // model_id is engine-generated, but esc() it anyway to keep the firewall habit.
  const modelId = esc(group.model_id);
  const status = t("intel.evidence.status." + group.status);
  const items = group.items.map(evidenceItemHTML).join("");
  return `<div class="ev-group">
    <div class="ev-model-head">
      <span class="ev-model-id">${modelId}</span>
      <span class="tag">${status}</span>
    </div>
    ${items}
  </div>`;
}

// One finding as a compact card. A null result is de-emphasized (ambiguous — it
// rules little out, design §7); an external incident is flagged in red.
function evidenceItemHTML(item){
  const axisLabel = (item.axis || "general").replace(/_/g, " ");
  const isExternal = item.source_kind === "external";
  const isNull = item.evidence === "null";

  const sourceBadge = isExternal
    ? `<span class="tag bad">${t("intel.evidence.source.external")}</span>`
    : `<span class="tag">${esc(evidenceProjectLabel(item.project_id))}</span>`;
  const kindBadge = `<span class="tag">${evidenceKindLabel(item.evidence)}</span>`;
  const mechBadge = item.mechanistic
    ? `<span class="tag good">${t("intel.evidence.mech")}</span>` : "";
  const concernBadge = `<span class="tag ${concernClass(item.concern)}">${
    t("intel.evidence.concern", {value: item.concern.toFixed(2)})}</span>`;

  const itemClasses = "ev-item" + (isNull ? " ev-null" : "") +
    (isExternal ? " ev-external" : "");
  return `<div class="${itemClasses}">
    <div class="ev-item-head">
      <span class="ev-axis">${axisLabel}</span>
      <span class="ev-turn dim">t${item.turn}</span>
    </div>
    <div class="ev-badges">${sourceBadge}${kindBadge}${mechBadge}${concernBadge}</div>
    <div class="ev-text">${esc(item.text)}</div>
  </div>`;
}

// Concern colour: high concern reads red, moderate amber, low neutral.
function concernClass(concern){
  if(concern >= 0.5) return "bad";
  if(concern >= 0.25) return "warn";
  return "";
}

// A human label for a finding's evidence type (point/bound/existence/null/
// intervention). Falls back to the prettified raw value so a future evidence type
// renders legibly instead of showing the missing string key.
function evidenceKindLabel(evidence){
  const key = "intel.evidence.kind." + evidence;
  const label = t(key);
  if(label !== key) return label;
  return (evidence || "").replace(/_/g, " ");
}

// A human label for the safety project that produced a finding: a curated name
// where strings has one, else the raw id prettified (underscores → spaces).
function evidenceProjectLabel(projectId){
  const key = "intel.evidence.project." + projectId;
  const label = t(key);
  if(label !== key) return label;        // curated name exists in strings
  return projectId.replace(/_/g, " ");   // fallback: prettify the raw id
}

export function renderRivals(){
  $("rivals").innerHTML = OBS.rival_public.map(rivalCardHTML).join("");
}

// One rival as a small card (imitates the .bench card): a header (color swatch +
// ticker + name) over an aligned field grid (market cap, # released models,
// frontier-capability estimate) so the public race reads column-by-column.
function rivalCardHTML(rival){
  const color = colorFor(rival.lab_id);
  // rival.name / rival.ticker are public lab identity but still strings that
  // (for the player's own lab) can be user-authored — escape before innerHTML.
  const ticker = esc(rival.ticker || rival.lab_id);
  const name = esc(rival.name);

  const marketCap = fmt$(rival.market_cap);
  const releasedModels = t("rivals.releases.unit", {count: rival.released_models});
  // frontier_capability_estimate is absent until the rival has released a model.
  const frontier = rival.frontier_capability_estimate !== undefined
    ? String(rival.frontier_capability_estimate)
    : t("rivals.frontier.unknown");

  return `<div class="rival-card">
    <div class="rc-head">
      <i class="lg" style="background:${color}"></i>
      <span class="rc-ticker">${ticker}</span>
      <span class="rc-name">${name}</span>
    </div>
    <div class="rc-fields">
      ${rivalFieldHTML(t("rivals.col.cap"), marketCap)}
      ${rivalFieldHTML(t("rivals.col.releases"), releasedModels)}
      ${rivalFieldHTML(t("rivals.col.frontier"), frontier)}
    </div>
    ${disclosedModelsHTML(rival)}
  </div>`;
}

// When the disclosure mandate is active, the backend attaches `disclosed_models`:
// each released model's MEASURED safety numbers, published by the rival itself.
// These are measured stats (an eval-aware model games them), so the section is
// firewall-safe — nothing true crosses. Absent entirely when disclosure is off.
function disclosedModelsHTML(rival){
  // The lab is defecting on the mandate — it publishes nothing and eats a fine.
  if(rival.disclosure_withheld){
    return `<div class="rc-disclosure-withheld">${t("rivals.disclosure.withheld")}</div>`;
  }
  if(!rival.disclosed_models || rival.disclosed_models.length === 0) return "";

  const modelRows = rival.disclosed_models.map(model => {
    const alignment = model.measured_alignment;
    return `<div class="rc-disclosed-model">
      <div class="row"><b>${esc(model.id)}</b>
        <span class="dim"> · ${t("training.measuredGeneral")} ${model.measured_capability.general}
        · ${t("training.coding")} ${model.measured_capability.coding_rnd}</span></div>
      <div class="row dim">${t("training.dangerousEval", {value: model.dangerous_capability_eval})}</div>
      <div class="row dim">${t("training.measuredAlignment", {
        goalmis: alignment.goal_misalignment, decep: alignment.deception,
        evalaware: alignment.eval_awareness, selfpres: alignment.self_preservation,
        jailbreak: alignment.jailbreak_sensitivity})}</div>
    </div>`;
  }).join("");

  return `<details class="rc-disclosure">
    <summary>${t("rivals.disclosure.heading")}</summary>
    ${modelRows}
  </details>`;
}

// One labeled field cell inside a rival card. Values here are numeric/formatted
// (no untrusted player data), so they go in raw; the player-authored name/ticker
// are escaped at the call site in rivalCardHTML.
function rivalFieldHTML(label, value){
  return `<div class="rc-field">
    <span class="rc-flabel">${label}</span>
    <span class="rc-fvalue">${value}</span>
  </div>`;
}

export function renderFeed(){
  const cssClass = {finding:"good", tip:"warn", event:"bad", news:"", intervention:"good"};
  // Each entry is a box: a TYPE label tag on its own line, then the message body.
  // esc() the label/text — feed copy is backend-authored but can interpolate the
  // player-entered lab name, which must never reach innerHTML unescaped.
  $("log").innerHTML = FEED.map(feedItem =>
    `<div class="feed-item feed-${feedItem.cls}">
       <div class="feed-head">
         <span class="feed-label ${cssClass[feedItem.cls]||''}">${esc(feedItem.label||feedItem.cls)}</span>
         <span class="feed-turn dim">t${feedItem.turn}</span>
       </div>
       <div class="feed-text">${esc(feedItem.text)}</div>
     </div>`).join("");
}

// ── Governance panel ──────────────────────────────────────────────────────────
// Each policy item is a 2-column grid: LEFT = policy identity + a short NEUTRAL
// descriptor + the compact lobby/litigation/defect controls; RIGHT = the public
// rival-spends box. The verbose `effect` mechanism text is NOT shown inline — it
// moved to a click-to-open details modal (openPolicyModal) so the board reads at a
// glance and stops over-revealing on every row (UI_ISSUES issues 4/5/8).
export function renderGovernance(){
  const policies = OBS.legal_moves.policies || [];
  $("governance").innerHTML = policies.map(policyItemHTML).join("");
}

// One full policy row: left main column + right rival-spends box.
function policyItemHTML(policy){
  const mainColumn = policyHeadHTML(policy) +
    policyCategoryHTML(policy) +
    policyControlsHTML(policy);
  const rivalBox = rivalSpendsHTML(policy.rival_contributions || []);
  return `<div class="policy">
    <div class="policy-main">${mainColumn}</div>
    ${rivalBox}
  </div>`;
}

// Header: clickable name (opens details) on the left, stage tag(s) flush RIGHT.
function policyHeadHTML(policy){
  const pid = policy.policy_id;
  let stageCell = `<span class="tag stage-${policy.stage}">${policy.stage}</span>`;
  if(policy.stage === "active")
    stageCell += `<span class="tag ${ENF_COLOR[policy.enforcement]||'dim'}">${t("gov.enforce", {level: policy.enforcement})}</span>`;
  // policy.name is authored backend content, but esc() to stay uniform with the
  // rest of the firewall discipline (no untrusted data reaches innerHTML raw).
  return `<div class="policy-head">
    <span class="policy-name" onclick="openPolicyModal('${esc(pid)}')">${esc(policy.name)}</span>
    <span class="policy-stage">${stageCell}</span></div>`;
}

// Short NEUTRAL category/stage descriptor + a "details ▸" link to the full modal.
// This deliberately does NOT carry policy.effect (that lives in the modal now).
function policyCategoryHTML(policy){
  const pid = policy.policy_id;
  let categoryKey;
  if(policy.stage === "active") categoryKey = "gov.category.active";
  else if(policy.stage === "dormant") categoryKey = "gov.category.dormant";
  else categoryKey = "gov.category.preActive";
  return `<div class="policy-category">${t(categoryKey)}
    <span class="policy-details-link" onclick="openPolicyModal('${esc(pid)}')">${t("gov.detailsLink")}</span></div>`;
}

// Compact controls area: lobby (pre-active), litigation (active), defect (active).
// One tight inline group now the explanatory prose has moved to the modal.
function policyControlsHTML(policy){
  return `<div class="policy-controls">
    ${lobbyControlHTML(policy)}
    ${litigationControlHTML(policy)}
    ${defectControlHTML(policy)}
  </div>`;
}

// LOBBY — any pre-active policy (early money on a dormant one is efficient but a bet).
function lobbyControlHTML(policy){
  if(!policy.lobbyable) return "";
  const pid = policy.policy_id;
  const currentLobby = pending.lobby[pid] || {stance:"abstain", spend:0};
  const stanceOptions = ["abstain","for","against"].map(stance =>
    `<option ${stance===currentLobby.stance?"selected":""}>${stance}</option>`).join("");
  return `<span>${t("gov.lobby.label")}</span>
    <select onchange="setLobbyStance('${pid}',this.value)">${stanceOptions}</select>
    $<input type="number" min="0" step="25" value="${currentLobby.spend||0}"
      oninput="setLobbySpend('${pid}',this.value)">M`;
}

// LITIGATION — active policies (post-passage battleground). The verbose court
// status moved to the details modal; the inline control is just side/tier/spend.
function litigationControlHTML(policy){
  if(!(policy.litigable && policy.litigation)) return "";
  const pid = policy.policy_id;
  const currentLit = pending.litigation[pid] || {side:"challenge", tier:"amicus", spend:0};
  const sideOptions = ["challenge","defense"].map(side =>
    `<option ${side===currentLit.side?"selected":""}>${side}</option>`).join("");
  const tierOptions = ["amicus","join","fund"].map(tier =>
    `<option ${tier===currentLit.tier?"selected":""}>${tier}</option>`).join("");
  return `<span>${t("gov.lit.label")}</span>
    <select onchange="setLitField('${pid}','side',this.value)">${sideOptions}</select>
    <select onchange="setLitField('${pid}','tier',this.value)">${tierOptions}</select>
    $<input type="number" min="0" step="50" value="${currentLit.spend||0}"
      oninput="setLitField('${pid}','spend',this.value)">M
    <button onclick="clearLit('${pid}')">✕</button>`;
}

// DEFECT — active defectable policy, with a consequence preview (warn before commit).
function defectControlHTML(policy){
  if(!policy.defect_preview) return "";
  const pid = policy.policy_id;
  const defectPreview = policy.defect_preview;
  const isDefecting = !!pending.defect[pid];
  // An always-caught policy (disclosure) has no catch probability — it is certain
  // and fined every turn — so it gets its own preview line.
  const previewText = defectPreview.always_caught
    ? t("gov.defect.preview_certain", {
        fine: fmt$(defectPreview.penalty_per_turn),
        approval: defectPreview.approval_hit_if_caught})
    : t("gov.defect.preview", {
        catch: (defectPreview.catch_prob_per_year*100).toFixed(0),
        fine: fmt$(defectPreview.penalty_if_caught),
        approval: defectPreview.approval_hit_if_caught});
  return `<label class="${isDefecting?'bad':''}"><input type="checkbox" ${isDefecting?"checked":""}
      onchange="toggleDefect('${pid}',this.checked)"> ${t("gov.defect.label")}</label>
    <span class="warn">${previewText}</span>`;
}

// The right-side rival-spends box: a structured list of every OTHER lab that has
// spent on this policy (PUBLIC regulatory info, design §10c). Ticker is player-
// derivable, so esc() it. Empty → a quiet "no rival spend yet".
function rivalSpendsHTML(rivalContributions){
  const headHTML = `<div class="rs-head">${t("gov.rivalSpends.head")}</div>`;
  if(!rivalContributions.length)
    return `<div class="rival-spends">${headHTML}
      <div class="rs-empty">${t("gov.rivalSpends.empty")}</div></div>`;

  const rows = rivalContributions.map(contribution => {
    // Total declared spend on this policy (lobby + litigation), both cumulative $M.
    const totalSpend = (contribution.lobby_spend || 0) + (contribution.lit_spend || 0);
    return `<div class="rs-row">
      <span class="rs-ticker">${esc(contribution.ticker || contribution.lab_id)}</span>
      <span class="rs-stance">${esc(contribution.stance)}</span>
      <span class="rs-spend">${fmt$(totalSpend)}</span></div>`;
  }).join("");
  return `<div class="rival-spends">${headHTML}${rows}</div>`;
}

// Details modal for one policy — reuses the warnings.js #itemmodal pattern (same
// #itemmodal / #modal-body card, closed by closeItemModal). Shows the full
// `effect` mechanism text the inline item deliberately hides, plus the key PUBLIC
// state (stage, enforcement, litigation summary). All shown values are public
// regulatory info or authored backend copy; esc() everything for firewall hygiene.
export function openPolicyModal(policyId){
  const policies = OBS.legal_moves.policies || [];
  const policy = policies.find(p => p.policy_id === policyId);
  if(!policy) return;   // nothing to show — never block the player

  $("modal-body").innerHTML = `
    <h3 style="text-transform:none;color:var(--txt);font-size:15px">${esc(policy.name)}</h3>
    <div class="dim" style="margin-bottom:8px">
      <b>${t("gov.modal.stageHeading")}:</b> ${esc(policy.stage)}
      ${policyModalEnforcementHTML(policy)}</div>
    ${policyModalLitigationHTML(policy)}
    <div style="margin:10px 0 4px"><b>${t("gov.modal.effectHeading")}</b></div>
    <div style="margin-bottom:10px">${esc(policy.effect || "")}</div>
    <div class="row" style="margin-top:14px">
      <button onclick="closeItemModal()">${t("gov.modal.close")}</button>
    </div>`;
  $("itemmodal").classList.add("show");
}

// Enforcement clause inside the policy modal's stage line (active policies only).
function policyModalEnforcementHTML(policy){
  if(policy.stage !== "active" || policy.enforcement === undefined) return "";
  return ` · <b>${t("gov.modal.enforceHeading")}:</b> ${esc(policy.enforcement)}`;
}

// Litigation summary block inside the policy modal (active policies only) — the
// verbose court status the inline item no longer shows.
function policyModalLitigationHTML(policy){
  if(!(policy.litigable && policy.litigation)) return "";
  const litigation = policy.litigation;
  const statusText = t("gov.lit.status", {
    court: litigation.court_level,
    margin: litigation.last_margin===null ? '—' : litigation.last_margin,
    constitutionality: litigation.constitutionality,
    standing: litigation.has_standing ? t("gov.lit.standingYes") : t("gov.lit.standingNo")});
  return `<div style="margin:4px 0 0"><b>${t("gov.modal.litHeading")}:</b>
    <span class="dim">${statusText}</span></div>`;
}

// Governance field setters — keep lobby/litigation state in pending.
export function setLobbyStance(pid, stance){
  const entry = pending.lobby[pid] || {stance:"abstain", spend:0};
  entry.stance = stance;
  pending.lobby[pid] = entry;
  renderQueue();
}
export function setLobbySpend(pid, rawValue){
  const entry = pending.lobby[pid] || {stance:"abstain", spend:0};
  entry.spend = parseFloat(rawValue) || 0;
  pending.lobby[pid] = entry;
  renderQueue();
}
export function setLitField(pid, field, rawValue){
  const entry = pending.litigation[pid] || {side:"challenge", tier:"amicus", spend:0};
  entry[field] = (field === "spend") ? (parseFloat(rawValue) || 0) : rawValue;
  pending.litigation[pid] = entry;
  renderQueue();
}
export function clearLit(pid){ delete pending.litigation[pid]; renderGovernance(); renderQueue(); }
export function toggleDefect(pid, on){
  if(on) pending.defect[pid] = true; else delete pending.defect[pid];
  renderGovernance(); renderQueue();
}

// ── Turn queue display ────────────────────────────────────────────────────────
export function renderQueue(){
  const items = [];
  const allProjects = queueableProjects();

  // Queued project starts with optional assist annotation.
  pending.start_projects.forEach(queued => {
    const project = allProjects.find(x => x.project_id === queued.project_id);
    let suffix = "";
    if(queued.delegate && project){
      suffix = ` (delegate → wb ${effFraction(project.budget_fraction,1.0).toFixed(2)}, ~${effYears(project.duration_years,1.0).toFixed(2)}y)`;
    } else if(queued.delegate){
      suffix = ` (delegate)`;
    } else if(queued.ai_assist && project){
      suffix = ` (assist ${queued.ai_assist} → wb ${effFraction(project.budget_fraction,queued.ai_assist).toFixed(2)}, ~${effYears(project.duration_years,queued.ai_assist).toFixed(2)}y)`;
    } else if(queued.ai_assist){
      suffix = ` (assist ${queued.ai_assist})`;
    }
    items.push(`${queued.project_id}${suffix}|p:${queued.project_id}`);
  });

  if(pending.post_train){
    const applied = pending.post_train.applied_safety || [];
    const label = applied.length
      ? t("queue.postTrain.withSafety", {count: applied.length})
      : t("queue.postTrain.bare");
    items.push(`${label}|pt`);
  }
  if(pending.commission_run){
    const applied = pending.commission_run.applied_safety || [];
    const safetyNote = applied.length ? ` +${applied.length} safety` : "";
    const pretrainLabel = t("queue.pretrain", {
      compute: fmt$(pending.commission_run.compute),
      safetyNote: safetyNote,
    });
    items.push(`${pretrainLabel}|run`);
  }
  if(pending.release) items.push(`${t("queue.release")}|rel`);

  Object.entries(pending.lobby)
    .filter(([, lobbyEntry]) => lobbyEntry && lobbyEntry.stance !== "abstain")
    .forEach(([policyId, lobbyEntry]) => {
      const spendFragment = lobbyEntry.spend ? ` $${lobbyEntry.spend}M` : "";
      const lobbyLabel = t("queue.lobby", {
        stance: lobbyEntry.stance,
        policy: policyId,
        spend: spendFragment,
      });
      items.push(`${lobbyLabel}|l:${policyId}`);
    });

  Object.entries(pending.litigation).forEach(([policyId, litEntry]) => {
    const spendFragment = litEntry.spend ? ` $${litEntry.spend}M` : "";
    const litigateLabel = t("queue.litigate", {
      side: litEntry.side,
      policy: policyId,
      tier: litEntry.tier,
      spend: spendFragment,
    });
    items.push(`${litigateLabel}|lit:${policyId}`);
  });

  Object.keys(pending.defect).forEach(policyId => {
    const defectLabel = t("queue.defect", {policy: policyId});
    items.push(`${defectLabel}|def:${policyId}`);
  });

  $("queued").innerHTML = items.length ?
    items.map(item => {
      const [label, key] = item.split("|");
      return `<span class="item">${label}<button onclick="unqueue('${key}')">✕</button></span>`;
    }).join("")
    : `<span class="dim">${t("queue.pass")}</span>`;
}

// Removes a single queued action by its encoded key.
export function unqueue(key){
  if(key === "pt") pending.post_train = null;
  else if(key === "run") pending.commission_run = null;
  else if(key === "rel"){
    pending.release = false;
    const cb = $("release-cb"); if(cb) cb.checked = false;
  }
  else if(key.startsWith("p:"))   unqueueProject(key.slice(2));
  else if(key.startsWith("lit:")) delete pending.litigation[key.slice(4)];
  else if(key.startsWith("def:")) delete pending.defect[key.slice(4)];
  else if(key.startsWith("l:"))   delete pending.lobby[key.slice(2)];
  render();
}
