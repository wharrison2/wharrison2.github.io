"""Investment pie (§9b): rewards the SLOPE. The financial treadmill.

Growth is measured BETWEEN releases. Investor confidence does NOT collapse the
turn after a release: a release sets a confidence level (how far it beat the
risen bar), that confidence keeps GROWING through a grace window of a few
quarters, and ONLY after the grace expires does continued waiting erode it.
The bar rises with the frontier AND with how long you held (expectations climb
with time). Investment is a FLOW added to the single cash pot each turn.

Momentum is a PERSISTENT per-lab accumulator (`lab.investment_momentum`),
evolved one step per turn — NOT recomputed from scratch off "quarters since the
last release." The earlier stateless version keyed the grace ramp off
`years_since`, which reset to zero at every release: a release that BEAT its bar
still threw away the grace momentum it had accrued, so the market cap dropped at
each release (the "slanted staircase"). Carrying momentum across releases makes
a beat continuous (no drop) and reserves the cliff for a MISS or for sitting
past the grace window — exactly the §9b intent ("default state is growth; the
cliff is the exception").
"""
import math


def _release_growth_term(lab, world, consts, dt):
    """How well the LAST release advanced the lab's own high-water mark, judged
    against a ceiling-aware bar. Returns a float in [-1, 1.5], OR None for a
    NEUTRAL refresh (shipped, but didn't beat your best) — the caller carries
    momentum forward unchanged in that case. 0.0 on a lab's first release.

    fix D: growth is measured against the lab's BEST prior release
    (prev_best_release_measured_general), not the immediately previous one, so a
    refresh weaker than your flagship is neutral rather than a punishing negative.
    fix A: the required-growth bar is scaled by remaining headroom to CAP_MAX, so a
    frontier leader near the ceiling isn't asked for linear growth the ceiling makes
    impossible — capability asymptotes; the bar should too."""
    if lab.last_release_turn is None or lab.prev_best_release_measured_general <= 0:
        return 0.0      # first release: neutral, establishes baseline confidence

    baseline = lab.prev_best_release_measured_general
    if lab.last_release_measured_general <= baseline:
        return None     # fix D: a sub-flagship refresh neither rewards nor punishes

    frontier = max(world.frontier_measured_general, 0.5)
    held = max(dt, (lab.last_release_turn - (lab.prev_release_turn or 0)) * dt)
    growth_per_year = (lab.last_release_measured_general - baseline) / held
    # fix A: shrink the bar as the released model approaches the ceiling.
    headroom = max(consts.SCORE_TARGET_HEADROOM_FLOOR,
                   1.0 - lab.last_release_measured_general / consts.CAP_MAX)
    target = (consts.RISING_TARGET_BASE
              + consts.RISING_TARGET_FRONTIER_K * frontier
              + consts.RISING_TARGET_TIME_K * held) * headroom
    # beating the (softened) bar is rewarded; undershooting it is a mild miss
    return max(-1.0, min(1.5, (growth_per_year - target) / max(0.05, target)))


def update_investment_momentum(lab, world, turn, consts, dt):
    """Advance the persistent investor-confidence momentum by ONE turn.

    - On the turn of a release: the release injects a confidence level from how it
      beat its bar. A BEAT (growth_term >= 0) never lowers momentum — it carries
      the accrued slope forward (continuity, the staircase fix). A MISS resets
      momentum down to that (sub-1) confidence — the precipitous cliff (§9b).
    - Within the grace window with no release: momentum keeps GROWING at a baseline
      rate (the market stays patient and assumes a big release is coming).
    - Past the grace window with no release: waiting finally bites and momentum
      decays.
    """
    if lab.last_release_turn is None:
        return                      # nothing shipped yet; momentum stays at 0

    released_this_turn = (lab.last_release_turn == turn)
    if released_this_turn:
        growth_term = _release_growth_term(lab, world, consts, dt)
        if growth_term is None:
            return      # fix D: neutral refresh — carry momentum forward unchanged
        if growth_term >= 0.0:
            # a BEAT carries the accrued slope forward (continuity, the staircase fix)
            confidence = 1.0 + consts.SCORE_MOMENTUM_GROWTH * growth_term
            lab.investment_momentum = max(confidence, lab.investment_momentum)
        else:
            # fix B: a MISS decays momentum gently, scaled by how badly it missed,
            # instead of hard-resetting it — one sub-bar release no longer wipes all
            # accrued investor confidence.
            miss_severity = -growth_term      # in (0, 1]
            decay = 1.0 - consts.SCORE_MISS_DECAY_K * miss_severity
            lab.investment_momentum *= decay
        return

    years_since = (turn - lab.last_release_turn) * dt
    if years_since <= consts.SCORE_GRACE_YEARS:
        grace_growth_per_year = consts.SCORE_GRACE_GROWTH / consts.SCORE_GRACE_YEARS
        lab.investment_momentum += grace_growth_per_year * dt
    else:
        lab.investment_momentum *= math.exp(-consts.SCORE_RELEASE_DECAY * dt)


