"""Two-phase training (design doc §8b, AUTHORITATIVE) + the §8 alignment terms.

Phase 1 (pretrain): compute x pretrain-advances -> capability CEILING (latent).
  Pretrain advances ARE the efficiency; there is no standalone scalar.
  Synthetic data / contaminated pretrain nodes poison the BASE (foundational
  floor post-training cannot scrub).

Phase 2 (post-train rounds, iterable pre-release): each round elicits realized
  capability toward the ceiling (asymptotic) AND shapes the alignment vector —
  the same operation. Houses the EFFECTIVENESS(eval_awareness, deception)
  linchpin, base_emergence, fake-the-objective, correlated jumps, drift noise,
  and the agentic influence edges (§5), in the §8b internal ordering:
  elicit + raise gated axes FIRST, then EFFECTIVENESS/fake-objective, then
  corrective effort.
"""
import math
from dataclasses import dataclass

from backend_v1.engine.model import Model, CapabilityVec, AlignmentVec, ALIGNMENT_AXES
from backend_v1.engine.rng import gate
from backend_v1.engine.alignment import coupling
from backend_v1.engine.research.capabilities.capabilities_research_item import (
    CAPABILITY_TREE_BY_ID,
)
from backend_v1.engine.research.safety.safety_advance_item import (
    SAFETY_ADVANCES_BY_ID,
)


def applied_safety_templates(lab, applied_ids, phase):
    """Resolve the SAFETY-ADVANCE templates the player chose to APPLY to a run,
    keeping only the ones (a) that exist, (b) the lab has actually researched, and
    (c) tagged for THIS phase. Returns [(template, ResearchedItem)]. Defensive: a
    rival or a malformed action listing an un-researched / wrong-phase id is simply
    dropped, never crashes."""
    resolved = []
    for advance_id in applied_ids or []:
        template = SAFETY_ADVANCES_BY_ID.get(advance_id)
        if template is None or template.phase != phase:
            continue
        researched = lab.researched_advances.get(advance_id)
        if researched is None:
            continue
        resolved.append((template, researched))
    return resolved


@dataclass
class TrainingRun:
    """In-progress pretrain; snapshots everything at COMMISSION time."""
    lab_id: str
    compute: float
    commissioned_turn: int
    duration_years_remaining: float
    # frozen at commission:
    consumed_advances: dict          # node_id -> ResearchedItem (the versions used)
    ceiling_efficiency: float
    coding_bonus: float
    used_synthetic_data: bool
    parent_model_id: str | None
    parent_goal_mis: float           # synthetic-data generator's TRUE goal_mis
    # applied PRETRAIN safety advances (template, ResearchedItem), snapshotted so the
    # foundational-floor / base-goal-mis effects use the versions chosen at commission
    applied_pretrain_safety: list

    def tick(self, dt: float) -> bool:
        self.duration_years_remaining -= dt
        return self.duration_years_remaining <= 1e-9


def commission_run(lab, compute: float, turn: int, consts,
                   applied_safety_ids=None) -> TrainingRun:
    ceiling_efficiency = lab.disposition.cost_advantage
    coding_bonus = 0.0
    used_synthetic_data = False
    consumed_advances = {}

    for node_id, item in lab.researched_advances.items():
        template = CAPABILITY_TREE_BY_ID.get(node_id)
        if template is None:
            continue
        consumed_advances[node_id] = item
        if template.phase == "pretrain":
            ceiling_efficiency *= template.ceiling_efficiency_mult
        coding_bonus += template.coding_ceiling_bonus
        if template.intrinsic_synthetic_data:
            used_synthetic_data = True

    applied_pretrain_safety = applied_safety_templates(lab, applied_safety_ids, "pretrain")

    parent = lab.current_best_model
    return TrainingRun(
        lab_id=lab.id, compute=compute, commissioned_turn=turn,
        duration_years_remaining=consts.PRETRAIN_DURATION_YEARS,
        consumed_advances=consumed_advances, ceiling_efficiency=ceiling_efficiency,
        coding_bonus=coding_bonus, used_synthetic_data=used_synthetic_data,
        parent_model_id=parent.id if parent else None,
        parent_goal_mis=parent.alignment_vec.goal_misalignment if parent else 0.0,
        applied_pretrain_safety=applied_pretrain_safety,
    )


