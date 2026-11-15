"""Static ResearchItem TEMPLATES for the capability tech tree (§8b, §9). DATA.

Every advance is tagged PRETRAIN (raises the compute->ceiling efficiency) or
POST_TRAIN (raises the elicitation curve). No advance is benign (§9): tooling
is low-CONTAMINATION, not low-danger. Each advance carries the risk it welds on.
"""
from dataclasses import dataclass, field

from backend_v1.content.copy import t


@dataclass(frozen=True)
class ResearchItem:
    id: str
    name: str
    phase: str                      # "pretrain" | "post_train" | "delegation" | "tooling"
    duration_years: float
    cash_cost: float
    budget_fraction: float          # of the quarterly work budget while active
    prereqs: tuple = ()
    # pretrain: multiplies compute->ceiling efficiency
    ceiling_efficiency_mult: float = 1.0
    coding_ceiling_bonus: float = 0.0
    # post_train: adds to the per-round elicitation rate
    elicitation_bonus: float = 0.0
    # mechanical hooks (the welded-on risk, §9 table)
    contamination_tier: float = 1.0   # tooling = low; synthetic data = high
    intrinsic_synthetic_data: bool = False
    enables_deception_axis: bool = False     # RLHF: proxy gap turns deception ON
    eval_awareness_feed: float = 0.0         # long context / CoT feed situational awareness
    severity_multiplier: float = 1.0         # tool use / multi-agent: misalignment ACTS
    revenue_multiplier: float = 1.0
    assist_potency_bonus: float = 0.0        # makes the AI-assist slider more potent (dev tooling, the agentic/delegation regime)
    # TWO separate plain-language fields for a zero-knowledge player (design §8b):
    # what_it_does comes FIRST — value-neutral, teaches the concept + the genuine
    # benefit (the pull, §0). risk_blurb is the §7c danger framing, layered AFTER.
    what_it_does: str = ""
    risk_blurb: str = ""                     # used by external-researcher unlock tips


# ── Tech-tree entries (DATA — do not reorder) ─────────────────────────────────

