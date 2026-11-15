"""Economy orchestrator (§9b): two pies -> single cash pot -> market cap,
plus the continuous capability-driven job-loss drag (§10: NOT event-based).
"""
from backend_v1.engine.finances.revenue import run_revenue
from backend_v1.engine.finances.investment import run_investment
from backend_v1.engine.finances.market_cap import update_market_caps


def run_finances(labs, world, turn, rng, consts, dt):
    run_revenue(labs, world, rng, consts, dt)
    run_investment(labs, world, turn, rng, consts, dt)
    update_market_caps(labs, consts, dt)


def run_job_loss_drag(labs, world, rng, consts, dt):
    """Displacement is a smooth function of deployed capability across the
    landscape: steady downward approval pressure rising inexorably with
    capability. Attribution of the impact drag is by deployment (revenue) share
    — a liberty, see NOTES.md."""
    frontier_capability = world.frontier_measured_general
    if frontier_capability <= 0:
        return

    capability_fraction = frontier_capability / consts.CAP_MAX
    intensity = capability_fraction ** 2

    approval_loss_rate_per_year = (consts.JOB_LOSS_APPROVAL_RATE * intensity
                                   * consts.JOB_LOSS_APPROVAL_INTENSITY_SCALE)
    approval_delta = rng.amount_per_dt(approval_loss_rate_per_year, dt) * consts.JOB_LOSS_APPROVAL_AMOUNT_SCALE
    world.public_approval = max(0.0, world.public_approval - approval_delta)

    displacement = rng.amount_per_dt(consts.JOB_LOSS_IMPACT_RATE * intensity, dt)
    world.cumulative_displacement += displacement

    total_rev = sum(lab.revenue_rate for lab in labs) or 1.0
    for lab in labs:
        revenue_share = lab.revenue_rate / total_rev
        lab.impact_ledger -= displacement * revenue_share
