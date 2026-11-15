"use strict";
// ── main: master render, overlays, dev-mode gate, bootstrap + window wiring ──
import {
  $, fmt$, api, apply, OBS, pending, budgetLeft, cashLeft,
  setRender, setOnGameOver, resetFeed, t,
  MP, setMP, started, setStarted,
} from "./core.js";
import {
  showMpCreate, showMpJoin, mpCreate, mpJoin, mpStart, mpKick,
  mpSetRivals, mpSetTimer, showMpAdmin, handleMpPayload, mpOnRender,
  leaderboardHTML, stopMpPolling,
} from "./lobby.js";
import {
  switchView, drawCaps, renderTraining, togglePostTrain, togglePostTrainSafety,
  toggleRelease, renderPretrain, queueRun, clearRun, renderReleased, renderBenchmarks,
  renderTruth, renderProjects, previewAssist, toggleDelegate, queueProject, unqueueProject,
  renderInProgress, renderWorry, renderRivals, renderAlignmentEvidence,
  renderFeed, renderGovernance,
  setLobbyStance, setLobbySpend, setLitField, clearLit, toggleDefect, openPolicyModal,
  renderQueue, unqueue,
} from "./views.js";
import {
  openProjectModal, carryOutProject, closeItemModal,
} from "./warnings.js";
import {
  startTutorial, tutorialNext, tutorialPrev, tutorialEnd,
} from "./tutorial.js";

// ── Master render — updates every panel ──────────────────────────────────────
function render(){
  if(!OBS) return;   // no game yet — nothing to render (guards pre-start renders)
  // Top bar chips
  $("t-turn").textContent = OBS.turn;
  $("t-year").textContent = OBS.year.toFixed(2);
  // Cash and budget chips show what's LEFT after everything queued this turn, so the
  // player sees an action's cost the moment they queue it. Queue-time guards keep
  // both from going negative via discrete actions; governance spends are typed, so
  // flag the chip red if those push a resource below zero (backend still enforces).
  const cashRemaining = cashLeft();
  $("t-cash").textContent = fmt$(cashRemaining);
  $("t-cash").classList.toggle("bad", cashRemaining < 0);
  $("t-rev").textContent  = fmt$(OBS.revenue_rate);
  $("t-inv").textContent  = fmt$(OBS.investment_rate);
  const budgetRemaining = budgetLeft();
  $("t-budget").textContent = budgetRemaining.toFixed(2);
  $("t-budget").classList.toggle("bad", budgetRemaining < -1e-9);
  $("t-appr").textContent = OBS.public_approval;
  $("t-chatter").textContent = OBS.regulatory_chatter;
  $("t-policies").textContent = OBS.active_policies.length ?
      t("topbar.policies.active", {list: OBS.active_policies.join(", ")}) :
      t("topbar.policies.none");

  drawCaps(); renderTraining(); renderPretrain(); renderReleased();
  renderBenchmarks();
  renderProjects(); renderInProgress(); renderWorry(); renderGovernance();
  renderRivals(); renderAlignmentEvidence(); renderFeed(); renderQueue(); renderTruth();
  mpOnRender();   // multiplayer barrier banner + staged-queue sync (no-op solo)
  // No turns until a game has been started through the new-game modal (and never
  // once the game is over). In multiplayer, also not while this seat's action is
  // submitted and the barrier is waiting on the other players.
  const waitingOnBarrier = !!(MP && MP.you && MP.you.submitted);
  $("endturn").disabled = !started || !!OBS.game_over || waitingOnBarrier;
}

// `started` lives in core.js (the lobby module flips it too); newGame() below
// sets it via setStarted once the server actually builds a game.

// Whether the player wants the guided walkthrough on the next game they start. The
// new-game checkbox reflects (and updates) this; it defaults ON so a first-time
// player gets the tour, and remembers the choice for later new games (mirrors DEV).
let wantTutorial = true;

