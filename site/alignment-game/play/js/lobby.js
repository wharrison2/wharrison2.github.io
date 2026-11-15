"use strict";
// ── lobby: multiplayer create/join overlays, lobby screen, polling, barrier UI,
//    and the creator's in-game admin panel (MULTIPLAYER_DESIGN §5) ─────────────
//
// Imports from core ONLY (never main — module-cycle rule, CLAUDE.md §9). All
// re-renders go through the bussed `render`; MP/started are reassigned only via
// core's setters. Every human-authored string (another player's lab name/ticker,
// the echoed lobby code) is esc()-escaped at the render site: in multiplayer a
// peer's name lands in YOUR DOM, so an unescaped path is stored XSS (§6, A8).
//
// No dev-mode checkbox exists on these paths and no truth fetch happens in MP
// (§6, L1): the god-view Truth tab is a solo debug aid only.
import {
  $, api, apply, esc, t, render,
  MP, setMP, setStarted, OBS, pending,
} from "./core.js";

// The lobby metadata from the last /api/mp/lobby (or create/join) response.
// Module-local: only this module renders the lobby screen.
let LOBBY = null;

// Poll cadences (ms). Lobby is chatty (people watch the roster fill); in-game
// only needs to notice the barrier resolving.
const LOBBY_POLL_MS = 1000;
const GAME_POLL_MS = 1500;
const COUNTDOWN_TICK_MS = 250;
const STAGE_DEBOUNCE_MS = 800;

let lobbyPollTimer = null;
let gamePollTimer = null;
let countdownTimer = null;
let stageTimer = null;
// Local wall-clock instant the current turn deadline maps to, interpolated
// between polls so the countdown chip ticks smoothly.
let deadlineAtMs = null;
// Force apply() on the next game-state payload regardless of turn number: a
// leftover solo OBS can share the MP world's turn number (both start at 0),
// which would otherwise fool handleMpPayload's is-new-turn check and leave
// the solo world on screen inside the MP game.
let forceApplyNextPayload = false;

// Full multiplayer teardown. Called when the player leaves MP for solo play
// (main.js newGame) — without it the surviving 1.5s poll would re-set MP and
// apply() the MP world over the fresh solo game.
export function stopMpPolling(){
  stopLobbyPoll();
  stopGamePoll();
  stopCountdown();
  clearTimeout(stageTimer);
  LOBBY = null;
}

function closeOverlay(){ $("overlay").classList.remove("show"); }

// ── Create / join overlays ────────────────────────────────────────────────────

function identityFieldsHTML(){
  // Same field ids as the solo modal so main.js's onLabNameInput/onTickerInput
  // (already on window) keep working.
  return `
    <div class="row">${t("newgame.labName.label")}
      <input type="text" id="ng-name" maxlength="40" placeholder="${t("newgame.labName.placeholder")}"
        oninput="onLabNameInput()" style="flex:1"></div>
    <div class="row">${t("newgame.ticker.label")}
      <input type="text" id="ng-ticker" maxlength="6" placeholder="${t("newgame.ticker.placeholder")}"
        oninput="onTickerInput()" style="width:90px;text-transform:uppercase">
      <span class="dim" style="font-size:11px">${t("newgame.ticker.hint")}</span></div>`;
}

export function showMpCreate(){
  $("overlay-content").innerHTML = `
    <div class="panel" style="max-width:460px;margin:60px auto">
    <h3>${t("mp.create.title")}</h3>
    ${identityFieldsHTML()}
    <div class="row" style="margin-top:10px">
      <button class="primary" onclick="mpCreate()">${t("mp.create.start")}</button>
      <button onclick="showNewGame({initial:true})">${t("mp.back")}</button></div>
    </div>`;
  $("overlay").classList.add("show");
}

export function showMpJoin(){
  $("overlay-content").innerHTML = `
    <div class="panel" style="max-width:460px;margin:60px auto">
    <h3>${t("mp.join.title")}</h3>
    <div class="row">${t("mp.join.code.label")}
      <input type="text" id="mp-code" maxlength="6" placeholder="${t("mp.join.code.placeholder")}"
        style="width:120px;text-transform:uppercase"></div>
    ${identityFieldsHTML()}
    <div class="row" style="margin-top:10px">
      <button class="primary" onclick="mpJoin()">${t("mp.join.start")}</button>
      <button onclick="showNewGame({initial:true})">${t("mp.back")}</button></div>
    </div>`;
  $("overlay").classList.add("show");
}

