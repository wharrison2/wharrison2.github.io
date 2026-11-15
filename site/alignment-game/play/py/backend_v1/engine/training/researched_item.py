"""ResearchedItem (§8b): a completed advance instance consumed by training runs.

Hidden contamination is set ONCE at completion = f(assist x researching-model
goal-misalignment), frozen. Per-node, independent, sticky: a poisoned
foundational node infects every subsequent model that uses it until re-researched.
"""
from dataclasses import dataclass


@dataclass
class ResearchedItem:
    node_id: str
    version: int
    contamination: float        # HIDDEN — never reaches observations
    completed_turn: int
    researched_with_assist: float
    researcher_model_id: str | None
