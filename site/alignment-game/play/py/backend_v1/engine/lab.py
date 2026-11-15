"""Lab entity (design doc §4.2) — state shared by player and rivals.

Pure self-queries only; the engine advances time. Controllers (separate
objects) make decisions.
"""
from dataclasses import dataclass, field


@dataclass
class Disposition:
    """Rival disposition = WEIGHTS tuning the two-level controller's score
    functions (§10c), not a fixed personality. recklessness is the base; the
    controller layers a TRAJECTORY response on top (falling behind → more
    aggressive — the desperation spiral)."""
    recklessness: float = 0.0       # 0 cautious .. 1 reckless (the base)
    cost_advantage: float = 1.0     # multiplier on compute efficiency
    open_weights_ideology: bool = False
    regulation_stance: float = 0.5  # dislike of being regulated -> lobby/litigation spend
    safety_priority: float = 0.3    # baseline safety weight (rivals care less than player)

    @property
    def compliance(self) -> float:
        """Per-lab compliance with active policies ∝ disposition (§10c)."""
        return max(0.05, 1.0 - 0.85 * self.recklessness)


@dataclass
class Lab:
    id: str
    name: str
    # Short public stock-style ticker (e.g. "YOU", "MIS"). Public/legible like the
    # name — not hidden state, so it crosses the observation boundary freely. Always
    # an already-sanitized, length-bounded string by the time a Lab is constructed
    # (see game.sanitize_ticker); never built from any TRUE/hidden field.
    ticker: str = ""
    is_player: bool = False
    # Multiplayer replace-with-AI takeover (MULTIPLAYER_DESIGN decision #4): the
    # seat's human was removed and the rival controller decides for this lab.
    # is_player stays True (the lab keeps human-seat rules: buyout immunity,
    # explicit-defection compliance), but rules about what a HUMAN can cause or
    # defend — the §10 frontier rule — must treat it as AI-driven; they key on
    # `is_player and not controlled_by_ai`. Always False in solo play.
    controlled_by_ai: bool = False
    cash: float = 0.0                       # SINGLE pot (revenue + investment)
    work_budget_per_year: float = 4.0       # quarterly pool = this * dt
    current_best_model: object | None = None     # most recent RELEASED model
    model_in_training: object | None = None      # post-train iterable, pre-release
    release_history: list = field(default_factory=list)   # permanent attack surface
    researched_advances: dict = field(default_factory=dict)  # node_id -> ResearchedItem
    in_progress: list = field(default_factory=list)        # ResearchProcess list
    training_run: object | None = None                     # pretrain in progress
    # economy
    revenue_rate: float = 0.0               # $M/yr, recomputed each turn
    investment_rate: float = 0.0
    # Seed/base investment flow (§9b early investment): early-stage capital betting on
    # the field/team, present from turn 1, decaying toward zero if the lab goes idle.
    # Persistent accumulator advanced one step per turn (see update_base_investment).
    base_investment_rate: float = 0.0
    # Smoothed (EMA) investment flow — the SIZE anchor the market cap multiplies by.
    # The raw per-turn investment_rate is a share of a per-turn-noisy pie (a rival's
    # surge or a one-turn revenue blip swings it wildly); using it directly made the
    # cap spike on a release turn then decline as the rate mean-reverted. Smoothing
    # keeps valuation tracking the lab's rising score, not the flow's single-turn jitter.
    smoothed_investment_rate: float = 0.0
    market_cap: float = 100.0
    # Cumulative realized revenue — a monotonic stock that feeds a ratcheting market-cap
    # floor (fix C, ISSUES.md "market caps plateau"), so a dominant lab keeps a slow
    # climb after capability/score saturate. Advanced one step per turn.
    released_value_stock: float = 0.0
    last_release_turn: int | None = None
    prev_release_turn: int | None = None       # release before last (investment hold-time)
    last_release_measured_general: float = 0.0
    prev_release_measured_general: float = 0.0
    # Best measured-general the lab has EVER released, and that high-water mark as it
    # stood BEFORE the latest release. Investment growth is judged against the latter
    # (fix D), so a refresh weaker than your own flagship reads as neutral, not a
    # punishing regression.
    best_release_measured_general: float = 0.0
    prev_best_release_measured_general: float = 0.0
    last_score: float = 0.0                     # investment score, fed to market cap
    # Persistent investor-confidence momentum (§9b). Carried across releases so a
    # release that BEATS its risen bar never drops the slope — growth is continuous,
    # the cliff is reserved for a MISS or for sitting past the grace window.
    investment_momentum: float = 0.0
    # scoring (§3)
    impact_ledger: float = 0.0              # running externality integral
    impact_positives: float = 0.0           # tracked separately for the loss screen
    # governance
    reputation: float = 50.0                # light per-lab reputation (weak lever)
    fines_paid: float = 0.0                  # cumulative regulatory fines ($M) — investors
                                             # discount a lab bleeding money to penalties
                                             # (only reckless DEFECTORS are fined; the
                                             # compliant clean player never is -> dominance lever)
    lobby_stances: dict = field(default_factory=dict)  # policy_id -> last stance (display)
    active_defections: set = field(default_factory=set)  # policy_ids the player chose to defect on
    defection_caught_pending: set = field(default_factory=set)  # policy_ids defecting, awaiting catch roll
    safe_harbor_signed: bool = False
    audit_pending_release: object | None = None   # model waiting on gov audit
    # disposition (rivals; player gets defaults)
    disposition: Disposition = field(default_factory=Disposition)
    # evals (§7): built passive harnesses (harness_id -> level; absent = unbuilt) and
    # in-flight build/upgrade timers ([{harness_id, target_level, years_remaining}])
    eval_harnesses: dict = field(default_factory=dict)
    eval_builds: list = field(default_factory=list)
    # bookkeeping
    model_counter: int = 0
    findings: list = field(default_factory=list)    # accumulated safety findings
    pending_effort: dict = field(default_factory=dict)  # axis -> remediation effort feed
    rival_estimate_cache: dict = field(default_factory=dict)  # (rival_id, model_id) -> noised est

    # ── pure queries ────────────────────────────────────────────────

    def released_models(self):
        return [m for m in self.release_history]

    def frontier_model(self):
        """Best model the lab could be judged by (released)."""
        if not self.release_history:
            return None
        return max(self.release_history, key=lambda m: m.measured_capability.general)

    def best_true_general(self) -> float:
        candidates = [m.capability_vec.general for m in self.release_history]
        if self.model_in_training is not None:
            candidates.append(self.model_in_training.capability_vec.general)
        return max(candidates, default=0.0)

    def assisting_model(self):
        """The model that performs AI-assisted research labor (§9b).

        AI-assist needs a model to run the labor, but NOT a *released* one: a lab
        automates its own R&D with its best internal model whether or not it has
        shipped it to customers. So the candidates are the released best AND the
        model currently in training (post-train, pre-release). Returns the most
        research-capable of them, or None if the lab has no model at all yet.
        Capability is ranked by the same blend assist_potency() scores on, so the
        chosen model is the one that would actually do the most research labor."""
        candidates = []
        if self.current_best_model is not None:
            candidates.append(self.current_best_model)
        if self.model_in_training is not None:
            candidates.append(self.model_in_training)
        if not candidates:
            return None

        def research_capability(model) -> float:
            coding = model.capability_vec.coding_rnd
            general = model.capability_vec.general
            return max(coding, 0.85 * general)

        return max(candidates, key=research_capability)

    def max_run_compute(self) -> float:
        return max(0.0, self.cash * 0.9)

    def next_model_id(self) -> str:
        self.model_counter += 1
        return f"{self.id}-M{self.model_counter}"

    def snapshot(self) -> dict:
        released_snaps = [m.snapshot() for m in self.release_history]
        in_training_snap = (
            [self.model_in_training.snapshot()] if self.model_in_training else []
        )
        advance_summary = {
            nid: {"version": item.version, "contamination": item.contamination}
            for nid, item in self.researched_advances.items()
        }
        return {
            "id": self.id,
            "name": self.name,
            # NOTE: ticker is intentionally NOT in the snapshot. The snapshot feeds
            # the TRUE-state log (golden-master digest) and the post-mortem; the
            # public ticker reaches the frontend via the server's lab_tickers() map
            # and rival_public, so it never needs to enter the logged true state.
            "is_player": self.is_player,
            "cash": self.cash,
            "revenue_rate": self.revenue_rate,
            "investment_rate": self.investment_rate,
            "market_cap": self.market_cap,
            "impact_ledger": self.impact_ledger,
            "impact_positives": self.impact_positives,
            "reputation": self.reputation,
            "models": released_snaps + in_training_snap,
            "advances": advance_summary,
        }
