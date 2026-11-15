"""Action economics — the single source of truth for budget/cost rules.

Three consumers must agree exactly on how an action costs work-budget and cash:
  • actions.validate_action  — the pre-flight legality check
  • turn_pipeline._apply_action — the mutate path
  • actions.legal_moves / observation_builder — what the UI previews

Previously each recomputed the budget pool, the in-flight commitment, and the
AI-assist-reduced project fraction independently (drift hazard on any tuning
change). They now all call through here.
"""
from backend_v1.engine.research.capabilities.capabilities_research_item import (
    CAPABILITY_TREE_BY_ID,
)
from backend_v1.engine.research.safety.safety_research_item import SAFETY_PROJECTS_BY_ID
from backend_v1.engine.research.safety.safety_advance_item import SAFETY_ADVANCES_BY_ID


def budget_pool(lab, dt):
    """Total work-budget fraction available this turn (the quarterly pool)."""
    return lab.work_budget_per_year * dt


def committed_budget(lab):
    """Work budget already locked into in-flight projects."""
    return sum(p.budget_fraction_effective for p in lab.in_progress)


def project_template(pid):
    """(template, kind) for a project id; (None, None) if unknown.
    kind is 'capability', 'safety_advance', or 'safety'.

    'capability'    — a capability tech-tree advance (CAPABILITY_TREE_BY_ID).
    'safety_advance'— a researched SAFETY advance that shapes training runs
                      (SAFETY_ADVANCES_BY_ID); lands in lab.researched_advances with
                      contamination, exactly like a capability advance.
    'safety'        — a safety PROJECT (measurement/intervention; SAFETY_PROJECTS_BY_ID).
    """
    t = CAPABILITY_TREE_BY_ID.get(pid)
    if t is not None:
        return t, "capability"
    t = SAFETY_ADVANCES_BY_ID.get(pid)
    if t is not None:
        return t, "safety_advance"
    t = SAFETY_PROJECTS_BY_ID.get(pid)
    if t is not None:
        return t, "safety"
    return None, None


def applied_post_train_round_budget(applied_safety_ids, consts):
    """Work-budget a post-train round costs: the baseline round budget plus the
    extra each APPLIED post-train safety advance adds (single source of truth for
    validate_action, the mutate path, and the CLI/legal-moves preview). Unknown or
    wrong-phase ids contribute nothing."""
    total = consts.POST_TRAIN_ROUND_BUDGET
    for advance_id in applied_safety_ids or []:
        template = SAFETY_ADVANCES_BY_ID.get(advance_id)
        if template is not None and template.phase == "post_train":
            total += template.round_budget
    return total


def assist_potency(lab, consts, clamp=1.0):
    """How effective the assisting model is at research labor: gated by its coding
    capability (early models can't help) and boosted by assist-potency advances
    (AI-assisted R&D, automated researcher, RSI). The capability term is the SAME
    number that drives danger, so cranking assist late is the squeeze.
    `clamp` caps the result: 1.0 for budget reduction (can't free more than the
    whole project); higher for the duration speedup, so a very capable model gives
    near-superhuman research speed."""
    m = lab.assisting_model()
    if m is None:
        return 0.0
    # coding drives research labor (§4.1); general blended in so a broadly capable
    # model also speeds research, matching the "esp. high general" intuition
    base = max(m.capability_vec.coding_rnd, 0.85 * m.capability_vec.general)
    potency = base / consts.CAP_MAX
    for nid, t in CAPABILITY_TREE_BY_ID.items():
        if t.assist_potency_bonus and nid in lab.researched_advances:
            potency *= 1.0 + t.assist_potency_bonus
    return min(clamp, potency)


def assist_speed_potency(lab, consts):
    """Unclamped-to-1 potency for the DURATION speedup: high-capability models
    accelerate research dramatically (capped well above 1)."""
    return assist_potency(lab, consts, clamp=consts.ASSIST_SPEED_POTENCY_CAP)


def effective_fraction(base_fraction, assist, lab, consts):
    """AI-assist reduces a project's budget fraction (the incentive, §9b),
    scaled by the assisting model's research potency."""
    reduction = consts.ASSIST_MAX_REDUCTION * assist * assist_potency(lab, consts)
    return base_fraction * (1.0 - reduction)
