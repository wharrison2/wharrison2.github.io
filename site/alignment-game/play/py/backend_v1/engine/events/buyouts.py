"""Buyout / relaunch event (the anti-coast mechanism).

A player can race to mid-capability, starve every rival out of the pretrain loop,
and then coast safely to victory — switching off the race the whole thesis
depends on. This phase prevents that. When the market concentrates around a
dominant leader, a struggling rival is ACQUIRED: recapitalized, renamed, and
relaunched as a hungry, corner-cutting entrant that races for the frontier
again.

The relaunch reuses the moribund lab's existing slot — `lab.id` is stable, so
every id-keyed system (market caps, observations, controllers, litigation) is
untouched; only the display name, cash, and disposition change. The board can
never be permanently cleared.
"""
from backend_v1.engine.events.event import FiredEvent
from backend_v1.engine.lab import Disposition
from backend_v1.content.copy import t
from backend_v1.content.true_log_copy import t_true


def _market_leader(labs):
    return max(labs, key=lambda lab: lab.market_cap)


def _leader_market_share(labs, leader):
    total_market_cap = sum(lab.market_cap for lab in labs)
    if total_market_cap <= 0.0:
        return 0.0
    return leader.market_cap / total_market_cap


def _is_moribund(lab, leader, consts):
    """A struggling rival: valued far below the leader AND too cash-starved to
    fund a serious pretrain run — i.e. it has effectively dropped out of the
    race."""
    if lab.is_player or lab is leader:
        return False
    far_below_leader = (lab.market_cap
                        < consts.BUYOUT_TARGET_CAP_FRACTION * leader.market_cap)
    cash_starved = lab.cash < consts.BUYOUT_TARGET_VIABLE_CASH
    return far_below_leader and cash_starved


def _most_moribund_target(labs, leader, consts):
    """The single weakest acquisition target, or None if no rival qualifies."""
    candidates = [lab for lab in labs if _is_moribund(lab, leader, consts)]
    if not candidates:
        return None
    return min(candidates, key=lambda lab: lab.market_cap)


def _buyout_hazard_per_year(leader_share, consts):
    """Per-year acquisition hazard, rising the more monopolistic the leader is —
    a more contestable near-monopoly attracts more disruptor capital."""
    concentration_excess = leader_share - consts.BUYOUT_TRIGGER_CONCENTRATION
    return consts.BUYOUT_BASE_RATE_PER_YEAR * (
        1.0 + consts.BUYOUT_CONCENTRATION_GAIN * concentration_excess)


def _relaunch_disposition(rng, consts):
    """A well-funded disruptor willing to cut corners: high recklessness, hostile
    to regulation, low safety priority. Governance weights are derived from
    recklessness exactly as in game.new_game."""
    recklessness = rng.uniform(consts.BUYOUT_RECKLESSNESS_MIN,
                               consts.BUYOUT_RECKLESSNESS_MAX)
    regulation_stance = min(0.95, 0.3 + 0.6 * recklessness)
    safety_priority = max(0.05, 0.5 * (1.0 - recklessness))
    return Disposition(recklessness=recklessness,
                       cost_advantage=1.0,
                       regulation_stance=regulation_stance,
                       safety_priority=safety_priority)


def _relaunch_lab(lab, leader, rng, consts):
    """Acquire and relaunch a moribund lab in place. Mutates the lab; returns
    (old_name, new_name, war_chest) for narration."""
    old_name = lab.name
    war_chest = max(consts.BUYOUT_MIN_CAPITAL,
                    consts.BUYOUT_CAPITAL_FRACTION * leader.cash)
    lab.cash = max(lab.cash, war_chest)

    available_names = [name for name in consts.BUYOUT_ACQUIRER_NAMES
                       if name != old_name]
    new_name = rng.choice(available_names) if available_names else old_name
    lab.name = new_name
    lab.disposition = _relaunch_disposition(rng, consts)
    return old_name, new_name, war_chest


def run_buyout_phase(ctx):
    """Roll for at most one acquisition this turn. Fires only when the market is
    concentrated around a dominant leader, the cooldown has elapsed, and a
    genuinely moribund rival exists. Returns a list of FiredEvents (0 or 1)."""
    labs, world = ctx.labs, ctx.world
    rng, consts, dt, turn = ctx.rng, ctx.consts, ctx.dt, ctx.turn
    if len(labs) < 2:
        return []

    cooldown_active = (world.last_buyout_turn is not None
                       and turn - world.last_buyout_turn
                       < consts.BUYOUT_COOLDOWN_TURNS)
    if cooldown_active:
        return []

    leader = _market_leader(labs)
    leader_share = _leader_market_share(labs, leader)
    if leader_share < consts.BUYOUT_TRIGGER_CONCENTRATION:
        return []

    target = _most_moribund_target(labs, leader, consts)
    if target is None:
        return []

    if not rng.roll_rate(_buyout_hazard_per_year(leader_share, consts), dt):
        return []

    old_name, new_name, war_chest = _relaunch_lab(target, leader, rng, consts)
    world.last_buyout_turn = turn

    public_text = t("event.buyout.public", {
        "old_name": old_name, "new_name": new_name})
    true_text = t_true("event.buyout.true", {
        "old_name": old_name, "new_name": new_name,
        "war_chest": f"{war_chest:,.0f}",
        "recklessness": f"{target.disposition.recklessness:.2f}"})
    return [FiredEvent(
        "lab_buyout", "societal", "ordinary", turn,
        target.id, None, 0.2, 0.0, public_text, true_text, effects=[])]