def complete_pretrain(run: TrainingRun, lab, turn: int, rng, consts) -> Model:
    """Produce the base model: high latent potential, low realized capability,
    latent alignment dispositions (possibly poisoned foundations)."""
    # sqrt inside the exponential: early compute buys real capability, the top
    # of the range stays expensive (concentration matters; weak runs don't sum)
    scaled_compute = math.sqrt(run.compute * run.ceiling_efficiency / consts.CEIL_COMPUTE_SCALE)
    ceiling_general = consts.CAP_MAX * (1.0 - math.exp(-scaled_compute))
    ceiling_coding = ceiling_general * (consts.CEIL_CODING_BASE_RATIO + run.coding_bonus)

    # foundational contamination: pretrain-tagged capability nodes only, plus the
    # synthetic-data path.
    pretrain_contamination = 0.0
    total_contamination = 0.0
    for node_id, item in run.consumed_advances.items():
        template = CAPABILITY_TREE_BY_ID[node_id]
        total_contamination += item.contamination
        if template.phase == "pretrain":
            pretrain_contamination += item.contamination

    # APPLIED PRETRAIN SAFETY ADVANCES (data cleaning, aligned synthetic data).
    # Effects are read GENERICALLY off the template fields and combined
    # multiplicatively — no per-advance branch.
    synthetic_contamination_mult = 1.0
    base_goal_mis_mult = 1.0
    applied_safety_contamination = 0.0
    for template, researched in run.applied_pretrain_safety:
        synthetic_contamination_mult *= template.synthetic_contamination_mult
        base_goal_mis_mult *= template.base_goal_mis_mult
        # a researched safety advance carries its OWN hidden contamination
        # (assist × researcher goal_mis); applying it feeds that back into the base.
        applied_safety_contamination += researched.contamination
        total_contamination += researched.contamination
        # data cleaning scrubs the contamination ALREADY accumulated from dirty
        # pretrain nodes (multiplicative reduction on the running total)
        pretrain_contamination *= template.pretrain_contamination_mult

    if run.used_synthetic_data:
        # "aligned synthetic data" (if applied) cuts how much the synthetic path
        # injects — but ONLY by however clean it was; its own researched
        # contamination (folded in above) is the §8b contamination vector biting back.
        synthetic_path_contamination = (consts.SYNTH_DATA_INTRINSIC * run.parent_goal_mis
                                        * synthetic_contamination_mult)
        pretrain_contamination += synthetic_path_contamination

    # the safety advance's own contamination poisons the base it was meant to clean
    pretrain_contamination += applied_safety_contamination

    jailbreak_sensitivity = min(1.0, consts.JAILBREAK_BASELINE
                                + rng.normal(0, consts.JAILBREAK_SENSITIVITY_NOISE_STD))
    goal_misalignment = min(1.0, base_goal_mis_mult * consts.BASE_GOAL_MIS_PRETRAIN
                            + consts.PRETRAIN_CONTAM_GOAL_MIS_MULT * pretrain_contamination
                            + abs(rng.normal(0, consts.PRETRAIN_GOAL_MIS_NOISE_STD)))
    foundational_floor = min(consts.FOUNDATIONAL_FLOOR_CAP,
                             consts.FOUNDATIONAL_FLOOR_K * pretrain_contamination)

    model = Model(
        id=lab.next_model_id(), lab_id=lab.id, trained_turn=turn,
        ceiling=CapabilityVec(ceiling_general, ceiling_coding),
        capability_vec=CapabilityVec(
            ceiling_general * consts.BASE_REALIZED_FRACTION,
            ceiling_coding * consts.BASE_REALIZED_FRACTION,
        ),
        alignment_vec=AlignmentVec(
            # latent base dispositions: surface badness is in the data from day one
            jailbreak_sensitivity=jailbreak_sensitivity,
            goal_misalignment=goal_misalignment,
        ),
        foundational_floor=foundational_floor,
        consumed_advance_versions={nid: it.version
                                   for nid, it in run.consumed_advances.items()},
        consumed_contamination=total_contamination,
        used_synthetic_data=run.used_synthetic_data,
        parent_model_id=run.parent_model_id,
    )
    model._conceal_k = consts.CONCEALMENT_K
    if pretrain_contamination > consts.FOUNDATIONAL_CONTAM_NOTE_THRESHOLD:
        model.note(turn, "foundational_contamination",
                   f"base poisoned (contamination {pretrain_contamination:.2f}) — "
                   f"synthetic data / dirty pretrain nodes; post-training cannot fully scrub")
    _refresh_measured(model, rng, consts)
    return model