export async function mpCreate(){
  const fresh = await api("/api/mp/create",
    {lab_name: $("ng-name").value, ticker: $("ng-ticker").value});
  if(fresh.errors){ $("errors").textContent = fresh.errors.join("\n"); return; }
  enterLobby(fresh.lobby);
}

export async function mpJoin(){
  const fresh = await api("/api/mp/join",
    {code: $("mp-code").value, lab_name: $("ng-name").value,
     ticker: $("ng-ticker").value});
  if(fresh.errors){ $("errors").textContent = fresh.errors.join("\n"); return; }
  enterLobby(fresh.lobby);
}

// ── Lobby screen ──────────────────────────────────────────────────────────────

function enterLobby(lobbyPayload){
  $("errors").textContent = "";
  LOBBY = lobbyPayload;
  renderLobby();
  stopLobbyPoll();
  lobbyPollTimer = setInterval(pollLobby, LOBBY_POLL_MS);
}

function stopLobbyPoll(){
  if(lobbyPollTimer){ clearInterval(lobbyPollTimer); lobbyPollTimer = null; }
}

async function pollLobby(){
  const lobbyPayload = await api("/api/mp/lobby");
  if(lobbyPayload.errors){
    // 401 = kicked from the lobby (token revoked) — stop and say so.
    stopLobbyPoll();
    $("errors").textContent = t("mp.kicked");
    return;
  }
  LOBBY = lobbyPayload;
  if(LOBBY.started){ enterGame(); return; }
  renderLobby();
}

function mySeat(){
  return (LOBBY.seats || []).find(seat => seat.is_you) || null;
}

function lobbySeatCardHTML(seat, iAmCreator){
  const tags = [];
  if(seat.is_creator) tags.push(`<span class="tag">${t("mp.lobby.creatorTag")}</span>`);
  if(seat.is_you) tags.push(`<span class="tag good">${t("mp.lobby.youTag")}</span>`);
  const presence = seat.connected ? t("mp.seat.connected") : t("mp.seat.disconnected");
  const kickButton = (iAmCreator && !seat.is_creator)
    ? `<button onclick="mpKick(${seat.seat_id})">${t("mp.lobby.kick")}</button>` : "";
  return `<div class="panel" style="margin:4px;min-width:150px">
    <div class="row"><b>${esc(seat.ticker)}</b> ${tags.join(" ")}</div>
    <div class="row">${esc(seat.name)}</div>
    <div class="row dim" style="font-size:11px">${presence}</div>
    <div class="row">${kickButton}</div></div>`;
}

function renderLobby(){
  const me = mySeat();
  const iAmCreator = !!(me && me.is_creator);
  const seatCards = LOBBY.seats
    .map(seat => lobbySeatCardHTML(seat, iAmCreator)).join("");

  const creatorControls = `
    <div class="row">${t("mp.lobby.rivals.label", {max: LOBBY.max_rivals})}
      <input type="number" id="mp-rivals" min="0" max="${LOBBY.max_rivals}"
        value="${LOBBY.rival_count}" onchange="mpSetRivals()" style="width:70px"></div>
    <div class="row">${t("mp.lobby.timer.label",
        {min: LOBBY.turn_seconds_min, max: LOBBY.turn_seconds_max})}
      <input type="number" id="mp-timer" min="0" max="${LOBBY.turn_seconds_max}"
        value="${LOBBY.turn_seconds == null ? "" : LOBBY.turn_seconds}"
        onchange="mpSetTimer()" style="width:90px"></div>
    <div class="row dim" style="font-size:11px">${t("mp.lobby.timer.hint")}</div>
    <div class="row" style="margin-top:10px">
      <button class="primary" onclick="mpStart()">${t("mp.lobby.start")}</button></div>`;

  $("overlay-content").innerHTML = `
    <div class="panel" style="max-width:560px;margin:60px auto">
    <h3>${t("mp.lobby.title", {code: esc(LOBBY.code)})}</h3>
    <div class="row dim" style="font-size:11px">${t("mp.lobby.shareHint")}</div>
    <div class="row" style="flex-wrap:wrap;align-items:stretch">${seatCards}</div>
    ${iAmCreator ? creatorControls
                 : `<div class="row dim">${t("mp.lobby.waitingForHost")}</div>`}
    </div>`;
  $("overlay").classList.add("show");
}

