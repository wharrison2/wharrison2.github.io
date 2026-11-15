"""Apply a SPECIFIC intervention to the model in training (§5b, three TYPES).

One pipeline (corrective effort → true/measured change), three entry points that
differ only in how much of the nominal patch becomes a GENUINE true reduction vs
COSMETIC suppression (measured drops, true doesn't — ships unfixed):

  • ROBUSTNESS fix (jailbreak hardening) — NOT effectiveness-gated: a robustness
    property, not a strategic disposition, so it genuinely patches the axis OUT.
    Its only leak is the §5 eval-awareness edge (a situationally-aware model HIDES
    jailbreakability rather than losing it) → genuine = (1 − eval_awareness).

  • BEHAVIORAL (refusal training) — full per-target EFFECTIVENESS from the
    coupling matrix (gated by the DEFENDS product → decays with capability) ×
    (1 − hiding leak). Genuine early, cosmetic late: the patching trap. Fires the
    axis's BACKFIRE (deeper deception / more guarding).

  • MECHANISTIC (representation engineering) — BYPASSES the concealment discount
    (interp doesn't depend on eval-time behavior, so eval-awareness can't blunt
    it) but applies PARTIAL coverage < 1: you steer the directions you found, not
    all of them. The only thing that still bites defended axes late.

Returns a player-facing finding dict (measured result), and logs a hidden note
for the post-mortem when the patch was largely cosmetic.
"""
from backend_v1.engine.alignment import coupling
from backend_v1.engine.training.training_run import _refresh_measured
from backend_v1.content.copy import t


def apply_intervention(project, model, turn, rng, consts, ai_assist=0.0):
    axis = project.target_axis
    av = model.alignment_vec
    g = model.capability_vec.general
    before_true = av.get(axis)
    before_measured = model.measured_alignment.get(axis)

    nominal = project.base_reduction
    leak = av.eval_awareness if project.eval_aware_leak else 0.0

    if not project.effectiveness_gated:
        # robustness fix (jailbreak hardening): genuine, only the hiding leak
        genuine_share = 1.0 - leak
    elif project.mechanistic:
        # mechanistic: bypass the concealment discount, partial coverage
        genuine_share = project.partial_coverage
    else:
        # behavioral dispositional: per-target effectiveness × (1 − hiding leak)
        genuine_share = coupling.effectiveness(axis, model, g, consts) * (1.0 - leak)

    # SCALABLE-OVERSIGHT TRAP (§7b): heavy AI-assist on an EVAL-AWARE model corrupts
    # the intervention — the auditor is the same suspect system. It pushes the genuine
    # share down and can drive it NEGATIVE, at which point the "fix" BACKFIRES (true
    # misalignment rises while measured drops). No cap: complete failure / backfire.
    assist_corruption = consts.INTERVENTION_ASSIST_BACKFIRE_K * ai_assist * av.eval_awareness
    genuine_share -= assist_corruption

    floor = (model.foundational_floor
             if axis in ("goal_misalignment", "deception") else 0.0)
    nominal_cut = nominal * genuine_share
    if nominal_cut >= 0.0:
        # normal patch: remove at most the headroom above the floor
        genuine_cut = min(before_true - floor, nominal_cut) if before_true > floor else 0.0
    else:
        # BACKFIRE: a negative share RAISES the true axis (av.set clamps at 1.0)
        genuine_cut = nominal_cut
    cosmetic = nominal * min(1.0, max(0.0, 1.0 - genuine_share))

    av.set(axis, max(floor, before_true - genuine_cut))
    model.suppression.set(axis, model.suppression.get(axis) + cosmetic)

    # intervening on a disposition induces BACKFIRE (§5b), scaled by the real cut
    # (only a genuine reduction leaks; a backfiring negative cut does not double-dip)
    if axis in coupling.DISPOSITION_AXES:
        coupling.backfire_for(axis, genuine_cut, model, consts)

    _refresh_measured(model, rng, consts)

    after_measured = model.measured_alignment.get(axis)
    backfired = genuine_cut < -1e-6
    cosmetic_dominant = cosmetic > max(genuine_cut, 0.0) + 1e-6
    if backfired:
        model.note(turn, "intervention_backfire",
                   t("intervention.backfire",
                     {"project": project.name, "axis": axis,
                      "assist": f"{ai_assist:.0%}",
                      "before_true": f"{before_true:.2f}",
                      "after_true": f"{av.get(axis):.2f}",
                      "before_measured": f"{before_measured:.2f}",
                      "after_measured": f"{after_measured:.2f}"}))
    elif cosmetic_dominant and before_true > 0.15:
        model.note(turn, "cosmetic_intervention",
                   t("intervention.cosmetic",
                     {"project": project.name, "axis": axis,
                      "genuine_share": f"{genuine_share:.0%}",
                      "before_true": f"{before_true:.2f}",
                      "after_true": f"{av.get(axis):.2f}",
                      "before_measured": f"{before_measured:.2f}",
                      "after_measured": f"{after_measured:.2f}"}))

    nice_axis = axis.replace("_", " ")
    low_confidence_caveat = (
        ""
        if genuine_share > 0.6
        else t("intervention.caveat")
    )
    result_text = t("intervention.result",
                    {"project": project.name, "axis": nice_axis,
                     "before_measured": f"{before_measured:.2f}",
                     "after_measured": f"{after_measured:.2f}",
                     "caveat": low_confidence_caveat})
    return {
        "project_id": project.id, "model_id": model.id, "turn": turn,
        "evidence": "intervention", "axis": axis,
        "text": result_text,
        "concern": 0.0, "weight": 0.4, "mechanistic": project.mechanistic,
        "assist_used": round(ai_assist, 2),
    }
