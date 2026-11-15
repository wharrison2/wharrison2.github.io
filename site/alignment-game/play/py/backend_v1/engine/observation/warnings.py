"""§7c WARNING layer — diegetic, magnitude-FREE, mechanism-teaching warnings
attached to risky choices. DATA (plus a small payload helper).

Per design §7c / §0 this is the game's PRIMARY educational surface and a
first-class content deliverable. Every warning does three jobs at once:
  1. teaches the real MECHANISM in plain language (WHY, never just "that"),
  2. conveys risk DIRECTION/ACTIVATION but never MAGNITUDE (no numbers, no tiers
     the player could min-max against),
  3. speaks diegetically, in the voice of "your researchers".

They live here, in ONE place, so the whole set gets a single accuracy-review
pass, and are served to the frontend as data — the frontend renders them in the
per-item "explain it, then carry it out" modal (the §7c "education at the moment
of choosing").

Layered depth (§7c): `line` (one-line diegetic warning, always shown)
  -> `why` (plain-language mechanism, expandable)
  -> `paper` (real reference, opt-in; None where we have no clean single source).

ACCURACY FLAGS for the content-review pass (per §0: the assistant's optimism
bias is a liability here — flag, don't smooth over):
  • high_ai_assist — "contamination rides in through model-assisted research" is
    a forward-looking synthesis of the doc's §8b contamination model, not a
    single published result. Sleeper Agents (hidden behavior survives safety
    training) is the nearest real anchor; cited as background, not proof.
  • elicitation_pressure — grounded in goal misgeneralization (the model learns a
    proxy that looks right in training); the "pressure causes it" framing is the
    doc's, slightly stronger than the literature states. Verify before shipping.
  • behavioral_patch — well grounded (training against a detected behavior can
    teach concealment rather than removal); Greenblatt et al. 2024 is a direct
    anchor.
  • release — a structural fact (irreversibility), not an empirical claim; no
    paper needed.
All copy below is a DRAFT for that review, not final content.
"""
from backend_v1.content.copy import t

# id -> {line, why, paper}.  paper is None or {"title": str, "url": str}.
# Text values are folded into the central copy table (content/copy.py) and
# referenced via t(); the paper URL stays here as data (a URL is not editable copy).
CATALOG = {
    "high_ai_assist": {
        "line": t("warning.high_ai_assist.line"),
        "why": t("warning.high_ai_assist.why"),
        "paper": {"title": t("warning.high_ai_assist.paper_title"),
                  "url": "https://arxiv.org/abs/2401.05566"},
    },
    "elicitation_pressure": {
        "line": t("warning.elicitation_pressure.line"),
        "why": t("warning.elicitation_pressure.why"),
        "paper": {"title": t("warning.elicitation_pressure.paper_title"),
                  "url": "https://arxiv.org/abs/2210.01790"},
    },
    "behavioral_patch": {
        "line": t("warning.behavioral_patch.line"),
        "why": t("warning.behavioral_patch.why"),
        "paper": {"title": t("warning.behavioral_patch.paper_title"),
                  "url": "https://arxiv.org/abs/2412.14093"},
    },
    "release": {
        "line": t("warning.release.line"),
        "why": t("warning.release.why"),
        "paper": None,
    },
    "release_high_concern": {
        "line": t("warning.release_high_concern.line"),
        "why": t("warning.release_high_concern.why"),
        "paper": None,
    },
}

# Disposition axes (§5): the ones whose interventions are EFFECTIVENESS-gated and
# thus prone to the patching trap. jailbreak_sensitivity is deliberately excluded
# (it's the cleanly-patchable robustness axis, §7b).
DISPOSITION_AXES = ("goal_misalignment", "deception", "self_preservation")

# Above this assist level the modal should EMPHASISE the contamination warning
# (still shown, dimmer, below it). Direction/activation, not a magnitude claim.
HIGH_ASSIST_EMPHASIS = 0.5

# worry_bar.level at/above which the release warning swaps to its sharpened
# "high concern" variant (mirrors findings.synthesize_worry_bar's "HIGH concern").
RELEASE_CONCERN_LEVEL = 0.5


def warning_payload():
    """Data the frontend needs to attach warnings to items in the per-item modal.
    Pure DATA — no true stats cross here; the release sharpening keys off
    worry_bar, which is already in the player observation."""
    return {
        "catalog": CATALOG,
        # which warning each kind of choice carries; the frontend looks these up
        # against the item it's rendering a modal for.
        "assist": "high_ai_assist",
        "assist_emphasis_threshold": HIGH_ASSIST_EMPHASIS,
        # the post-train mode knob is gone; a bare post-train round (no safety
        # advances applied) still carries the elicitation-pressure warning.
        "post_train": "elicitation_pressure",
        "intervention_disposition": "behavioral_patch",
        "disposition_axes": list(DISPOSITION_AXES),
        "release": "release",
        "release_high_concern": "release_high_concern",
        "release_concern_level": RELEASE_CONCERN_LEVEL,
    }
