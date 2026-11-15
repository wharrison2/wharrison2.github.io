"""Logger (§11): records TRUE GameState every turn — the post-mortem substrate.

Continuous TRUE-stat capture; never reconstruct after loss. Snapshots are
plain dicts (JSON-serializable) so the CLI can also dump them to file.
"""
import json


class GameLogger:
    def __init__(self):
        self.turns = []     # one entry per turn

    def record(self, state, actions, events):
        year = state.consts.START_YEAR + state.turn * state.dt
        world_snap = state.world.snapshot()
        lab_snaps = [lab.snapshot() for lab in state.labs]
        action_dicts = {lab_id: _action_dict(a) for lab_id, a in actions.items()}
        event_dicts = [
            {
                "id": e.definition_id,
                "category": e.category,
                "klass": e.klass,
                "lab_id": e.lab_id,
                "model_id": e.model_id,
                "severity": round(e.severity, 3),
                "impact": round(e.impact, 2),
                "public_text": e.public_text,
                "true_text": e.true_text,
            }
            for e in events
        ]
        self.turns.append({
            "turn": state.turn,
            "year": year,
            "world": world_snap,
            "labs": lab_snaps,
            "actions": action_dicts,
            "events": event_dicts,
        })

    def dump(self, path):
        with open(path, "w") as f:
            json.dump(self.turns, f, indent=1)


def _action_dict(a):
    """FULL action capture — faithful enough to REPLAY (counterfactual re-sim)."""
    return {
        "start_projects": a.start_projects,
        "post_train": a.post_train,
        "commission_run": a.commission_run,
        "release": a.release,
        "lobby": a.lobby,
        "litigation": a.litigation,
        "defect": a.defect,
        "sign_safe_harbor": a.sign_safe_harbor,
        "build_evals": a.build_evals,
    }