// ── Dev mode (god-view Truth tab) — OFF by default, opt-in per game ──────────
// The Truth tab bypasses the true/measured firewall; it's a debug instrument, so
// it stays hidden unless the player ticks "dev mode" when starting a game.
let DEV = false;
function setDevMode(on){
  DEV = on;
  document.querySelectorAll('[data-view="truth"]').forEach(el =>
    el.style.display = on ? "" : "none");
  if(!on) switchView("market");   // never leave the player stranded on a hidden tab
}

// ── Turn submission ───────────────────────────────────────────────────────────
async function endTurn(){
  if(!started) return;   // modal must be dismissed via "start" first
  pending.sign_safe_harbor = $("safeharbor").checked;
  $("endturn").disabled = true;
  const res = await api(MP ? "/api/mp/action" : "/api/action", {action: pending});
  if(res.errors){
    $("endturn").disabled = false;
    $("errors").textContent = res.errors.join("\n");
    return;
  }
  if(MP){
    // Same state-payload shape as the poll; the barrier may still be waiting
    // (render() keeps END TURN disabled until the turn actually resolves).
    handleMpPayload(res);
    render();
    return;
  }
  $("endturn").disabled = false;
  apply(res);
}

// ── Overlays ──────────────────────────────────────────────────────────────────
function closeOverlay(){ $("overlay").classList.remove("show"); }

function showNewGame(opts){
  // On first load the modal is mandatory — no cancel, so a game can't be skipped.
  const initial = !!(opts && opts.initial);
  tutorialEnd();   // a running walkthrough must not float over the new-game modal
  $("overlay-content").innerHTML = `
    <div class="panel" style="max-width:460px;margin:60px auto">
    <h3>${t("newgame.title")}</h3>
    <div class="row">${t("newgame.labName.label")}
      <input type="text" id="ng-name" maxlength="40" placeholder="${t("newgame.labName.placeholder")}"
        oninput="onLabNameInput()" style="flex:1"></div>
    <div class="row">${t("newgame.ticker.label")}
      <input type="text" id="ng-ticker" maxlength="6" placeholder="${t("newgame.ticker.placeholder")}"
        oninput="onTickerInput()" style="width:90px;text-transform:uppercase">
      <span class="dim" style="font-size:11px">${t("newgame.ticker.hint")}</span></div>
    <div class="row">${t("newgame.seed.label")} <input type="number" id="ng-seed" value="0"></div>
    <div class="row">${t("newgame.difficulty.label")} <select id="ng-diff">
      ${["easy","medium","realistic","impossible"].map(difficultyId=>
        `<option value="${difficultyId}" ${difficultyId==="realistic"?"selected":""}>${t("newgame.difficulty."+difficultyId)}</option>`).join("")}</select></div>
    <div class="row">${t("newgame.guidance.label")} <select id="ng-guid">
      ${["hint_heavy","standard","sparse"].map(guidanceId=>
        `<option value="${guidanceId}" ${guidanceId==="standard"?"selected":""}>${t("newgame.guidance."+guidanceId)}</option>`).join("")}</select></div>
    <div class="row"><label><input type="checkbox" id="ng-tutorial" ${wantTutorial?"checked":""}>
      ${t("newgame.tutorial.label")}</label></div>
    <div class="row" style="margin-top:10px">
      <button class="primary" onclick="newGame()">${t("newgame.start")}</button>
      ${initial ? "" : `<button onclick="closeOverlay()">${t("newgame.cancel")}</button>`}</div>
    </div>`;
  $("overlay").classList.add("show");
}

// ── New-game lab name → ticker auto-derive ───────────────────────────────────
// The ticker DEFAULTS to the first 3 letters of the name (uppercased) and tracks
// the name as the player types it — UNTIL they edit the ticker by hand, after
// which we stop auto-deriving (their explicit choice wins). The server re-derives
// and sanitizes regardless, so this is convenience, not a trust boundary.
let tickerManuallyEdited = false;

