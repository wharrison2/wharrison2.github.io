"use strict";
// ── tutorial: an optional guided walkthrough of the game's main surfaces ──────
// Opt-in from the new-game modal. It deliberately does NOT touch game state — it
// only switches tabs, rings the relevant nav target (the directional pointer),
// and shows authored guidance copy (all of it in strings.js under `tutorial.*`).
// The player keeps full control the whole time; the coach box can be dismissed at
// any step. Because it never reads true state, it sits well outside §2's firewall.
import { $, t } from "./core.js";
import { switchView } from "./views.js";

// The walkthrough as DATA: one row per step. `view` is the tab to bring forward,
// `highlight` is the CSS selector of the element to ring (null = no pointer, for
// the open/close steps), and the two keys name the authored title/body copy.
// Adding a step is adding a row here plus its two strings — no control-flow edits.
const TUTORIAL_STEPS = [
  {view:"market",     highlight:null,
   titleKey:"tutorial.welcome.title",    bodyKey:"tutorial.welcome.body"},
  {view:"market",     highlight:'#nav button[data-view="market"]',
   titleKey:"tutorial.market.title",     bodyKey:"tutorial.market.body"},
  {view:"lab",        highlight:'#nav button[data-view="lab"]',
   titleKey:"tutorial.lab.title",        bodyKey:"tutorial.lab.body"},
  {view:"benchmarks", highlight:'#nav button[data-view="benchmarks"]',
   titleKey:"tutorial.benchmarks.title", bodyKey:"tutorial.benchmarks.body"},
  {view:"research",   highlight:'#nav button[data-view="research"]',
   titleKey:"tutorial.research.title",   bodyKey:"tutorial.research.body"},
  {view:"intel",      highlight:'#nav button[data-view="intel"]',
   titleKey:"tutorial.intel.title",      bodyKey:"tutorial.intel.body"},
  {view:"governance", highlight:'#nav button[data-view="governance"]',
   titleKey:"tutorial.governance.title", bodyKey:"tutorial.governance.body"},
  {view:"market",     highlight:'#queue',
   titleKey:"tutorial.endturn.title",    bodyKey:"tutorial.endturn.body"},
  {view:"market",     highlight:null,
   titleKey:"tutorial.finish.title",     bodyKey:"tutorial.finish.body"},
];

// Which step the player is on. Only meaningful while the coach box is showing.
let stepIndex = 0;

// Begin the walkthrough at the first step. Called from main.newGame() when the
// player ticked the tutorial box; safe to call again to restart from the top.
export function startTutorial(){
  stepIndex = 0;
  showStep();
}

// Advance one step, or finish (and close) once past the last step.
export function tutorialNext(){
  if(stepIndex >= TUTORIAL_STEPS.length - 1){
    tutorialEnd();
    return;
  }
  stepIndex += 1;
  showStep();
}

// Step back toward the start; the first step's Back button is disabled, so this
// is only reachable from step 2 onward.
export function tutorialPrev(){
  if(stepIndex === 0) return;
  stepIndex -= 1;
  showStep();
}

// Close the coach box and drop any directional ring. Used by Skip, by the final
// step's confirm button, and whenever the new-game modal reopens.
export function tutorialEnd(){
  clearHighlight();
  $("tutorial-coach").classList.remove("show");
}

// Render the current step: surface its tab, move the directional ring, and fill
// the coach box. The buttons call window handlers wired up in main.js.
function showStep(){
  const step = TUTORIAL_STEPS[stepIndex];
  switchView(step.view);
  setHighlight(step.highlight);

  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === TUTORIAL_STEPS.length - 1;
  const stepNumber = stepIndex + 1;

  const backButton = `<button onclick="tutorialPrev()" ${isFirstStep ? "disabled" : ""}>` +
    `${t("tutorial.back")}</button>`;
  const nextLabel = isLastStep ? t("tutorial.finish") : t("tutorial.next");
  const nextButton = `<button class="primary" onclick="tutorialNext()">${nextLabel}</button>`;
  // The final step needs no "skip" affordance — Back/Finish already cover it.
  const skipButton = isLastStep ? "" :
    `<button class="tut-skip" onclick="tutorialEnd()">${t("tutorial.skip")}</button>`;

  const coachBox = $("tutorial-coach");
  coachBox.innerHTML = `
    <div class="tut-step">${t("tutorial.stepCounter",
        {current: stepNumber, total: TUTORIAL_STEPS.length})}</div>
    <h3>${t(step.titleKey)}</h3>
    <div class="tut-body">${t(step.bodyKey)}</div>
    <div class="tut-controls">${backButton}${nextButton}${skipButton}</div>`;
  coachBox.classList.add("show");
}

// ── Directional ring ──────────────────────────────────────────────────────────
// At most one element wears the ring at a time. We track it so the next step (or
// a tutorial end) can take it off without re-querying the whole document.
let ringedElement = null;

function clearHighlight(){
  if(ringedElement){
    ringedElement.classList.remove("tut-highlight");
    ringedElement = null;
  }
}

function setHighlight(selector){
  clearHighlight();
  if(!selector) return;          // open/close steps point at nothing in particular
  const target = document.querySelector(selector);
  if(!target) return;            // missing target is harmless — just no ring
  target.classList.add("tut-highlight");
  ringedElement = target;
}