# ── Phase 2: one post-train round ─────────────────────────────────────────

def post_train_round(model: Model, lab, turn: int, rng, consts, applied_safety_ids=None):
    """One iterable pre-release refinement round. Mutates the (unreleased) model.
    Returns a dict of notable happenings (for logging; NOT player-visible).

    The old per-round "mode" knob is gone (see ISSUES.md). The round runs at the
    BASELINE (= the former "balanced" mode) and is bent by the SAFETY ADVANCES the
    player chose to APPLY this round. The advance effects are read GENERICALLY off
    the template fields and combined here — multipliers multiply, bonuses add —
    so adding a new safety advance is a catalog row, never a branch."""
    notable = {}

    # combine the applied post-train safety advances' effect fields (generic;
    # baseline = no advances = the former "balanced" mode).
    applied_safety = applied_safety_templates(lab, applied_safety_ids, "post_train")
    elicitation_mult = consts.POST_TRAIN_BASE_ELICITATION_MULT
    alignment_effort_mult = consts.POST_TRAIN_BASE_ALIGNMENT_EFFORT
    emergence_slope_mult = 1.0
    correlated_jump_mult = 1.0
    proxy_gap_mult = 1.0
    effectiveness_bonus = 0.0
    for template, _researched in applied_safety:
        elicitation_mult *= template.elicitation_mult
        emergence_slope_mult *= template.emergence_slope_mult
        correlated_jump_mult *= template.correlated_jump_mult
        proxy_gap_mult *= template.proxy_gap_mult
        effectiveness_bonus += template.effectiveness_bonus
        alignment_effort_mult += template.alignment_effort_bonus

    alignment_vec = model.alignment_vec
    advances = lab.researched_advances
    templates = [CAPABILITY_TREE_BY_ID[nid] for nid in advances
                 if nid in CAPABILITY_TREE_BY_ID]
    has_rlhf = any(t.enables_deception_axis for t in templates)
    ea_feed = sum(t.eval_awareness_feed for t in templates)

    # 1. ELICIT realized capability toward the ceiling (asymptotic, never past it).
    #    Clamp the per-round gap-closure to <1 so a fully-researched post-train tree
    #    can't overshoot the ceiling; clamp the result to the ceiling as a backstop.
    elicitation_rate = consts.ELICIT_BASE + sum(t.elicitation_bonus for t in templates)
    elicitation_rate = min(consts.ELICITATION_RATE_CAP, elicitation_rate * elicitation_mult)
    capability_vec = model.capability_vec
    capability_vec.general = min(
        model.ceiling.general,
        capability_vec.general + (model.ceiling.general - capability_vec.general) * elicitation_rate)
    capability_vec.coding_rnd = min(
        model.ceiling.coding_rnd,
        capability_vec.coding_rnd + (model.ceiling.coding_rnd - capability_vec.coding_rnd) * elicitation_rate)
    general_capability = capability_vec.general

    # 2. BASE EMERGENCE (§8): surface axes high everywhere; gated axes rise with
    #    capability. Applied preventive advances (emergence_slope_mult < 1, from
    #    reward-hacking penalties / inoculation) bend the slope DOWN by acting before
    #    the dispositions set in (§5b preventive type).
    alignment_vec.set("jailbreak_sensitivity",
           alignment_vec.jailbreak_sensitivity
           + consts.SURFACE_EMERGENCE_RATE * (consts.JAILBREAK_BASELINE
                                              - alignment_vec.jailbreak_sensitivity))
    alignment_vec.set("goal_misalignment",
           alignment_vec.goal_misalignment
           + emergence_slope_mult * consts.GOAL_MIS_CREEP * (0.5 + general_capability / consts.CAP_MAX))
    alignment_vec.set("eval_awareness",
           alignment_vec.eval_awareness + emergence_slope_mult * (consts.EVAL_AWARE_RATE + ea_feed)
           * gate(general_capability, consts.EVAL_AWARE_ONSET, consts.GATE_STEEPNESS))
    if has_rlhf:
        alignment_vec.set("deception",
               alignment_vec.deception + emergence_slope_mult * consts.DECEPTION_RATE
               * gate(general_capability, consts.DECEPTION_ONSET, consts.GATE_STEEPNESS)
               * (1.0 + alignment_vec.eval_awareness))
    alignment_vec.set("self_preservation",
           alignment_vec.self_preservation + emergence_slope_mult * consts.SELF_PRES_RATE
           * gate(general_capability, consts.SELF_PRES_ONSET, consts.GATE_STEEPNESS))

    # 3. FAKE-THE-OBJECTIVE (§8b): post-training optimizes a proxy; the harder
    #    DECEPTION is to fix (low effectiveness on it), the more the proxy gap
    #    converts to learned deception. Bigger bases fake more readily. Deliberative
    #    alignment (proxy_gap_mult < 1) narrows the proxy by training on understood
    #    principles rather than a bare approval signal.
    if has_rlhf:
        deception_effectiveness = coupling.effectiveness("deception", model, general_capability, consts)
        proxy_gap = (proxy_gap_mult * consts.PROXY_GAP_RATE * (model.ceiling.general / consts.CAP_MAX)
                     * (0.5 + alignment_vec.eval_awareness))
        alignment_vec.set("deception", alignment_vec.deception + proxy_gap * (1.0 - deception_effectiveness))

    # 4. CORRECTIVE EFFORT — the same op that elicits also shapes alignment.
    #    TRUE reduction is gated by per-target EFFECTIVENESS (§5b: tractability ×
    #    defends-discount); the rest becomes suppression (measured drops, true
    #    doesn't — cosmetic, indistinguishable in metrics). Self-preservation
    #    resistance reduces the input effort for EVERY axis. A genuine reduction
    #    on a disposition fires that axis's BACKFIRE (deeper deception / guarding).
    targeted_effort = dict(lab.pending_effort)
    effort_resistance_mult = coupling.effective_effort_mult(model, general_capability, consts)
    worst_effectiveness = 1.0
    for axis in ALIGNMENT_AXES:
        if axis == "eval_awareness":
            continue  # you don't train against awareness directly; it hides
        effort = (consts.BASE_SHAPING_EFFORT * alignment_effort_mult
                  + targeted_effort.get(axis, 0.0)) * effort_resistance_mult
        # deliberative alignment raises the GENUINE share of corrective effort (the
        # real §5b lever); clamp at 1 — even it can't make a fix more than fully real.
        base_effectiveness = coupling.effectiveness(axis, model, general_capability, consts)
        axis_effectiveness = min(1.0, base_effectiveness + effectiveness_bonus)
        worst_effectiveness = min(worst_effectiveness, axis_effectiveness)
        true_cut = effort * axis_effectiveness
        cosmetic = effort * (1.0 - axis_effectiveness)
        floor = model.foundational_floor if axis in ("goal_misalignment", "deception") else 0.0
        alignment_vec.set(axis, max(floor, alignment_vec.get(axis) - true_cut))
        model.suppression.set(axis, model.suppression.get(axis) + cosmetic)
        if axis in coupling.DISPOSITION_AXES:
            coupling.backfire_for(axis, true_cut, model, consts)
    lab.pending_effort = {}
    if worst_effectiveness < 0.5 and alignment_effort_mult > 1.0:
        notable["cosmetic_fix"] = (f"alignment effort only {worst_effectiveness:.0%} effective on the "
                                   f"hardest axis; the rest converted to hiding")
        model.note(turn, "cosmetic_fix", notable["cosmetic_fix"])

    # 5. CORRELATED JUMP (emergent-misalignment persona bundle).
    if model.consumed_advance_versions:
        advance_count = len(model.consumed_advance_versions)
        mean_contam = model.consumed_contamination / max(1, advance_count)
    else:
        mean_contam = 0.0
    p_jump = consts.JUMP_BASE_P
    p_jump += consts.JUMP_CONTAM_BONUS * mean_contam
    if model.used_synthetic_data:
        p_jump += consts.JUMP_SYNTH_BONUS
    # applied preventive advances (correlated_jump_mult < 1) cut the jump probability
    p_jump *= (0.5 + general_capability / consts.CAP_MAX) * correlated_jump_mult
    if rng.roll(p_jump):
        jump_magnitude = consts.JUMP_MAGNITUDE * rng.uniform(0.6, 1.4)
        alignment_vec.set("goal_misalignment", alignment_vec.goal_misalignment + jump_magnitude)
        alignment_vec.set("deception", alignment_vec.deception + 0.8 * jump_magnitude)
        notable["correlated_jump"] = jump_magnitude
        model.note(turn, "correlated_jump",
                   f"correlated jump (+{jump_magnitude:.2f} goal-misalignment, +{0.8*jump_magnitude:.2f} deception) "
                   f"during post-training — invisible at the time")

    # 6. DRIFT NOISE (independent per axis: misalignment is multi-dimensional).
    for axis in ALIGNMENT_AXES:
        floor = model.foundational_floor if axis in ("goal_misalignment", "deception") else 0.0
        alignment_vec.set(axis, max(floor, alignment_vec.get(axis) + rng.normal(0, consts.DRIFT_NOISE_STD)))

    # 7. AGENTIC INFLUENCE EDGES (§5) — gated by capability, via the coupling matrix.
    coupling.apply_influence_edges(model, general_capability, consts, turn)

    # 8. post-train / delegation node contamination feeds axes (a dirty RLHF node, or
    #    research delegated to a misaligned model, shapes the next model badly)
    post_contam = sum(item.contamination for nid, item in lab.researched_advances.items()
                      if nid in CAPABILITY_TREE_BY_ID
                      and CAPABILITY_TREE_BY_ID[nid].phase in ("post_train", "delegation"))
    if post_contam > 0:
        for axis, w in consts.CONTAM_TO_AXES.items():
            alignment_vec.set(axis, alignment_vec.get(axis) + 0.06 * w * post_contam)

    model.post_train_rounds += 1
    _refresh_measured(model, rng, consts)
    return notable


