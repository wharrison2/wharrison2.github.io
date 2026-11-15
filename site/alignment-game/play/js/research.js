"use strict";
// ── research: ONE research-item component, keyed by STATE ─────────────────────
// Replaces the old "text next to a button" rows (FIX_ITEMS.md "Research items").
// A single card renderer drives all three states of a research item:
//   • unresearched — clickable card; opens the §7c detail modal (what-it-does
//                    first, then the warning) and carries an inline assist slider.
//   • in_progress  — same card style, read-only, showing assist + years remaining.
//   • completed    — read-only card (Part-1 observation: shows what_it_does, no
//                    warning action — the choice is already made).
// Capability vs safety grouping stays legible: the caller renders each group into
// its own panel; this module only knows how to draw ONE card.
//
// Security: every value from the (trusted) backend catalog is run through esc()
// before it enters an innerHTML template, so these cards don't become an XSS sink
// when a later stage introduces user-entered text.
// The card templates reference openProjectModal / previewAssist via inline on*=
// handlers; those resolve through window (registered in main.js), not module
// imports, so this module only imports the helpers it calls directly in JS.
import { $, esc, t } from "./core.js";

// ── State 1: UNRESEARCHED — a clickable card that opens the detail modal ──────
// The ENTIRE card body opens the modal (openProjectModal) — including empty space
// in the assist row (issue 7). Only the assist INPUT itself stops propagation, so
// dragging/typing the slider adjusts it without opening the modal; clicking
// anywhere else in the card (labels, hint, blank assist-row space) still opens the
// modal. The modal's "carry it out" reads this same slider value.
//
// When delegate mode is unlocked (automated_researcher researched), a "Delegate"
// checkbox appears below the slider. Checking it disables the slider (fixing it at
// 1.0 for the preview) and marks the queued spec as {delegate:true} instead of
// {ai_assist:N}. toggleDelegate() is the handler; registered on window in main.js.
function unresearchedCard(item, kindTag, assistAvailable, delegateUnlocked){
  const projectId = item.project_id;
  const meta = `$${esc(item.cash_cost)}M · ${esc(item.duration_years)}y · `
             + `wb ${esc(item.budget_fraction)}`;
  // AI-assist needs a model to do the labor — released or still in training. With
  // none at all, the backend treats assist as 0 (turn_pipeline), so don't render
  // the input — show a hint instead. queueProject / carryOutProject both default a
  // missing slider to 0.
  const assistInput = assistAvailable
    ? `<span class="ri-meta">${t("ritem.assist")}</span>
       <input type="number" id="as-${esc(projectId)}" min="0" max="1" step="0.1"
         value="0" style="width:55px" onclick="event.stopPropagation()"
         oninput="previewAssist('${esc(projectId)}',${Number(item.budget_fraction)},${Number(item.duration_years)})">
       <span class="ri-meta" id="pv-${esc(projectId)}"></span>
       <span class="ri-meta dim">${t("ritem.clickHint")}</span>`
    : `<span class="ri-meta dim">${t("ritem.assistUnavailable")}</span>`;
  const delegateRow = (assistAvailable && delegateUnlocked)
    ? `<div class="ri-assist-row" onclick="event.stopPropagation()">
         <input type="checkbox" id="dlg-${esc(projectId)}"
           onchange="toggleDelegate('${esc(projectId)}',${Number(item.budget_fraction)},${Number(item.duration_years)})">
         <label for="dlg-${esc(projectId)}" class="ri-meta">${t("ritem.delegateLabel")}</label>
         <span class="ri-meta dim">${t("ritem.delegateHint")}</span>
       </div>`
    : "";
  return `<div class="ritem clickable" onclick="openProjectModal('${esc(projectId)}')">
    <div class="ri-head">
      <span class="ri-name">${esc(item.name || projectId)}</span>
      <span class="tag">${esc(kindTag)}</span>
    </div>
    <div class="ri-meta">${meta}</div>
    <div class="ri-assist-row">${assistInput}</div>
    ${delegateRow}
  </div>`;
}

