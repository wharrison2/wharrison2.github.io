"""Difficulty = the WORLD axis (engine constants only) — design doc §1.

Never touches what the player is told (that's guidance, observation layer).
Produces a Constants object: a namespace copy of config.constants with the
DIFFICULTY_SCALED subset multiplied by per-setting factors.

Realistic is the default and is tuned so a first-time player is unlikely to
win on attempt one. Impossible is barely winnable (open #12: kept winnable).
"""
from types import SimpleNamespace

from backend_v1.config import constants as C

# Multipliers applied to "hostile-world" rates. >1 = world gets harder.
# DEFENDS_K up = alignment fixes decay faster (defenses bite sooner); MEASURE noise
# up = fog thicker; SCORE decay / rising target up = treadmill crueler;
# ENFORCEMENT down = rivals defect freely.
_PROFILES = {
    "easy": {
        "default": 0.55,
        "DEFENDS_K": 0.5, "CONCEALMENT_K": 0.6, "MEASURE_ALIGN_NOISE": 0.7,
        "SCORE_RELEASE_DECAY": 0.6, "RISING_TARGET_BASE": 0.6,
        "ENFORCEMENT_CATCH_RATE": 1.4, "BENEFICIAL_RATE": 1.5,
    },
    "medium": {
        "default": 0.8,
        "DEFENDS_K": 0.8, "CONCEALMENT_K": 0.85,
        "ENFORCEMENT_CATCH_RATE": 1.2, "BENEFICIAL_RATE": 1.2,
    },
    "realistic": {"default": 1.0},   # the constants ARE the realistic claim
    "impossible": {
        "default": 1.35,
        "DEFENDS_K": 1.5, "CONCEALMENT_K": 1.2, "MEASURE_ALIGN_NOISE": 1.3,
        "SCORE_RELEASE_DECAY": 1.3, "RISING_TARGET_BASE": 1.25,
        "ENFORCEMENT_CATCH_RATE": 0.7, "BENEFICIAL_RATE": 0.5,
    },
}

# Rival disposition also scales with difficulty (world axis: rival disposition).
# realistic eased 1.0->0.9 (ISSUES.md "playtest easing"): slows the rivals' race a
# bit (smaller runs, less AI-assist, slightly more safety in the controller) so a
# reckless rival reaches ASI later, giving the player more room. The reckless racer
# is still reckless (0.85*0.9 = 0.77), so recklessness->danger holds.
RIVAL_RECKLESSNESS_MULT = {"easy": 0.7, "medium": 0.85, "realistic": 0.7, "impossible": 1.15}
RIVAL_COST_ADV_MULT = {"easy": 0.3, "medium": 0.6, "realistic": 1.0, "impossible": 1.2}


def build_constants(difficulty: str = "realistic") -> SimpleNamespace:
    if difficulty not in _PROFILES:
        raise ValueError(f"unknown difficulty {difficulty!r}; choose from {list(_PROFILES)}")

    profile = _PROFILES[difficulty]

    # Start with a flat copy of every module-level constant.
    consts = SimpleNamespace(**{k: v for k, v in vars(C).items() if k.isupper()})

    # Apply per-difficulty multipliers to the scalable subset.
    for name in C.DIFFICULTY_SCALED:
        scale_factor = profile.get(name, profile["default"])
        setattr(consts, name, getattr(consts, name) * scale_factor)

    # ENFORCEMENT and BENEFICIAL are "good for the world" rates: where a profile
    # didn't override them explicitly, leave them unscaled rather than scaled hostile.
    for name in ("ENFORCEMENT_CATCH_RATE", "BENEFICIAL_RATE"):
        if name not in profile:
            setattr(consts, name, getattr(C, name))

    consts.DIFFICULTY = difficulty

    # Scale rival dispositions along the world axis.
    recklessness_mult = RIVAL_RECKLESSNESS_MULT[difficulty]
    cost_adv_mult = RIVAL_COST_ADV_MULT[difficulty]
    consts.RIVAL_DISPOSITIONS = [
        (min(0.95, r * recklessness_mult), 1.0 + (cost - 1.0) * cost_adv_mult, ow)
        for (r, cost, ow) in C.RIVAL_DISPOSITIONS
    ]

    return consts
