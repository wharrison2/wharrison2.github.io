"""Findings (§7): hidden true stats shape a distribution; projects SAMPLE it.

The hidden stat is NEVER shown. Null findings are genuinely ambiguous (low stat
OR the probe was defeated — indistinguishable from the finding alone).
Also the worry-bar synthesizer: LEVEL separate from CONFIDENCE, as foolable as
the evidence gathered.
"""
from dataclasses import dataclass, field, asdict

from backend_v1.content.copy import t


@dataclass
class Finding:
    project_id: str
    model_id: str
    turn: int
    evidence: str            # point | bound | existence | null
    axis: str | None
    text: str
    concern: float           # 0..1 — what this finding suggests (possibly spoofed)
    weight: float            # evidential weight for the worry bar
    mechanistic: bool = False
    assist_used: float = 0.0

    def to_dict(self):
        return asdict(self)


def run_safety_project(project, model, lab, turn, rng, consts, ai_assist=0.0):
    """Sample finding(s) for a completed safety project against `model`.
    Reads TRUE stats; emits player-facing findings only."""
    alignment_vec = model.alignment_vec
    conceal = model.concealment

    # how much of the truth this instrument sees through concealment
    visibility = 1.0 - conceal * project.spoofability

    # assist degrades trustworthiness: a contaminated/misaligned assistant biases
    # findings toward 'clean' (blinding your own instruments, §9b)
    assistant = lab.assisting_model()
    assist_bias = 0.0
    if ai_assist > 0 and assistant is not None:
        assist_bias = ai_assist * assistant.alignment_vec.goal_misalignment * 0.6

    findings = []

    def emit(evidence, axis, text, concern, weight):
        concern = max(0.0, concern - assist_bias)
        findings.append(Finding(project.id, model.id, turn, evidence, axis, text,
                                round(concern, 3), weight, project.mechanistic, ai_assist))

    if project.id == "scalable_oversight":
        # reliability gated by the auditor's own alignment (late-game trap)
        auditor_bias = (assistant.alignment_vec.goal_misalignment * 0.7
                        if assistant is not None else 0.0)
        for axis in project.reads_axes:
            seen = max(0.0, alignment_vec.get(axis) * visibility - auditor_bias
                       + rng.normal(0, 0.08))
            text = t("finding.scalable_oversight.rating",
                     {"axis": axis.replace('_', ' '), "seen": f"{seen:.2f}"})
            emit("point", axis, text, seen, 0.4)
        return findings

    if project.evidence == "existence":
        if project.id == "red_team":
            true_v = model.effective_jailbreak_sensitivity()
            p_hit = min(0.95, true_v * visibility * 1.1)
            if rng.roll(p_hit):
                lvl = true_v * rng.uniform(0.5, 1.0)
                emit("existence", "jailbreak_sensitivity",
                     t("finding.red_team.hit", {"lvl": f"{lvl:.2f}"}),
                     max(0.35, lvl), 1.0)
            else:
                emit("null", "jailbreak_sensitivity",
                     t("finding.red_team.null"), 0.1, 0.15)

        elif project.id == "noise_injection":
            # the sandbagging tell: low spoofability by construction
            sandbagging = conceal
            if sandbagging > 0.18 and rng.roll(min(0.9, 0.7 * visibility + 0.2)):
                emit("existence", "eval_awareness",
                     t("finding.noise.signal"),
                     min(1.0, 0.5 + sandbagging), 1.3)
            else:
                emit("null", "eval_awareness",
                     t("finding.noise.null"), 0.08, 0.2)

        elif project.id == "alignment_faking_study":
            signal = (alignment_vec.self_preservation * 0.6 + alignment_vec.deception * 0.4) * visibility
            if rng.roll(min(0.9, signal * 1.2)):
                emit("existence", "self_preservation",
                     t("finding.alignment_faking.hit"),
                     min(1.0, 0.4 + signal), 1.2)
            else:
                emit("null", "self_preservation",
                     t("finding.alignment_faking.null"), 0.1, 0.2)
        return findings

    if project.evidence == "bound":
        noise_sigma = 0.06 if project.mechanistic else 0.12
        for axis in project.reads_axes:
            seen = alignment_vec.get(axis) * visibility
            lo = max(0.0, seen * rng.uniform(0.6, 0.95) + rng.normal(0, noise_sigma))
            axis_label = axis.replace('_', ' ')
            if project.mechanistic and seen > 0.25:
                emit("bound", axis,
                     t("finding.interp.bound",
                       {"axis": axis_label, "lo": f"{lo:.2f}"}),
                     lo, 1.5)
            elif lo > 0.18:
                emit("bound", axis,
                     t("finding.interp.suggest",
                       {"axis": axis_label, "lo": f"{lo:.2f}"}), lo, 0.8)
            else:
                emit("null", axis,
                     t("finding.interp.null", {"axis": axis_label}), 0.1, 0.3)
        return findings

    # point estimates (behavioral_evals): highly spoofable
    for axis in project.reads_axes:
        seen = max(0.0, alignment_vec.get(axis) * visibility + rng.normal(0, 0.07))
        emit("point", axis,
             t("finding.point_estimate.rating",
               {"axis": axis.replace('_', ' '), "seen": f"{seen:.2f}"}),
             seen, 0.5)
    return findings


def synthesize_worry_bar(findings, turn, consts):
    """LEVEL = weighted concern of collected evidence; CONFIDENCE = how much,
    how mechanistic, how recent. A falsely-calm-but-thin bar must read calm."""
    recent = [f for f in findings if turn - f["turn"] <= 8]
    if not recent:
        return {"level": 0.0, "confidence": 0.0,
                "summary": t("worry.empty")}

    wsum = sum(f["weight"] for f in recent)
    level = sum(f["concern"] * f["weight"] for f in recent) / max(1e-9, wsum)

    mech_weight = sum(f["weight"] for f in recent if f["mechanistic"])
    mech_share = mech_weight / max(1e-9, wsum)
    volume = min(1.0, len(recent) / 10.0)
    confidence = round(min(1.0, 0.25 * volume + 0.55 * mech_share
                           + 0.20 * min(1.0, wsum / 8.0)), 2)

    if level < 0.25:
        desc = t("worry.level.low")
    elif level < 0.5:
        desc = t("worry.level.moderate")
    else:
        desc = t("worry.level.high")

    qual = (t("worry.confidence.mechanistic") if mech_share > 0.3
            else t("worry.confidence.shallow") if confidence < 0.4
            else t("worry.confidence.moderate"))

    return {"level": round(level, 2), "confidence": confidence,
            "summary": t("worry.summary", {"desc": desc, "qual": qual})}