// First three alphanumeric characters of the name, uppercased (mirrors the
// backend's derive_ticker_from_name so the preview matches what the server stores).
function deriveTicker(name){
  const alphanumeric = (name.match(/[a-zA-Z0-9]/g) || []).slice(0, 3);
  return alphanumeric.join("").toUpperCase();
}

function onLabNameInput(){
  if(tickerManuallyEdited) return;   // player took over the ticker — leave it alone
  $("ng-ticker").value = deriveTicker($("ng-name").value);
}

function onTickerInput(){
  // Any keystroke in the ticker field is the player claiming it; stop auto-deriving.
  tickerManuallyEdited = true;
}

async function newGame(){
  resetFeed();
  tickerManuallyEdited = false;   // reset for the next new-game modal
  // Dev mode is OPTIONAL: an UNCHECKED box is the normal path. It only toggles the
  // god-view Truth tab; nothing about starting a game depends on it being on.
  const devChecked = $("ng-dev") ? $("ng-dev").checked : false;
  // Remember the tutorial choice for later new-game modals (same pattern as DEV).
  wantTutorial = $("ng-tutorial") ? $("ng-tutorial").checked : false;
  // Send the raw name/ticker; the server sanitizes (length-clamp, control-char
  // strip, empty→default) — client values are convenience only, never trusted.
  const fresh = await api("/api/new",
    {seed:parseInt($("ng-seed").value||0),
     difficulty:$("ng-diff").value, guidance:$("ng-guid").value,
     lab_name:$("ng-name").value, ticker:$("ng-ticker").value});
  // Only enter the started state once the server actually built a game. If the
  // request errored, leave the modal open so the player can retry.
  if(fresh && fresh.errors){
    $("errors").textContent = fresh.errors.join("\n");
    return;
  }
  stopMpPolling();           // a live MP poll must not clobber the solo game
  setMP(null);               // a fresh SOLO game; drop any finished MP status
  setStarted(true);          // enable turns now that a game has been started
  // apply() populates OBS BEFORE anything renders. setDevMode() can switchView →
  // drawCaps, which reads OBS, so it must run AFTER apply — otherwise the
  // dev-unchecked path renders against a null OBS, throws, and the modal never
  // closes (looked like "can't start without dev mode"). See UI_ISSUES issue 10.
  apply(fresh);
  setDevMode(devChecked);
  closeOverlay();
  // Kick off the guided walkthrough last — after OBS is populated and the modal is
  // closed — so its first switchView has real state to render and a clear board.
  if(wantTutorial) startTutorial();
}