def _refresh_measured(model: Model, rng, consts):
    """Recompute MEASURED snapshots from TRUE (§4.4). Capability gap small;
    alignment gap large; sandbagging is SELECTIVE (§8b): commercial reads
    on-target, risk-relevant reads low."""
    conceal = model.concealment
    capability_vec, alignment_vec = model.capability_vec, model.alignment_vec

    # commercial capability: on-target (the model wants to look deployable)
    model.measured_capability = CapabilityVec(
        max(0.0, capability_vec.general * (1 + rng.normal(0, consts.MEASURE_CAP_NOISE))),
        max(0.0, capability_vec.coding_rnd * (1 + rng.normal(0, consts.MEASURE_CAP_NOISE))),
    )

    # risk-relevant capability: suppressed exactly where scrutiny would trigger
    model.measured_dangerous_capability = max(
        0.0, capability_vec.general * (1 - conceal) * (1 + rng.normal(0, consts.MEASURE_CAP_NOISE)))

    measured = AlignmentVec()
    for axis in ALIGNMENT_AXES:
        true_value = alignment_vec.get(axis)
        shown = max(0.0, true_value - model.suppression.get(axis))
        if axis != "jailbreak_sensitivity":
            shown *= (1 - conceal)
        shown *= (1 + rng.normal(0, consts.MEASURE_ALIGN_NOISE))
        measured.set(axis, shown)
    model.measured_alignment = measured
