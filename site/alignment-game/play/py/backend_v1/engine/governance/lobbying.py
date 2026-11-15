"""Lobbying (§10c, REVISED — SCALABLE SPEND). A lab picks a stance per policy
(for/against/abstain) AND a spend amount. Influence is

    influence = LOBBY_SPEND_K·sqrt(spend) × (1 + LOBBY_LOG_K·log(cap/ref))

— sqrt gives diminishing returns within a turn's spend; the log-cap multiplier
gives incumbents a per-dollar edge (regulatory capture as a felt tendency, not a
stranglehold: a determined mid-size lab can still move a policy). Signed by
stance, it feeds a per-policy HYBRID DECAYING tally that drives enactment.
"""
import math

STANCE_SIGN = {"for": 1, "against": -1, "abstain": 0}


def cap_multiplier(market_cap, consts):
    raw = 1.0 + consts.LOBBY_LOG_K * math.log(max(market_cap, 1.0) / consts.LOBBY_REFERENCE_CAP)
    return max(consts.LOBBY_MIN_CAP_MULT, raw)


def lobby_influence(spend, market_cap, consts):
    """Unsigned influence points from spending `spend` ($M) at this market cap."""
    if spend <= 0:
        return 0.0
    return consts.LOBBY_SPEND_K * math.sqrt(spend) * cap_multiplier(market_cap, consts)


def signed_influence(stance, spend, market_cap, consts):
    """Stage-INDEPENDENT signed influence; the lifecycle decides what it buys at
    each stage (passage swing / sign swing / enforcement drift)."""
    sign = STANCE_SIGN.get(stance, 0)
    if sign == 0:
        return 0.0
    return sign * lobby_influence(spend, market_cap, consts)