def lab_score(lab, world, consts):
    # fix D: the LEVEL term uses the lab's best-EVER released capability, not its
    # latest release. Releases are permanent and the best model keeps earning, so a
    # lab's standing reflects its high-water mark — shipping a smaller refresh on top
    # must not lower its score.
    best = lab.best_release_measured_general
    rev_share = (lab.revenue_rate / world.total_revenue_rate
                 if world.total_revenue_rate > 0 else 0.0)
    score = (consts.SCORE_W_BEST * best / consts.CAP_MAX
             + consts.SCORE_W_REVSHARE * rev_share
             + consts.SCORE_W_GROWTH * lab.investment_momentum)
    # Fines discount (ISSUES.md "fines->valuation"): investors flee a lab bleeding money
    # to regulatory penalties. Fines accrue ONLY to labs that DEFECT on active rules
    # (reckless rivals racing past audits/caps); the compliant clean player is never fined,
    # so this is a clean DOMINANCE lever that rewards a clean+compliant record and the
    # player's own governance lobbying (regs they pass -> rivals fined -> rivals devalued).
    # Judged against the lab's own EARNINGS (annual revenue), not its inflated market cap:
    # a lab fined several times its yearly revenue is a regulatory pariah investors flee,
    # even if its headline valuation is large. (Against market cap a big reckless leader's
    # fines look negligible; against revenue they bite — which is the dominance lever.)
    fines_scale = max(consts.FINES_VALUATION_REF, lab.revenue_rate * consts.FINES_VALUATION_REVENUE_YEARS)
    fines_ratio = lab.fines_paid / fines_scale
    fines_factor = max(consts.FINES_VALUATION_FLOOR, 1.0 - consts.FINES_VALUATION_K * fines_ratio)
    score *= fines_factor
    return max(0.0, score)


def _lab_is_active(lab):
    """Active = the lab is doing something the early/seed market can bet on: it has
    shipped a model, OR it has research / pretraining / a post-train model in flight.
    An inactive lab (idle, nothing in progress, never shipped) sees its seed
    investment decay toward zero (§9b: the default is growth, idleness is punished)."""
    has_shipped = len(lab.release_history) > 0
    has_work_in_progress = (len(lab.in_progress) > 0
                            or lab.training_run is not None
                            or lab.model_in_training is not None)
    return has_shipped or has_work_in_progress


def update_base_investment(lab, consts, dt):
    """Advance the lab's seed/base investment flow by one turn (§9b early investment).

    Early-stage capital bets on the field/team before any release, so every lab starts
    with a small base flow. It HOLDS at the base level while the lab is active and
    DECAYS toward zero if the lab goes idle for a few quarters. Stored on the lab so it
    is a persistent accumulator (one step per turn), not recomputed from scratch."""
    if _lab_is_active(lab):
        lab.base_investment_rate = consts.BASE_INVESTMENT_PER_YEAR
    else:
        lab.base_investment_rate *= math.exp(-consts.BASE_INVESTMENT_DECAY_PER_YEAR * dt)


def run_investment(labs, world, turn, rng, consts, dt):
    if world.total_revenue_rate > 0 and world.prev_total_revenue_rate > 0:
        single_turn_growth = (world.total_revenue_rate / world.prev_total_revenue_rate - 1) / dt
    else:
        single_turn_growth = 0.0
    # §9b: investment rewards the SLOPE between releases, not an instantaneous spike.
    # The single-turn ratio whipsaws (huge the turn a new model enters the pie, negative
    # the next), so feed the pie a SMOOTHED growth instead — this is what previously flung
    # total investment, and the cap keyed off it, up then down after every release.
    world.smoothed_revenue_growth_per_year += consts.REVENUE_GROWTH_SMOOTHING_ALPHA * (
        single_turn_growth - world.smoothed_revenue_growth_per_year)
    smoothed_revenue_growth = world.smoothed_revenue_growth_per_year

    frontier_capability = world.frontier_measured_general
    capability_fraction = frontier_capability / consts.CAP_MAX
    growth_multiplier = max(0.2, 1 + consts.INVESTMENT_GROWTH_WEIGHT * smoothed_revenue_growth)
    total_investment = (consts.INVESTMENT_MAX_PER_YEAR
                        * capability_fraction ** consts.INVESTMENT_CAP_EXP
                        * growth_multiplier)

    # advance each lab's persistent confidence momentum AND its seed investment by one
    # turn, THEN score.
    for lab in labs:
        update_investment_momentum(lab, world, turn, consts, dt)
        update_base_investment(lab, consts, dt)

    # Each lab's score is jittered by a per-turn investor-SENTIMENT noise factor
    # (§9b: the pie split is not perfectly legible — sentiment, not just fundamentals,
    # moves the money). Multiplicative and clamped at 0 so noise never flips a score
    # negative, mirroring the revenue pie's REVENUE_NOISE_STD. Drawn from the seeded
    # RNG, so determinism holds (CLAUDE.md §0.4).
    scores = {}
    for lab in labs:
        fundamental_score = lab_score(lab, world, consts)
        sentiment_noise = max(0.0, 1.0 + rng.normal(0, consts.SCORE_NOISE_STD))
        scores[lab.id] = fundamental_score * sentiment_noise
    scores_sum = sum(scores.values()) or 1.0

    for lab in labs:
        score_share_investment = total_investment * scores[lab.id] / scores_sum
        # the seed/base flow is ADDED on top of the score-divvied pie: it is present
        # from turn 1 (when the score-pie is still ~0) and tapers as real investment
        # takes over. It is each lab's own seed money, not a share of the pie.
        lab.investment_rate = score_share_investment + lab.base_investment_rate
        lab.cash += rng.amount_per_dt(lab.investment_rate, dt)
        lab.last_score = scores[lab.id]