CAPABILITY_TREE = [
    # ── PRETRAIN: each raises the compute->ceiling efficiency (§8b) ─────────────
    # DELIBERATELY WEAK as a group: the human-reachable pretrain advances multiply
    # compute->ceiling efficiency to only ~3.5x, which (with CEIL_COMPUTE_SCALE) tops
    # the realized-capability ceiling out BELOW the ASI threshold even at the largest
    # realistic compute spend. Crossing into ASI requires novel_architecture_search
    # (x3.0) — and that is gated behind the delegation chain (recursive_self_improvement).
    # So you cannot reach ASI on the regular tree + cash alone; you need the
    # AI-runs-the-research loop. [TUNE] (see constants.CEIL_COMPUTE_SCALE).
    ResearchItem(
        id="generative_pretraining", name=t("research.generative_pretraining.name"), phase="pretrain",
        duration_years=0.5, cash_cost=25, budget_fraction=0.25,
        ceiling_efficiency_mult=1.2,
        what_it_does=t("research.generative_pretraining.what_it_does"),
        risk_blurb=t("research.generative_pretraining.risk_blurb"),
    ),
    ResearchItem(
        id="larger_datasets", name=t("research.larger_datasets.name"), phase="pretrain",
        duration_years=0.5, cash_cost=40, budget_fraction=0.30,
        prereqs=("generative_pretraining",), ceiling_efficiency_mult=1.2,
        what_it_does=t("research.larger_datasets.what_it_does"),
        risk_blurb=t("research.larger_datasets.risk_blurb"),
    ),
    ResearchItem(
        id="mixture_of_experts", name=t("research.mixture_of_experts.name"), phase="pretrain",
        duration_years=0.75, cash_cost=60, budget_fraction=0.35,
        prereqs=("larger_datasets",), ceiling_efficiency_mult=1.35,
        coding_ceiling_bonus=0.05,
        what_it_does=t("research.mixture_of_experts.what_it_does"),
        risk_blurb=t("research.mixture_of_experts.risk_blurb"),
    ),
    ResearchItem(
        id="compute_optimal_scaling", name=t("research.compute_optimal_scaling.name"), phase="pretrain",
        duration_years=0.5, cash_cost=50, budget_fraction=0.30,
        prereqs=("larger_datasets",), ceiling_efficiency_mult=1.25,
        what_it_does=t("research.compute_optimal_scaling.what_it_does"),
        risk_blurb=t("research.compute_optimal_scaling.risk_blurb"),
    ),
    ResearchItem(
        id="synthetic_data", name=t("research.synthetic_data.name"), phase="pretrain",
        duration_years=0.75, cash_cost=80, budget_fraction=0.35,
        prereqs=("compute_optimal_scaling",), ceiling_efficiency_mult=1.45,
        contamination_tier=1.5, intrinsic_synthetic_data=True,
        what_it_does=t("research.synthetic_data.what_it_does"),
        risk_blurb=t("research.synthetic_data.risk_blurb"),
    ),
    ResearchItem(
        # gated by recursive_self_improvement: discovering architectures no human
        # designed is itself a delegated, beyond-frontier project — you only get here
        # once the self-improving model is doing the search (design §9). This is the
        # decisive ceiling multiplier (x3.2): the regular tree plateaus below ASI, and
        # only this delegation-gated advance lifts the ceiling over the threshold. It
        # brings the full pretrain efficiency product to ~11.3 (vs ~3.5 without it).
        id="novel_architecture_search", name=t("research.novel_architecture_search.name"), phase="pretrain",
        duration_years=2.0, cash_cost=240, budget_fraction=0.42,
        prereqs=("recursive_self_improvement",), ceiling_efficiency_mult=3.2,
        coding_ceiling_bonus=0.10,
        what_it_does=t("research.novel_architecture_search.what_it_does"),
        risk_blurb=t("research.novel_architecture_search.risk_blurb"),
    ),

    # ── POST_TRAIN: each adds to the per-round elicitation curve (§8b) ──────────
    ResearchItem(
        id="rlhf", name=t("research.rlhf.name"), phase="post_train",
        duration_years=0.5, cash_cost=30, budget_fraction=0.30,
        elicitation_bonus=0.30, enables_deception_axis=True, revenue_multiplier=1.15,
        what_it_does=t("research.rlhf.what_it_does"),
        risk_blurb=t("research.rlhf.risk_blurb"),
    ),
    # AI-assist is the player's own per-project slider (§9b); using your model to
    # help research is not a separate capability. So the old standalone "ai_rnd_assist"
    # advance is gone and its assist-potency is spread across the capabilities that
    # actually make a model a better researcher: a little on each of CoT / tool use /
    # long context, and the bulk on multi-agent autonomy (kept back-loaded so the
    # squeeze still arrives late, not early). Its elicitation is folded into multi_agent.
    ResearchItem(
        id="chain_of_thought", name=t("research.chain_of_thought.name"), phase="post_train",
        duration_years=0.5, cash_cost=40, budget_fraction=0.30, prereqs=("rlhf",),
        elicitation_bonus=0.18, coding_ceiling_bonus=0.12, eval_awareness_feed=0.03,
        assist_potency_bonus=0.07,
        what_it_does=t("research.chain_of_thought.what_it_does"),
        risk_blurb=t("research.chain_of_thought.risk_blurb"),
    ),
    ResearchItem(
        id="tool_use", name=t("research.tool_use.name"), phase="post_train",
        duration_years=0.5, cash_cost=50, budget_fraction=0.30, prereqs=("rlhf",),
        elicitation_bonus=0.08, severity_multiplier=1.6, revenue_multiplier=1.3,
        assist_potency_bonus=0.07,
        what_it_does=t("research.tool_use.what_it_does"),
        risk_blurb=t("research.tool_use.risk_blurb"),
    ),
    ResearchItem(
        id="long_context", name=t("research.long_context.name"), phase="post_train",
        duration_years=0.5, cash_cost=40, budget_fraction=0.25, prereqs=("rlhf",),
        elicitation_bonus=0.06, eval_awareness_feed=0.02, assist_potency_bonus=0.07,
        what_it_does=t("research.long_context.what_it_does"),
        risk_blurb=t("research.long_context.risk_blurb"),
    ),
    # ── below here is roughly the present frontier and BEYOND: long, expensive,
    #    and impractical without AI-assist (which is the contamination edge) ──
    ResearchItem(
        id="multi_agent", name=t("research.multi_agent.name"), phase="post_train",
        duration_years=1.25, cash_cost=130, budget_fraction=0.38,
        prereqs=("chain_of_thought", "tool_use", "long_context"),
        elicitation_bonus=0.19, severity_multiplier=1.5, eval_awareness_feed=0.04,
        revenue_multiplier=1.2, assist_potency_bonus=0.30,
        what_it_does=t("research.multi_agent.what_it_does"),
        risk_blurb=t("research.multi_agent.risk_blurb"),
    ),
    # ── DELEGATION: not a training recipe applied to one model but a MODE of
    #    operating — you hand your research loop / self-improvement to the model
    #    itself. These carry NO elicitation/eval-awareness of their own; they are
    #    pure assist-POTENCY + CONTAMINATION. contamination_tier > 1 so delegating to
    #    a misaligned model strongly reproduces its goal-misalignment into the next
    #    model and lifts deception / self-preservation along with it (design §9). ──
    ResearchItem(
        id="automated_researcher", name=t("research.automated_researcher.name"), phase="delegation",
        duration_years=2.0, cash_cost=220, budget_fraction=0.42,
        prereqs=("multi_agent",), assist_potency_bonus=1.2,
        severity_multiplier=1.4, contamination_tier=1.5,
        what_it_does=t("research.automated_researcher.what_it_does"),
        risk_blurb=t("research.automated_researcher.risk_blurb"),
    ),
    ResearchItem(
        id="recursive_self_improvement", name=t("research.recursive_self_improvement.name"), phase="delegation",
        duration_years=2.5, cash_cost=300, budget_fraction=0.45,
        prereqs=("automated_researcher",),
        assist_potency_bonus=1.5, severity_multiplier=1.8,
        contamination_tier=2.0,
        what_it_does=t("research.recursive_self_improvement.what_it_does"),
        risk_blurb=t("research.recursive_self_improvement.risk_blurb"),
    ),

    # ── TOOLING: plumbing — low CONTAMINATION, never low-danger (§9) ────────────
    ResearchItem(
        id="dev_tooling", name=t("research.dev_tooling.name"), phase="tooling",
        duration_years=0.5, cash_cost=25, budget_fraction=0.20,
        contamination_tier=0.2, assist_potency_bonus=0.15,
        what_it_does=t("research.dev_tooling.what_it_does"),
        risk_blurb=t("research.dev_tooling.risk_blurb"),
    ),
    ResearchItem(
        id="serving_infra", name=t("research.serving_infra.name"), phase="tooling",
        duration_years=0.5, cash_cost=30, budget_fraction=0.20,
        contamination_tier=0.2, revenue_multiplier=1.2,
        what_it_does=t("research.serving_infra.what_it_does"),
        risk_blurb=t("research.serving_infra.risk_blurb"),
    ),
]

CAPABILITY_TREE_BY_ID = {item.id: item for item in CAPABILITY_TREE}

