"""Observation types (§11): the ONLY player-facing data shape.

Plain dicts, JSON-serializable end to end (§14 requirement). A TRUE stat the
player shouldn't see never enters these structures — enforcement lives in
observation_builder.py, the single chokepoint.
"""
from dataclasses import dataclass, field, asdict


@dataclass
class Observation:
    """Per-actor filtered view. Everything in here is derived from MEASURED
    values, findings, or genuinely public information."""
    lab_id: str
    turn: int
    year: float
    cash: float
    work_budget_free: float
    revenue_rate: float
    investment_rate: float
    market_caps: dict                 # lab_id -> cap (public, legible anchor)
    own_models: list                  # measured stats only
    model_in_training: dict | None    # measured + ceiling ESTIMATE + elicitation curve
    in_progress: list
    researched_advances: list         # COMPLETED advances (non-secret fields only)
    new_findings: list
    worry_bar: dict
    rival_public: list                # coarse estimates of rivals' released models
    public_approval: float
    regulatory_chatter: str           # coarse WTR ("quiet"/"rumbling"/"loud"/"deafening")
    active_policies: list
    policy_news: list
    public_events: list
    tips: list                        # external-researcher narrator (guidance layer)
    legal_moves: dict
    benchmarks: list = field(default_factory=list)   # §7 public scoreboard (you + rivals)
    evals: list = field(default_factory=list)        # §7 private passive harnesses (yours only)
    alignment_evidence: dict = field(default_factory=dict)  # Intel dossier: findings grouped by model
    game_over: bool = False
    outcome: dict | None = None

    def to_dict(self):
        return asdict(self)
