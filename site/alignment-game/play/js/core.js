"use strict";
// ── core: shared state, constants, helpers, network, and the render bus ──────
// Everything here is imported by the view modules. The mutable game state lives
// in `let` exports (live bindings): only this module REASSIGNS them (in apply/
// freshPending/resetFeed); view modules read them and mutate their CONTENTS.

// ── DOM / formatting helpers ─────────────────────────────────────────────────
export const $ = id => document.getElementById(id);
export const fmt$ = v => "$" + Math.round(v).toLocaleString() + "M";

// HTML-escape any value before it goes into an innerHTML template. The research
// content we render comes from the trusted backend catalog today, but a later
// stage adds user-entered lab name/ticker — escaping here keeps these templates
// from becoming an XSS sink when that lands. Use for any value, not just strings.
export function esc(value){
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Re-export the strings table + lookup helper so view modules can import them
// from core alongside the other shared helpers, matching the existing pattern.
export { STRINGS, t } from "./strings.js";
import { t } from "./strings.js";

// ── Network ──────────────────────────────────────────────────────────────────
// There is no server: the engine runs in Pyodide in worker.js, which answers each
// api() call with the JSON the game's server would send for that route.
const worker = new Worker(new URL("../worker.js", import.meta.url), {type:"module"});
const inFlight = new Map();
let nextId = 0;
worker.onmessage = (e) => {
  const {id, result, error} = e.data;
  const p = inFlight.get(id);
  inFlight.delete(id);
  if(error !== undefined) p.reject(new Error(error)); else p.resolve(JSON.parse(result));
};
function call(path, body){
  return new Promise((resolve, reject) => {
    const id = nextId++;
    inFlight.set(id, {resolve, reject});
    worker.postMessage({id, path, body});
  });
}
// Starting Pyodide takes a few seconds; #boot says so until the engine is up.
const booted = call("__boot__").then(
  () => { const b = document.getElementById("boot"); if(b) b.remove(); },
  (err) => { const b = document.getElementById("boot");
             if(b) b.textContent = "The game engine didn't load (" + err.message + "). Try reloading."; throw err; });
export async function api(path, body){
  await booted;
  try { return await call(path, body); }
  catch(err){ return {errors:[err.message]}; }
}

// ── Constants ────────────────────────────────────────────────────────────────
// Desaturated lab palette: hues kept distinct but saturation roughly halved so the
// legend/lines read as muted tones on the warm-paper theme rather than neon.
export const COLORS = {player:"#7badd3", rival1:"#d98e8e", rival2:"#d1ab75",
                       rival3:"#ac9cde", rival4:"#87b893", rival5:"#e2a7ca"};

// Multiplayer worlds have lab ids (player1..playerN) the fixed table doesn't
// know. Fall back to a second muted palette picked by the lab's stable position
// in the server's lab map, so every seat sees the same color for the same lab.
const EXTRA_COLORS = ["#8fb8c9", "#c9a58f", "#9ec98f", "#b48fc9",
                      "#c98fa5", "#8f93c9"];
export function colorFor(labId){
  if(COLORS[labId]) return COLORS[labId];
  const stableIndex = Object.keys(NAMES).indexOf(labId);
  if(stableIndex < 0) return "#888";
  return EXTRA_COLORS[stableIndex % EXTRA_COLORS.length];
}

export const ENF_COLOR = {low:"dim", medium:"warn", high:"bad"};

// ── Mutable game state (live-binding exports) ────────────────────────────────
export let OBS = null, NAMES = {}, TICKERS = {}, HIST = [], FEED = [], TRUTH = {turns:[]};
export let pending = freshPending();

// Multiplayer status for THIS seat (the `mp` block of /api/mp/state): null in
// solo play. Reassigned only here (setMP), read everywhere — same live-binding
// convention as OBS.
export let MP = null;
export function setMP(next){ MP = next; }

// Whether a game has been started in this tab (solo modal or multiplayer
// lobby). Lives here (not main.js) so the lobby module can flip it too.
export let started = false;
export function setStarted(value){ started = value; }

export function freshPending(){
  // lobby: {pid:{stance,spend}}  litigation: {pid:{side,tier,spend}}  defect: {pid:true}
  return {start_projects:[], post_train:null, commission_run:null,
          release:false, lobby:{}, litigation:{}, defect:{}, sign_safe_harbor:false};
}

export function resetFeed(){ FEED = []; }

// ── Render bus — main.js registers the master render()/post-mortem hooks here,
// so view-module handlers can trigger a re-render without importing main. ──────
export let render = () => {};
export function setRender(fn){ render = fn; }
let onGameOver = () => {};
export function setOnGameOver(fn){ onGameOver = fn; }

// ── Core state application ────────────────────────────────────────────────────
// Receives a server payload, updates globals, and triggers a full render.
export async function apply(payload){
  if(payload.errors){ $("errors").textContent = payload.errors.join("\n"); return; }
  $("errors").textContent = "";
  OBS = payload.observation; NAMES = payload.lab_names; HIST = payload.caps_history;
  TICKERS = payload.lab_tickers || {};
  pending = freshPending();
  collectFeed();
  // Debug god-view, served separately from OBS. Solo only: multiplayer has NO
  // truth route (MULTIPLAYER_DESIGN §6, L1 — it would be opponents' hidden
  // state), so don't even ask.
  TRUTH = MP ? {turns: []} : await api("/api/truth");
  render();
  if(OBS.game_over) onGameOver();
}

// Prepends all new per-turn feed items (findings, tips, news, events) to FEED.
function collectFeed(){
  const turn = OBS.turn;

  // Each item keeps its TYPE label separate from the message body, so the view
  // can render the label as a tag and the text in its own area (not "tip(...)").
  OBS.new_findings.forEach(finding => FEED.unshift(
    {turn, cls:"finding", label:t("feed.finding.label", {evidence:finding.evidence}),
     text:finding.text}));

  OBS.tips.forEach(tip => FEED.unshift(
    {turn, cls:"tip", label:t("feed.tip.label", {reliability:tip.reliability}),
     text:tip.text}));

  OBS.policy_news.forEach(newsItem => FEED.unshift(
    {turn, cls:"news", label:t("feed.news.label"), text:newsItem}));

  OBS.public_events.forEach(event => FEED.unshift(
    {turn, cls:"event", label:t("feed.event.label", {category:event.category}),
     text:event.text}));

  if(FEED.length>400) FEED.length = 400;
}

// ── AI-assist budget/time preview helpers ────────────────────────────────────
// Mirrors engine _effective_fraction / duration speedup so the player SEES
// assist shrink budget + time before committing.
export function effFraction(base, assist){
  const assistParams = OBS.legal_moves.assist;
  return base * (1 - assistParams.max_reduction * (assist||0) * assistParams.potency);
}
export function effYears(base, assist){
  const assistParams = OBS.legal_moves.assist;
  return base / (1 + assistParams.speedup * (assist||0) * assistParams.speed_potency);
}

// Every research item the player can queue through start_projects, gathered from
// all three available lists: capability advances, safety evaluations/interventions,
// and safety ADVANCES to research. budgetLeft / cashLeft / renderQueue all look a
// queued item up here — earlier they searched only the first two lists, so a queued
// safety ADVANCE silently dropped out of the budget/cash preview entirely.
export function queueableProjects(){
  const lm = OBS.legal_moves;
  return lm.capability_projects_available
    .concat(lm.safety_projects_available)
    .concat(lm.safety_advances_available || []);
}

// Returns remaining work-budget after all queued project costs.
export function budgetLeft(){
  let usedBudget = 0;
  const allProjects = queueableProjects();

  pending.start_projects.forEach(queued => {
    const project = allProjects.find(x => x.project_id === queued.project_id);
    if(project) usedBudget += effFraction(project.budget_fraction, queued.ai_assist);
  });

  if(pending.post_train){
    // a post-train round costs a base work-budget plus whatever each APPLIED safety
    // advance adds (mirrors rules.applied_post_train_round_budget on the backend).
    const lm = OBS.legal_moves;
    usedBudget += lm.post_train_round_budget || 0;
    const applied = pending.post_train.applied_safety || [];
    const applicable = lm.applicable_post_train_safety || [];
    applied.forEach(advanceId => {
      const advance = applicable.find(a => a.advance_id === advanceId);
      if(advance) usedBudget += advance.round_budget || 0;
    });
  }
  return OBS.work_budget_free - usedBudget;
}

// Returns remaining cash ($M) after every queued action that spends cash. Mirrors
// the cash_needed accumulation in actions.validate_action so the cash chip previews
// the spend the MOMENT an action is queued, not at end-turn.
//
// Coverage gap (still enforced by the backend at end-turn): litigation's amicus/join
// tiers cost a FIXED fee that isn't exposed to the frontend, so only the typed
// litigation spend (the "fund" tier) is previewed here. See ISSUES.md.
export function cashLeft(){
  let usedCash = 0;
  const allProjects = queueableProjects();

  pending.start_projects.forEach(queued => {
    const project = allProjects.find(x => x.project_id === queued.project_id);
    if(project) usedCash += project.cash_cost || 0;
  });

  // commissioning a pretrain run spends its compute in cash (runs use no work-budget).
  if(pending.commission_run) usedCash += pending.commission_run.compute || 0;

  // governance spends: lobbying and litigation both draw cash (typed $M amounts).
  Object.values(pending.lobby).forEach(entry => {
    if(entry) usedCash += entry.spend || 0;
  });
  Object.values(pending.litigation).forEach(entry => {
    if(entry) usedCash += entry.spend || 0;
  });

  return OBS.cash - usedCash;
}

// Whether everything currently queued still fits within BOTH the work-budget and
// the cash on hand. Reads budgetLeft()/cashLeft(), which already net out the whole
// `pending` queue — so the pattern at a queue site is: mutate `pending`, call this,
// and revert the mutation if it returns {ok:false}. This is the frontend half of
// actions.validate_action's global budget check, pulled forward to the moment of
// queuing so the player is stopped HERE, not when they press END TURN.
export function queueFits(){
  const budgetRemaining = budgetLeft();
  if(budgetRemaining < -1e-9)
    return {ok:false, reason: t("queue.cantAfford.budget",
      {over: (-budgetRemaining).toFixed(2)})};

  const cashRemaining = cashLeft();
  if(cashRemaining < -1e-9)
    return {ok:false, reason: t("queue.cantAfford.cash",
      {over: Math.round(-cashRemaining)})};

  return {ok:true};
}
