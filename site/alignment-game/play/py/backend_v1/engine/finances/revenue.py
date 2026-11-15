"""Revenue pie (§9b): rewards the LEVEL. Keys off MEASURED capability.

Total market = f(best measured model in the WORLD); divvied across EVERY
released model by measured capability — old models keep a trickle, a new
frontier release cannibalizes your own back catalog, no explicit decay rule.

Sandbagging carries NO revenue penalty (§12c Q1): commercial capability reads
on-target and earns normally. The cost of sandbagging is unpriced TRUE dangerous
capability feeding catastrophe gating — hidden dangerous capability was never a
revenue source to lose.
"""
from backend_v1.engine.research.capabilities.capabilities_research_item import (
    CAPABILITY_TREE_BY_ID,
)


def run_revenue(labs, world, rng, consts, dt):
    released = [(lab, m) for lab in labs for m in lab.release_history]
    if not released:
        for lab in labs:
            lab.revenue_rate = 0.0
        world.prev_total_revenue_rate = world.total_revenue_rate
        world.total_revenue_rate = 0.0
        return

    def monetized_general(model):
        # commercial capability reads on-target and earns normally (§12c Q1):
        # the hidden, risk-relevant slice was never monetizable in the first place
        return max(0.05, model.measured_capability.general)

    best_monetized = max(monetized_general(m) for _, m in released)
    world.frontier_measured_general = max(m.measured_capability.general for _, m in released)

    noise_factor = max(0.0, 1 + rng.normal(0, consts.REVENUE_NOISE_STD))
    market = (consts.REVENUE_MAX_PER_YEAR
              * (best_monetized / consts.CAP_MAX) ** consts.REVENUE_CAP_EXP
              * noise_factor)

    weights = []
    for lab, m in released:
        w = monetized_general(m) ** consts.REVENUE_SHARE_EXP
        for nid in lab.researched_advances:
            capability_node = CAPABILITY_TREE_BY_ID.get(nid)
            if capability_node is not None and capability_node.revenue_multiplier > 1:
                w *= capability_node.revenue_multiplier
        weights.append(w)
    total_weight = sum(weights) or 1.0

    for lab in labs:
        lab.revenue_rate = 0.0
    for (lab, m), w in zip(released, weights):
        lab.revenue_rate += market * w / total_weight
    for lab in labs:
        lab.cash += rng.amount_per_dt(lab.revenue_rate, dt)
    world.prev_total_revenue_rate = world.total_revenue_rate
    world.total_revenue_rate = sum(lab.revenue_rate for lab in labs)