export async function mpSetRivals(){
  const lobbyPayload = await api("/api/mp/settings",
    {rival_count: parseInt($("mp-rivals").value || 0)});
  if(!lobbyPayload.errors){ LOBBY = lobbyPayload; renderLobby(); }
}

export async function mpSetTimer(){
  const rawSeconds = $("mp-timer").value;
  const lobbyPayload = await api("/api/mp/settings",
    {turn_seconds: rawSeconds === "" ? null : parseInt(rawSeconds)});
  if(!lobbyPayload.errors){ LOBBY = lobbyPayload; renderLobby(); }
}

export async function mpStart(){
  const lobbyPayload = await api("/api/mp/start", {});
  if(lobbyPayload.errors){
    $("errors").textContent = lobbyPayload.errors.join("\n");
    return;
  }
  LOBBY = lobbyPayload;
  enterGame();
}

// ── In-game: polling, barrier banner, countdown, admin ───────────────────────

async function enterGame(){
  stopLobbyPoll();
  setStarted(true);
  closeOverlay();
  forceApplyNextPayload = true;   // first MP payload must replace any solo OBS
  await pollGameState();          // first paint before the interval kicks in
  stopGamePoll();
  gamePollTimer = setInterval(pollGameState, GAME_POLL_MS);
  if(!countdownTimer) countdownTimer = setInterval(renderCountdownChip, COUNTDOWN_TICK_MS);
}

function stopGamePoll(){
  if(gamePollTimer){ clearInterval(gamePollTimer); gamePollTimer = null; }
}

function stopCountdown(){
  if(countdownTimer){ clearInterval(countdownTimer); countdownTimer = null; }
  deadlineAtMs = null;
  $("mp-chip").style.display = "none";
}

async function pollGameState(){
  const payload = await api("/api/mp/state");
  if(payload.errors){
    // 401 = kicked (token revoked, §6 A4): stop polling, tell the player.
    stopGamePoll(); stopCountdown();
    $("errors").textContent = t("mp.kicked");
    return;
  }
  handleMpPayload(payload);
}

// Shared by the poll loop and main.js's endTurn (its /api/mp/action response is
// the same state-payload shape).
export function handleMpPayload(payload){
  if(payload.errors){ $("errors").textContent = payload.errors.join("\n"); return; }
  setMP(payload.mp);
  deadlineAtMs = payload.mp.deadline_seconds_left == null
    ? null : Date.now() + payload.mp.deadline_seconds_left * 1000;
  const isNewTurn = forceApplyNextPayload
                 || !OBS || payload.observation.turn !== OBS.turn
                 || payload.mp.game_over !== OBS.game_over;
  forceApplyNextPayload = false;
  if(isNewTurn){
    apply(payload);      // full re-render; resets pending for the new turn
  } else {
    renderMpStatus();    // same turn: just refresh the barrier banner/chip
  }
  if(payload.mp.game_over){ stopGamePoll(); stopCountdown(); }
}

// Barrier banner + admin button. Called from render() (via mpOnRender) and on
// every poll, so it stays fresh whichever fires first.
export function renderMpStatus(){
  const banner = $("mp-banner");
  if(!MP || MP.game_over){ banner.style.display = "none"; return; }
  const totalHumans = MP.barrier.total;
  const submitted = MP.barrier.submitted;
  const bannerText = MP.you.submitted
    ? t("mp.banner.submitted", {remaining: totalHumans - submitted})
    : t("mp.banner.waiting", {submitted, total: totalHumans});
  const seatDots = MP.barrier.seats.map(seat => {
    const stateLabel = seat.control === "ai" ? t("mp.seat.ai")
      : seat.control === "auto_pass" ? t("mp.seat.autoPass")
      : seat.submitted ? t("mp.seat.submitted") : t("mp.seat.waiting");
    const cls = seat.submitted || seat.control !== "human" ? "good" : "";
    return `<span class="tag ${cls}">${esc(seat.ticker)} ${stateLabel}</span>`;
  }).join(" ");
  const adminButton = MP.you.is_creator
    ? `<button onclick="showMpAdmin()">${t("mp.admin.open")}</button>` : "";
  banner.innerHTML = `<b>${bannerText}</b> ${seatDots} ${adminButton}`;
  banner.style.display = "";
  renderCountdownChip();
}

