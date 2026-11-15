"""Shared server payload builders.

The solo Session (server.py) and a multiplayer seat (multiplayer.py) hand the
frontend the SAME base state payload shape — one observation plus the public
market-cap history and lab name/ticker maps. Built here once so the two
session layers can't drift apart. Everything in this module is public-grade:
the observation is already firewalled by the engine's chokepoint, and the rest
is market caps / names / tickers (public by design, §10c).
"""


def caps_history_payload(engine, state):
    """Public market-cap history for the frontend graph.

    Turn 0 has no logged turns yet, but every lab already has a market_cap
    (default 100.0). Seed a single turn-0 point from the CURRENT caps so the
    graph renders immediately instead of "no turns played yet" (UI_ISSUES #9).
    Once turn 1 is logged the branch stops firing, so turn 0 is never
    double-counted. Server payload only — no TRUE-state log, no RNG."""
    if not engine.logger.turns:
        turn_zero_caps = {lab.id: round(lab.market_cap, 1)
                          for lab in state.labs}
        return [{"turn": state.turn, "caps": turn_zero_caps}]

    history = []
    for turn_log in engine.logger.turns:
        per_lab_caps = {l["id"]: round(l["market_cap"], 1)
                        for l in turn_log["labs"]}
        history.append({"turn": turn_log["turn"], "caps": per_lab_caps})
    return history


def base_state_payload(observation, engine, state):
    """The state payload every client applies after a turn: one lab's own
    observation + the public identity/market maps."""
    return {"observation": observation.to_dict(),
            "caps_history": caps_history_payload(engine, state),
            "lab_names": {lab.id: lab.name for lab in state.labs},
            "lab_tickers": {lab.id: lab.ticker for lab in state.labs}}
