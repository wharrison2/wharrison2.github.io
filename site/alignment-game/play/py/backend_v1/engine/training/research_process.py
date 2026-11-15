"""ResearchProcess (§8b): in-progress research effort, ticked by the engine.

Covers BOTH capability-tree advances and safety projects (same scheduling
machinery; they differ in what completion emits). AI-assist reduces the
budget fraction (the incentive) and widens duration variance (anti-dithering),
and is the contamination vector for capability advances / the
finding-reliability degrader for safety projects.
"""
from dataclasses import dataclass, field


@dataclass
class ResearchProcess:
    process_id: str
    kind: str                    # "capability" | "safety"
    template_id: str
    lab_id: str
    ai_assist: float             # 0..1, per-project (§9b); always 1.0 when is_delegate
    started_turn: int
    duration_years_remaining: float
    budget_fraction_effective: float    # after assist reduction
    is_reresearch: bool = False
    is_delegate: bool = False           # full handoff mode (automated_researcher unlock)
    # frozen at start: who is doing the assisted labor (contamination source)
    assisting_model_id: str | None = None
    assisting_model_goal_mis: float = 0.0
    assisting_potency: float = 0.0      # 0..1, gates the assist speedup (set at start)
    assist_speedup_max: float = 1.0     # consts.ASSIST_SPEEDUP, snapshotted at start
    meta: dict = field(default_factory=dict)

    def tick(self, dt: float, variance_draw: float) -> bool:
        """Advance one turn. variance_draw ~ N(0,1); assist widens the spread.
        Returns True when complete."""
        effective_dt = dt
        if self.ai_assist > 0:
            # assist speeds the EXPECTED clock (∝ assisting-model potency) but adds
            # noise to it (anti-dithering: can't shave exactly one turn on demand)
            assist_speed = self.assist_speedup_max * self.ai_assist * self.assisting_potency
            effective_dt *= 1.0 + assist_speed + variance_draw * 0.35 * self.ai_assist
        self.duration_years_remaining -= max(0.0, effective_dt)
        return self.duration_years_remaining <= 1e-9
