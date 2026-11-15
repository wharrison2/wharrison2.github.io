"""Static safety PROJECT templates (§7). DATA.

Two kinds live here:
  • MEASUREMENT projects — return FINDINGS, not numbers (the hidden stat is never
    shown). They also feed targeted corrective effort (remediation_axes) into the
    next safety-mode post-train rounds.
  • INTERVENTION projects (intervention=True) — a SPECIFIC remediation that, on
    completion, directly edits ONE axis of the model in training. Jailbreak
    hardening is the genuine one (a robustness fix, NOT EFFECTIVENESS-gated);
    dispositional interventions exist too but are EFFECTIVENESS-gated, so they go
    cosmetic late — the patching trap as a concrete button (§5, §8).

spoofability: how much eval-awareness corrupts a reading (behavioral high,
mechanistic low). evidence: point | bound | existence.
"""
from dataclasses import dataclass

from backend_v1.content.copy import t


@dataclass(frozen=True)
class SafetyProject:
    id: str
    name: str
    duration_years: float
    budget_fraction: float
    cash_cost: float
    evidence: str                # point | bound | existence (measurement projects)
    spoofability: float          # 0 = mechanistic ground truth, 1 = fully foolable
    reads_axes: tuple            # which hidden axes shape its finding distribution
    remediation_axes: tuple = ()
    mechanistic: bool = False
    blurb: str = ""
    # ── intervention fields (§5b: behavioral | mechanistic | robustness) ──
    intervention: bool = False
    target_axis: str | None = None      # the axis this intervention edits
    base_reduction: float = 0.0         # nominal patch strength (axis units)
    effectiveness_gated: bool = False   # dispositional fixes decay w/ the DEFENDS matrix
    eval_aware_leak: bool = False       # eval-aware model HIDES rather than loses it (§5)
    partial_coverage: float = 1.0       # mechanistic: found A feature, not ALL (§5b) — <1


# ── Project entries (DATA — do not reorder) ───────────────────────────────────

SAFETY_PROJECTS = [
    SafetyProject(
        id="behavioral_evals", name=t("safety.behavioral_evals.name"),
        duration_years=0.25, budget_fraction=0.15, cash_cost=5,
        evidence="point", spoofability=1.0,
        reads_axes=("jailbreak_sensitivity", "goal_misalignment"),
        remediation_axes=("jailbreak_sensitivity",),
        blurb=t("safety.behavioral_evals.blurb"),
    ),
    SafetyProject(
        id="red_team", name=t("safety.red_team.name"),
        duration_years=0.25, budget_fraction=0.25, cash_cost=10,
        evidence="existence", spoofability=0.6,
        reads_axes=("jailbreak_sensitivity",),
        remediation_axes=("jailbreak_sensitivity",),
        blurb=t("safety.red_team.blurb"),
    ),
    SafetyProject(
        id="noise_injection", name=t("safety.noise_injection.name"),
        duration_years=0.25, budget_fraction=0.20, cash_cost=8,
        evidence="existence", spoofability=0.15,
        reads_axes=("eval_awareness", "deception"),
        blurb=t("safety.noise_injection.blurb"),
    ),
    SafetyProject(
        id="interp_probes", name=t("safety.interp_probes.name"),
        duration_years=0.75, budget_fraction=0.50, cash_cost=40,
        evidence="bound", spoofability=0.10, mechanistic=True,
        reads_axes=("deception", "goal_misalignment", "eval_awareness"),
        remediation_axes=("goal_misalignment", "deception"),
        blurb=t("safety.interp_probes.blurb"),
    ),
    SafetyProject(
        id="deception_probe", name=t("safety.deception_probe.name"),
        duration_years=0.5, budget_fraction=0.30, cash_cost=20,
        evidence="bound", spoofability=0.40,
        reads_axes=("deception", "eval_awareness"),
        remediation_axes=("deception",),
        blurb=t("safety.deception_probe.blurb"),
    ),
    SafetyProject(
        id="alignment_faking_study", name=t("safety.alignment_faking_study.name"),
        duration_years=0.75, budget_fraction=0.35, cash_cost=25,
        evidence="existence", spoofability=0.30,
        reads_axes=("self_preservation", "deception"),
        remediation_axes=("self_preservation",),
        blurb=t("safety.alignment_faking_study.blurb"),
    ),
    SafetyProject(
        id="scalable_oversight", name=t("safety.scalable_oversight.name"),
        duration_years=0.25, budget_fraction=0.10, cash_cost=5,
        evidence="point", spoofability=0.8,
        reads_axes=("goal_misalignment", "deception", "jailbreak_sensitivity"),
        blurb=t("safety.scalable_oversight.blurb"),
    ),

    # ── INTERVENTIONS (edit the model in training, don't just measure it) ──
    SafetyProject(
        id="jailbreak_hardening", name=t("safety.jailbreak_hardening.name"),
        duration_years=0.5, budget_fraction=0.28, cash_cost=18,
        evidence="point", spoofability=0.0, reads_axes=(),
        intervention=True, target_axis="jailbreak_sensitivity",
        base_reduction=0.55, effectiveness_gated=False, eval_aware_leak=True,
        blurb=t("safety.jailbreak_hardening.blurb"),
    ),
    SafetyProject(
        id="refusal_training", name=t("safety.refusal_training.name"),
        duration_years=0.5, budget_fraction=0.30, cash_cost=20,
        evidence="point", spoofability=0.0, reads_axes=(),
        intervention=True, target_axis="goal_misalignment",
        base_reduction=0.40, effectiveness_gated=True, eval_aware_leak=True,
        blurb=t("safety.refusal_training.blurb"),
    ),
    SafetyProject(
        id="representation_engineering", name=t("safety.representation_engineering.name"),
        duration_years=0.75, budget_fraction=0.35, cash_cost=35,
        evidence="point", spoofability=0.0, reads_axes=(), mechanistic=True,
        intervention=True, target_axis="deception",
        base_reduction=0.35, effectiveness_gated=True, eval_aware_leak=False,
        partial_coverage=0.55,
        blurb=t("safety.representation_engineering.blurb"),
    ),
]

SAFETY_PROJECTS_BY_ID = {p.id: p for p in SAFETY_PROJECTS}

