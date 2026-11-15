"""§7 PUBLIC benchmarks — the passive, free, world-released scoreboard.

Benchmarks are read off MEASURED capability, so a sandbagging model scores clean
and benchmark-chasing is Goodhart-rational. They are recomputed on demand at
observation-build time, so they refresh for free on every model change — no
action, no cost. The world releases new, harder benchmarks on a schedule; old
ones saturate (everyone clusters near 100%) and lose discriminating power.

Three render kinds:
  • "ring"    — bounded 0–100% per domain (the circular-gauge cards)
  • "elo"     — unbounded Arena-style headline rating (no ring)
  • "horizon" — METR-style task time-horizon in minutes (unbounded, log scale)
"""
import math
from dataclasses import dataclass

from backend_v1.config.constants import FRONTIER_EARLY_RELEASE_MARGIN
from backend_v1.content.copy import t


@dataclass(frozen=True)
class Benchmark:
    id: str
    name: str
    domain: str           # "general" | "coding" | "overall"
    release_year: float
    midpoint: float       # capability at which a ring benchmark scores ~50%
    kind: str             # "ring" | "elo" | "horizon"
    blurb: str


# Release schedule + difficulty (midpoint) authored so each benchmark saturates as
# the frontier passes it and the next, harder one takes over (MMLU → GPQA → … ).
BENCHMARK_SUITE = [
    Benchmark("mmlu", t("benchmark.mmlu.name"), "general", 2021.0, 2.0, "ring",
              t("benchmark.mmlu.blurb")),
    Benchmark("humaneval", t("benchmark.humaneval.name"), "coding", 2021.0, 2.5, "ring",
              t("benchmark.humaneval.blurb")),
    Benchmark("gpqa", t("benchmark.gpqa.name"), "general", 2023.0, 4.5, "ring",
              t("benchmark.gpqa.blurb")),
    Benchmark("swebench", t("benchmark.swebench.name"), "coding", 2023.5, 5.0, "ring",
              t("benchmark.swebench.blurb")),
    Benchmark("arcagi", t("benchmark.arcagi.name"), "general", 2024.5, 6.0, "ring",
              t("benchmark.arcagi.blurb")),
    Benchmark("hle", t("benchmark.hle.name"), "general", 2025.5, 7.0, "ring",
              t("benchmark.hle.blurb")),
    Benchmark("frontier_x", t("benchmark.frontier_x.name"), "general", 2028.0, 8.5, "ring",
              t("benchmark.frontier_x.blurb")),
    Benchmark("arena_elo", t("benchmark.arena_elo.name"), "overall", 2023.0, 0.0, "elo",
              t("benchmark.arena_elo.blurb")),
    Benchmark("metr_horizon", t("benchmark.metr_horizon.name"), "overall", 2024.0, 0.0, "horizon",
              t("benchmark.metr_horizon.blurb")),
]
BENCHMARK_BY_ID = {b.id: b for b in BENCHMARK_SUITE}

# The sealed frontier benchmark also releases early once the frontier has clearly
# saturated the previous one (HLE midpoint + FRONTIER_EARLY_RELEASE_MARGIN).


def is_released(benchmark, year, frontier_general):
    """Whether a benchmark is on the public board yet. By release year, except the
    sealed frontier benchmark also unlocks early once the frontier saturates HLE."""
    if year >= benchmark.release_year:
        return True
    if benchmark.id == "frontier_x":
        hle_midpoint = BENCHMARK_BY_ID["hle"].midpoint
        return frontier_general >= hle_midpoint + FRONTIER_EARLY_RELEASE_MARGIN
    return False


def released_benchmarks(year, frontier_general):
    return [b for b in BENCHMARK_SUITE if is_released(b, year, frontier_general)]


def _measured_for_domain(measured_capability, domain):
    """Which measured capability axis a benchmark reads (overall/general use the
    general axis; coding benches use coding_rnd)."""
    if domain == "coding":
        return measured_capability.coding_rnd
    return measured_capability.general


def benchmark_score(benchmark, model, consts):
    """Score for one model on one benchmark, read off MEASURED capability.

    Return value's meaning depends on benchmark.kind:
      ring    → percent in [0, 100]
      elo     → an unbounded rating (~1000+)
      horizon → a task time-horizon in MINUTES (unbounded)
    """
    measured_capability = _measured_for_domain(model.measured_capability, benchmark.domain)

    if benchmark.kind == "ring":
        distance_past_midpoint = measured_capability - benchmark.midpoint
        logistic = 1.0 / (1.0 + math.exp(-consts.BENCHMARK_SLOPE * distance_past_midpoint))
        return 100.0 * logistic

    if benchmark.kind == "elo":
        return consts.ELO_BASE + consts.ELO_PER_CAPABILITY * measured_capability

    if benchmark.kind == "horizon":
        doublings = (measured_capability - consts.METR_CAPABILITY_AT_BASE) \
            / consts.METR_CAPABILITY_PER_DOUBLING
        return consts.METR_MINUTES_AT_BASE * (2.0 ** doublings)

    return 0.0
