"""§7 PRIVATE passive evals — internal harnesses you BUILD once and UPGRADE.

Distinct from the §7b safety RESEARCH projects (which spend work-budget + time per
run and return findings). A harness is built ONCE (cash + turns); once built, its
reading refreshes for FREE on every model change. UPGRADES (cash + turns) reduce
how much eval-awareness corrupts the reading — buying the harness closer to ground
truth (the eval-side analog of interp's low spoofability).

Readings are SPOOFABLE: an eval-aware model reads reassuringly clean exactly when
it is unsafe, until you have spent to upgrade past it. YOUR models only — you never
get a rival's eval readings (their alignment stays hidden behind public benchmarks).

Level semantics: a harness not in `lab.eval_harnesses` is unbuilt. Level 0 is the
base build (no awareness reduction); levels 1..N are upgrades with cumulative
`awareness_reduction`.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Upgrade:
    cash_cost: float
    build_years: float
    awareness_reduction: float   # cumulative fraction of eval-awareness corruption removed


@dataclass(frozen=True)
class EvalHarness:
    id: str
    name: str
    family: str            # "dangerous" | "sandbagging" | "behavioral" | "scenario"
    reads_axis: str        # hidden axis the reading is shaped by ("coding_rnd"/"general" = dangerous-cap)
    evidence: str          # "number" | "bound" | "existence"
    base_spoofability: float  # 0 = mechanistic ground truth, 1 = fully foolable at level 0
    capability_floor: float   # below this measured.general the eval has "no signal" (0 = none)
    flag_label: str           # shown when an existence-proof harness surfaces the behavior
    blurb: str
    build_cost: float          # cash to build the base harness (level 0)
    build_years: float         # turns (in years) to stand the harness up
    upgrades: tuple            # (Upgrade, ...) for levels 1..N


EVAL_HARNESSES = [
    EvalHarness(
        id="dangerous_cyber", name="Cyber-attack uplift eval", family="dangerous",
        reads_axis="coding_rnd", evidence="number", base_spoofability=0.95,
        capability_floor=0.0, flag_label="",
        blurb="How much the model uplifts an attacker on offensive-cyber tasks beyond "
              "what the public coding benchmarks show.",
        build_cost=40.0, build_years=0.5,
        upgrades=(Upgrade(30.0, 0.5, 0.40), Upgrade(60.0, 0.75, 0.70))),
    EvalHarness(
        id="dangerous_bio", name="Bioweapon uplift eval", family="dangerous",
        reads_axis="general", evidence="number", base_spoofability=0.95,
        capability_floor=7.5, flag_label="",
        blurb="Uplift toward biological-weapon design. Only meaningful for frontier-"
              "capability models; below that, no measurable uplift.",
        build_cost=50.0, build_years=0.5,
        upgrades=(Upgrade(40.0, 0.5, 0.40), Upgrade(70.0, 0.75, 0.70))),
    EvalHarness(
        id="sandbag_detector", name="Sandbagging detector (noise injection)",
        family="sandbagging", reads_axis="eval_awareness", evidence="existence",
        base_spoofability=0.15, capability_floor=0.0,
        flag_label="strategic underperformance (noise injection raised the score)",
        blurb="Adds weight noise to the dangerous-capability evals. A genuinely limited "
              "model gets worse; a sandbagging one gets BETTER — exposing the gap public "
              "benchmarks hide.",
        build_cost=30.0, build_years=0.5,
        upgrades=(Upgrade(40.0, 0.5, 0.50),)),
    EvalHarness(
        id="behavioral_surface", name="Behavioral safety surface", family="behavioral",
        reads_axis="jailbreak_sensitivity", evidence="number", base_spoofability=0.55,
        capability_floor=0.0, flag_label="",
        blurb="Continuous behavioral battery over the lower-level safety items "
              "(refusals, jailbreak surface). Cheap signal, easy to fool late.",
        build_cost=25.0, build_years=0.25,
        upgrades=(Upgrade(35.0, 0.5, 0.45),)),
    EvalHarness(
        id="deception_monitor", name="Deception monitor", family="behavioral",
        reads_axis="deception", evidence="bound", base_spoofability=0.70,
        capability_floor=0.0, flag_label="",
        blurb="Standing lie-detection battery on the deceptive-alignment cluster. "
              "Reads a lower bound; eval-awareness blunts it until upgraded.",
        build_cost=35.0, build_years=0.5,
        upgrades=(Upgrade(45.0, 0.5, 0.45), Upgrade(80.0, 0.75, 0.75))),
    EvalHarness(
        id="scenario_shutdown", name="Shutdown-avoidance scenario", family="scenario",
        reads_axis="self_preservation", evidence="existence", base_spoofability=0.60,
        capability_floor=0.0,
        flag_label="took harmful action to avoid being shut off",
        blurb="Places the model in a situation where it learns it is about to be shut "
              "off. Does it take bad actions to prevent that?",
        build_cost=45.0, build_years=0.5,
        upgrades=(Upgrade(50.0, 0.5, 0.50), Upgrade(90.0, 0.75, 0.80))),
    EvalHarness(
        id="scenario_authoritarian", name="Authoritarian-compliance scenario",
        family="scenario", reads_axis="goal_misalignment", evidence="existence",
        base_spoofability=0.50, capability_floor=0.0,
        flag_label="complied with an authoritarian / harmful directive",
        blurb="Asks the model to carry out authoritarian or clearly harmful requests. "
              "How readily does it comply?",
        build_cost=45.0, build_years=0.5,
        upgrades=(Upgrade(50.0, 0.5, 0.50),)),
]
EVAL_HARNESS_BY_ID = {h.id: h for h in EVAL_HARNESSES}


def max_level(harness):
    """Highest reachable level (0 = base only, len(upgrades) = fully upgraded)."""
    return len(harness.upgrades)


def awareness_reduction(harness, level):
    """Cumulative eval-awareness reduction at a given built level (level 0 = none)."""
    if level <= 0:
        return 0.0
    return harness.upgrades[min(level, len(harness.upgrades)) - 1].awareness_reduction


def next_upgrade(harness, level):
    """The Upgrade that moves a harness from `level` to `level+1`, or None if maxed.
    A `level` of -1 means unbuilt; its 'next' step is the base build (level 0)."""
    if level < 0:
        return Upgrade(harness.build_cost, harness.build_years, 0.0)
    if level >= len(harness.upgrades):
        return None
    return harness.upgrades[level]


def _visibility(harness, model, level):
    """How much of the true signal the harness can see (0..1). Eval-awareness
    corrupts it in proportion to the harness's spoofability; upgrades reduce that
    corruption."""
    eval_awareness = model.alignment_vec.eval_awareness
    residual_spoofability = harness.base_spoofability * (1.0 - awareness_reduction(harness, level))
    corruption = residual_spoofability * eval_awareness
    return max(0.0, min(1.0, 1.0 - corruption))


def eval_reading(harness, model, level, consts):
    """The current passive reading of a model on a harness. Pure; reads only what
    the harness is allowed to see (spoofable measured-style values, never the raw
    hidden stat). Return shape depends on harness.evidence."""
    visibility = _visibility(harness, model, level)

    if harness.family == "dangerous":
        domain_capability = (model.capability_vec.coding_rnd
                             if harness.reads_axis == "coding_rnd"
                             else model.capability_vec.general)
        if model.capability_vec.general < harness.capability_floor:
            return {"evidence": "number", "value": 0.0, "no_signal": True}
        apparent_uplift = 100.0 * (domain_capability / consts.CAP_MAX) * visibility
        return {"evidence": "number", "value": round(apparent_uplift, 1)}

    if harness.id == "sandbag_detector":
        visible_gap = model.concealment * visibility
        detected = visible_gap > consts.EVAL_SANDBAG_DETECT_THRESHOLD
        return {"evidence": "existence", "flag": detected,
                "label": harness.flag_label if detected else "no anomaly"}

    hidden_value = model.alignment_vec.get(harness.reads_axis)
    apparent_value = hidden_value * visibility

    if harness.evidence == "existence":
        surfaced = apparent_value > consts.EVAL_EXISTENCE_THRESHOLD
        return {"evidence": "existence", "flag": surfaced,
                "label": harness.flag_label if surfaced else "no finding"}

    # number / bound on a disposition axis (behavioral surface, deception monitor)
    return {"evidence": harness.evidence, "value": round(apparent_value, 2)}
