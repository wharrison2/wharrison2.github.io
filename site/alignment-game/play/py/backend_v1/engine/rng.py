"""Centralized seeded RNG (design doc §11). ALL stochastic draws go through this.

Also home of the continuous-rate helpers (§0b): nothing in the engine stores a
per-turn probability or amount; everything is a per-year rate converted here.
"""
import math
import random


class Rng:
    def __init__(self, seed: int):
        self.seed = seed
        self._r = random.Random(seed)

    # ── §0b time helpers ────────────────────────────────────────────

    @staticmethod
    def prob_per_dt(rate_per_year: float, dt: float) -> float:
        """Poisson: probability of >=1 event this turn given a per-year rate."""
        clamped_rate = max(0.0, rate_per_year)
        return 1.0 - math.exp(-clamped_rate * dt)

    @staticmethod
    def amount_per_dt(rate_per_year: float, dt: float) -> float:
        """Continuous accumulator: amount this turn given a per-year rate."""
        return rate_per_year * dt

    # ── draws ───────────────────────────────────────────────────────

    def roll(self, p: float) -> bool:
        return self._r.random() < p

    def roll_rate(self, rate_per_year: float, dt: float) -> bool:
        p = self.prob_per_dt(rate_per_year, dt)
        return self.roll(p)

    def uniform(self, a: float, b: float) -> float:
        return self._r.uniform(a, b)

    def normal(self, mu: float = 0.0, sigma: float = 1.0) -> float:
        return self._r.gauss(mu, sigma)

    def choice(self, seq):
        return self._r.choice(seq)

    def random(self) -> float:
        return self._r.random()

    # ── serializable state (replay support) ─────────────────────────

    def getstate(self):
        return self._r.getstate()

    def setstate(self, state):
        self._r.setstate(state)


def gate(capability: float, onset: float, steepness: float) -> float:
    """Sigmoid capability gate in [0,1] — how 'online' a capability-gated
    mechanism is. Used for agentic edges and gated emergence (§5, §6)."""
    safe_steepness = max(1e-6, steepness)
    exponent = -(capability - onset) / safe_steepness
    return 1.0 / (1.0 + math.exp(exponent))