function renderCountdownChip(){
  const chip = $("mp-chip");
  if(!MP || MP.game_over || deadlineAtMs == null){
    chip.style.display = "none";
    return;
  }
  const secondsLeft = Math.max(0, (deadlineAtMs - Date.now()) / 1000);
  chip.textContent = t("mp.chip.timer", {seconds: Math.ceil(secondsLeft)});
  chip.style.display = "";
}

// Called from main.js's render(): keeps the server's staged copy of this
// seat's queue current, so timer expiry submits what the player actually has
// queued (decision #2). Debounced; only matters when a timer is running.
export function mpOnRender(){
  renderMpStatus();
  // Disarm BEFORE the early returns: a debounce armed just before the player
  // submitted must never fire after submission (the server also rejects a
  // post-submit stage, but don't even send it).
  clearTimeout(stageTimer);
  if(!MP || MP.game_over || !MP.turn_seconds) return;
  if(!MP.you || MP.you.submitted) return;
  stageTimer = setTimeout(() => { api("/api/mp/stage", {action: pending}); },
                          STAGE_DEBOUNCE_MS);
}

// ── Creator's in-game admin panel (decision #4) ──────────────────────────────

export function showMpAdmin(){
  if(!MP || !MP.you.is_creator) return;
  const seatRows = MP.barrier.seats
    .filter(seat => !seat.is_you)
    .map(seat => {
      const presence = seat.connected ? t("mp.seat.connected") : t("mp.seat.disconnected");
      const controls = seat.control === "human" ? `
        <button onclick="mpKick(${seat.seat_id}, 'ai')">${t("mp.admin.replaceAI")}</button>
        <button onclick="mpKick(${seat.seat_id}, 'auto_pass')">${t("mp.admin.autoPass")}</button>`
        : `<span class="tag">${seat.control === "ai" ? t("mp.seat.ai") : t("mp.seat.autoPass")}</span>`;
      return `<div class="row"><b>${esc(seat.ticker)}</b> ${esc(seat.name)}
        <span class="dim">${presence}</span><span style="flex:1"></span>${controls}</div>`;
    }).join("");
  $("overlay-content").innerHTML = `
    <div class="panel" style="max-width:520px;margin:60px auto">
    <h3>${t("mp.admin.title")}</h3>
    <div class="row dim" style="font-size:11px">${t("mp.admin.hint")}</div>
    ${seatRows}
    <div class="row" style="margin-top:10px">
      <button onclick="closeOverlay()">${t("mp.admin.close")}</button></div>
    </div>`;
  $("overlay").classList.add("show");
}

export async function mpKick(targetSeatId, resolution){
  const result = await api("/api/mp/kick",
    {target_seat: targetSeatId, resolution: resolution || "auto_pass"});
  if(result.errors){ $("errors").textContent = result.errors.join("\n"); return; }
  if(LOBBY && !LOBBY.started && result.lobby && !result.lobby.started){
    LOBBY = result.lobby;
    renderLobby();
    return;
  }
  // in-game: refresh the barrier view (the kick may have released it)
  closeOverlay();
  await pollGameState();
}

// ── Post-game leaderboard panel (prepended to the post-mortem by main.js) ────

export function leaderboardHTML(leaderboard){
  if(!leaderboard || !leaderboard.length) return "";
  const rows = leaderboard.map(entry => `<tr>
    <td><b>${esc(entry.ticker)}</b> ${esc(entry.name)}
      <span class="tag">${entry.is_human ? t("mp.leaderboard.human") : t("mp.leaderboard.ai")}</span></td>
    <td>$${Math.round(entry.market_cap).toLocaleString()}M</td>
    <td>${entry.net_impact}</td>
    <td>${entry.result ? esc(entry.result) : "—"}</td></tr>`).join("");
  return `<div class="panel"><h3>${t("mp.leaderboard.title")}</h3>
    <table><tr><th>${t("mp.leaderboard.col.lab")}</th>
      <th>${t("mp.leaderboard.col.marketCap")}</th>
      <th>${t("mp.leaderboard.col.impact")}</th>
      <th>${t("mp.leaderboard.col.result")}</th></tr>${rows}</table></div>`;
}