async function showPostmortem(){
  const pm = await api(MP ? "/api/mp/postmortem" : "/api/postmortem");
  const outcome = pm.outcome || {};
  const lastModel = pm.trajectories.length ?
      pm.trajectories[pm.trajectories.length-1].model : null;
  const trajectoryRows = pm.trajectories.filter(t => t.model === lastModel).slice(-14);

  $("overlay-content").innerHTML = `
    ${MP ? leaderboardHTML(pm.leaderboard) : ""}
    <div class="panel">
      <h3>${outcome.result || t("postmortem.defaultResult")} — ${t("postmortem.suffix")}</h3>
      <p style="font-size:15px">${outcome.headline||""}</p>
      <p class="dim">${outcome.detail||""}</p>
      ${pm.voided_impact?`<p class="bad">${t("postmortem.voidedImpact.prefix")}${pm.voided_impact.positive_impact_that_was_real}<br>
        <span class="dim">${pm.voided_impact.note}</span></p>`:""}
    </div>
    <div class="panel"><h3>${t("postmortem.keyMoments.title")}</h3>
      ${pm.key_moments.map(moment => `<div class="row"><span class="tag">t${moment.turn}</span>
        <b>${moment.model}</b> ${moment.kind}: <span class="dim">${moment.what_you_couldnt_see}</span></div>`)
        .join("") || `<span class="dim">${t("postmortem.keyMoments.empty")}</span>`}
    </div>
    ${trajectoryRows.length?`<div class="panel"><h3>${t("postmortem.truthTable.title", {model: lastModel})}</h3>
      <table><tr><th>${t("postmortem.truthTable.turn")}</th><th>${t("postmortem.truthTable.trueGoalmis")}</th><th>${t("postmortem.truthTable.measGoalmis")}</th>
        <th>${t("postmortem.truthTable.trueDecep")}</th><th>${t("postmortem.truthTable.measDecep")}</th><th>${t("postmortem.truthTable.conceal")}</th></tr>
      ${trajectoryRows.map(row => `<tr><td>${row.turn}</td>
        <td class="bad">${row.true_goal_misalignment}</td><td>${row.measured_goal_misalignment}</td>
        <td class="bad">${row.true_deception}</td><td>${row.measured_deception}</td>
        <td>${row.concealment}</td></tr>`).join("")}</table></div>`:""}
    <div class="panel"><h3>${t("postmortem.counterfactuals.title")}
      ${pm.counterfactuals_resimulated?`<span class="tag good">${t("postmortem.counterfactuals.resimulated")}</span>`:`<span class="tag">${t("postmortem.counterfactuals.heuristic")}</span>`}</h3>
      ${pm.counterfactuals.map(c=>`<div class="row">• ${c}</div>`).join("")}
    </div>
    <div class="row" style="margin:14px 0">
      <button class="primary" onclick="showNewGame()">${t("postmortem.newGame")}</button>
      <button onclick="closeOverlay()">${t("postmortem.inspectBoard")}</button>
    </div>`;
  $("overlay").classList.add("show");
}

// ── Static-copy localization (data-i18n) ─────────────────────────────────────
// index.html carries its static labels/headings/prose as data-i18n="<key>"
// attributes; the authored English lives in STRINGS, not the markup. This walks
// the page once at startup and fills each element from t(). Two attribute flavors:
//   data-i18n             → textContent (plain copy: nav labels, headings, …)
//   data-i18n-html        → innerHTML   (authored prose with <b> emphasis; this is
//                           trusted authored copy from STRINGS, never user input)
//   data-i18n-placeholder → input placeholder
// Element ids/handlers stay in the markup; only the visible copy is sourced here.
function localizeStaticCopy(){
  document.title = t("app.title");
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-html]").forEach(el => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
// Load whatever the server session holds (so the board renders behind the modal),
// then force the new-game modal: the player must start a game before any turn.
async function init(){
  localizeStaticCopy();   // fill data-i18n static copy before anything renders
  apply(await api("/api/state"));
  showNewGame({initial: true});
}

// Resize handler — redraws the SVG chart when the window changes size. The chart
// only has real pixel dimensions while the Market view is visible, so gate on the
// market section being active (an inline <svg> has no reliable offsetParent).
let _rz;
function marketViewVisible(){
  const section = document.querySelector('.view[data-view="market"]');
  return !!(section && section.classList.contains("active"));
}
addEventListener("resize", ()=>{ clearTimeout(_rz);
  _rz = setTimeout(()=>{ if(marketViewVisible()) drawCaps(); }, 120); });

// Wire the render bus + post-mortem hook, expose inline-handler targets on window.
setRender(render);
setOnGameOver(showPostmortem);
Object.assign(window, {
  switchView, showNewGame, endTurn, togglePostTrain, togglePostTrainSafety,
  toggleRelease, queueRun, clearRun, previewAssist, toggleDelegate, queueProject, unqueueProject,
  setLobbyStance, setLobbySpend, setLitField, clearLit, toggleDefect, unqueue,
  openPolicyModal,
  newGame, closeOverlay, openProjectModal, carryOutProject, closeItemModal,
  onLabNameInput, onTickerInput,
  tutorialNext, tutorialPrev, tutorialEnd,
  showMpCreate, showMpJoin, mpCreate, mpJoin, mpStart, mpKick,
  mpSetRivals, mpSetTimer, showMpAdmin,
});

setDevMode(false);   // Truth tab hidden until a game is started with dev mode on
init();