// ── State 2: IN_PROGRESS — same card style, read-only ────────────────────────
function inProgressCard(item){
  const kindTag = item.phase ? `${esc(item.kind)} · ${esc(item.phase)}` : esc(item.kind);
  const assistTag = item.is_delegate
    ? `<span class="tag warn">${t("ritem.delegateTag")}</span>`
    : item.ai_assist
      ? `<span class="tag warn">${t("ritem.assistTag", {value: esc(item.ai_assist)})}</span>`
      : "";
  return `<div class="ritem in-progress">
    <div class="ri-head">
      <span class="ri-name">${esc(item.name || item.project_id)}</span>
      <span class="tag">${kindTag}</span>
    </div>
    <div class="ri-assist-row">
      ${assistTag}
      <span class="ri-meta">${t("ritem.yearsRemaining", {years: esc(item.years_remaining_estimate)})}</span>
    </div>
  </div>`;
}

// ── State 3: COMPLETED — read-only card (Part-1 observation fields) ───────────
// No warning action: the choice is already made. Shows the value-neutral
// what_it_does so the player can see what they unlocked (§8b).
function completedCard(advance){
  const kindLabel = advance.kind === "safety_advance"
    ? t("ritem.safetyAdvance") : t("ritem.capability");
  const versionTag = advance.version > 1
    ? `<span class="tag">v${esc(advance.version)}</span>` : "";
  // kindLabel is authored content (trusted); the phase comes from the catalog and
  // is esc()'d before joining.
  const completedTag = t("ritem.completedTag",
    {label: kindLabel + (advance.phase ? " · " + esc(advance.phase) : "")});
  return `<div class="ritem completed">
    <div class="ri-head">
      <span class="ri-name">${esc(advance.name || advance.id)}</span>
      <span class="tag good">${completedTag}</span>
    </div>
    <div class="ri-desc">${esc(advance.what_it_does)}</div>
    <div class="ri-meta">${versionTag} ${t("ritem.researchedTurn", {turn: esc(advance.completed_turn)})}</div>
  </div>`;
}

// ── Group renderers (the caller wires these into the three research panels) ───

// Available capability or safety items → unresearched clickable cards. The
// assistAvailable flag (from legal_moves.assist.available) gates the per-card
// AI-assist input — no model at all means no assist to offer.
// delegateUnlocked (from legal_moves.assist.delegate_unlocked) shows the Delegate
// checkbox once automated_researcher is in the tree.
export function renderAvailableItems(containerId, items, kindOf, emptyText, assistAvailable, delegateUnlocked){
  const container = $(containerId);
  if(!container) return;
  if(!items.length){ container.innerHTML = `<span class="dim">${esc(emptyText)}</span>`; return; }
  container.innerHTML = items
    .map(item => unresearchedCard(item, kindOf(item), assistAvailable, delegateUnlocked)).join("");
}

// In-progress processes (capability advances, safety, and the live pretrain run).
export function renderInProgressItems(containerId, items, emptyText){
  const container = $(containerId);
  if(!container) return;
  container.innerHTML = items.length
    ? items.map(inProgressCard).join("")
    : `<span class="dim">${esc(emptyText)}</span>`;
}

// Completed advances (capability + safety), grouped so the split reads at a glance.
export function renderCompletedAdvances(containerId, advances, emptyText){
  const container = $(containerId);
  if(!container) return;
  if(!advances.length){ container.innerHTML = `<span class="dim">${esc(emptyText)}</span>`; return; }

  const capability = advances.filter(a => a.kind !== "safety_advance");
  const safety = advances.filter(a => a.kind === "safety_advance");

  const group = (label, list) => list.length
    ? `<div class="ri-meta" style="margin:6px 0 2px">${esc(label)}</div>`
      + list.map(completedCard).join("")
    : "";

  container.innerHTML = group(t("research.completed.capability"), capability)
    + group(t("research.completed.safety"), safety);
}
