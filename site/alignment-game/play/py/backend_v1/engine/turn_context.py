"""TurnContext — the per-turn state bundle threaded through the phase functions.

Previously each subsystem (event phase, latent phase, enforcement, litigation)
hand-rolled an identical `SimpleNamespace(labs, labs_by_id, world, flags, rng,
consts, dt, turn)`. That implicit "turn context" is now a single declared type,
built ONCE in turn_pipeline.run_turn and passed down. The effect vocabulary
(events/effects.py) and the rate/build/news/appeal helpers consume the same
attributes, so they are unchanged.
"""
from dataclasses import dataclass, field


@dataclass
class TurnContext:
    labs: list
    world: object
    flags: dict
    rng: object
    consts: object
    dt: float
    turn: int
    labs_by_id: dict = field(init=False)

    def __post_init__(self):
        self.labs_by_id = {l.id: l for l in self.labs}

    @property
    def player(self):
        """THE human lab — solo-only tooling. Engine code must not assume a
        single human (multiplayer has N); iterate human_labs instead."""
        return next(l for l in self.labs if l.is_player)

    @property
    def human_labs(self):
        """Every human-SEATED lab (is_player), in state.labs order — includes
        multiplayer replace-with-AI takeovers (solo: [player])."""
        return [l for l in self.labs if l.is_player]

    @property
    def human_controlled_labs(self):
        """Human-seated labs a human is still actually deciding for — excludes
        replace-with-AI takeovers. The §10 frontier rule keys on these: a lab
        nobody is playing must not carry human existential potency, nor raise
        the human frontier that contains real rivals. Solo: [player]."""
        return [l for l in self.labs if l.is_player and not l.controlled_by_ai]
