"use strict";
// ── warnings: the §7c per-item "explain it, then carry it out" modal ─────────
// Clicking a research item opens a modal that explains what it does, shows the
// diegetic mechanism-teaching warning(s) for the risk it carries (from the
// backend warning catalog in legal_moves.warnings), and offers to carry it out.
// Education arrives exactly at the moment of choosing (design §7c).
import { $, OBS, esc, t } from "./core.js";
import { queueProject } from "./views.js";

// One warning's layered HTML: line (always) -> why (expandable) -> paper link.
function warningHTML(catalog, id, emphasised){
  const w = catalog[id];
  if(!w) return "";
  const paper = w.paper
    ? `<div style="margin-top:4px"><a href="${w.paper.url}" target="_blank"
         rel="noopener" class="acc">${w.paper.title} ↗</a></div>`
    : "";
  return `<div class="warn-item${emphasised ? " warn-emph" : ""}">
    <div class="warn-line">${t("warning.linePrefix")}${w.line}</div>
    <details><summary>${t("warning.why")}</summary>
      <div class="dim" style="margin-top:4px">${w.why}</div>${paper}</details></div>`;
}

// Which catalog warnings apply to a given project, and whether to emphasise the
// assist warning (assist already cranked high on its row).
function projectWarnings(project, isSafetyProject){
  const W = OBS.legal_moves.warnings;
  const out = [];
  // FIX (FIX_ITEMS.md): the AI-assist warning is about CONTAMINATION RIDING IN
  // THROUGH ASSIST. With no assist used there is no such channel, so don't warn
  // about it — only surface it when this item's assist value > 0 (and emphasise
  // it once assist is cranked high).
  const assistVal = parseFloat($("as-" + project.project_id)?.value || 0) || 0;
  if(assistVal > 0)
    out.push({ id: W.assist, emphasised: assistVal >= W.assist_emphasis_threshold });
  if(isSafetyProject && project.intervention &&
     W.disposition_axes.includes(project.target_axis))
    out.push({ id: W.intervention_disposition, emphasised: false });
  return out;
}

// Locate a research item by id across all three available lists, and classify it.
// "kind" is one of: "capability" | "safety_advance" | "safety_project". Capability
// advances and safety ADVANCES both carry the §8b what_it_does/risk_blurb fields;
// safety PROJECTS carry a blurb + evidence/spoofability instead.
function findProject(pid){
  const lm = OBS.legal_moves;
  const cap = lm.capability_projects_available.find(p => p.project_id === pid);
  if(cap) return { project: cap, kind: "capability" };
  const advance = (lm.safety_advances_available || []).find(p => p.project_id === pid);
  if(advance) return { project: advance, kind: "safety_advance" };
  const safe = lm.safety_projects_available.find(p => p.project_id === pid);
  if(safe) return { project: safe, kind: "safety_project" };
  return null;
}

// §8b: the value-neutral "what it does" comes FIRST (capability + safety advances
// carry what_it_does; safety projects carry a blurb + evidence/spoofability).
function describeProject(project, kind){
  if(kind === "safety_project"){
    // esc() the untrusted catalog values FIRST, then interpolate the escaped text
    // into the authored template — t() returns raw, so escaping must happen here.
    const intervenes = project.intervention
      ? t("modal.intervenes", {axis: esc((project.target_axis || "").replace(/_/g, " "))})
      : "";
    const evidenceLine = t("modal.evidence",
      {evidence: esc(project.evidence), spoofability: esc(project.spoofability)});
    return `${esc(project.blurb || "")}<div class="dim" style="margin-top:4px">${evidenceLine}${intervenes}</div>`;
  }
  return esc(project.what_it_does || "");
}

// Opens the modal for one research item.
export function openProjectModal(pid){
  const found = findProject(pid);
  if(!found){ queueProject(pid); return; }   // fallback: never block the action
  const { project, kind } = found;
  const W = OBS.legal_moves.warnings;
  const carriesNodeRiskBlurb = kind === "capability" || kind === "safety_advance";

  const desc = describeProject(project, kind);

  // Risk layer AFTER: the node's own risk framing (capability + safety advances),
  // then the generic §7c catalog warning(s) for the knobs this choice opens.
  const nodeRisk = (carriesNodeRiskBlurb && project.risk_blurb)
    ? `<div class="warn-item"><div class="warn-line">${t("warning.linePrefix")}${esc(project.risk_blurb)}</div></div>`
    : "";
  const warns = nodeRisk + projectWarnings(project, kind === "safety_project")
    .map(w => warningHTML(W.catalog, w.id, w.emphasised)).join("");

  // esc() the untrusted catalog numbers/name before they enter the authored
  // template — t() returns raw text and does not escape its params.
  const costLine = t("modal.cost", {cash: esc(project.cash_cost),
    years: esc(project.duration_years), budget: esc(project.budget_fraction)});

  $("modal-body").innerHTML = `
    <h3 style="text-transform:none;color:var(--txt);font-size:15px">${esc(project.name || pid)}</h3>
    <div class="dim" style="margin-bottom:8px">${costLine}</div>
    <div style="margin-bottom:10px">${desc}</div>
    ${warns}
    <div class="row" style="margin-top:14px">
      <button class="primary" onclick="carryOutProject('${esc(pid)}')">${t("modal.carryOut")}</button>
      <button onclick="closeItemModal()">${t("modal.cancel")}</button>
    </div>
    <div id="modal-error" class="bad" style="margin-top:8px"></div>`;
  $("itemmodal").classList.add("show");
}

// "Carry it out" — queues the item (reading the row's assist value) and closes the
// modal. If it would overrun the work-budget or cash, queueProject queues nothing
// and returns the reason; we keep the modal OPEN and show that reason inline (the
// queue error line sits behind the overlay), so the player learns why right here.
export function carryOutProject(pid){
  const result = queueProject(pid);
  if(result.ok){ closeItemModal(); return; }
  const errorSlot = $("modal-error");
  if(errorSlot) errorSlot.textContent = result.reason;
}

export function closeItemModal(){ $("itemmodal").classList.remove("show"); }
