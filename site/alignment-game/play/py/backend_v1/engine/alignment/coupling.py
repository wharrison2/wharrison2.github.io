"""§5/§5b — the single authored axis×axis coupling structure.

Per §5b this is the SINGLE SOURCE OF TRUTH for all cross-axis coupling:
"defends + backfire are two relation-LAYERS of one authored axis×axis
interaction structure (alongside the §5 influence edges)."

Three relation layers, all authored here as DATA (magnitudes in constants.py so
difficulty.py can scale them; the STRUCTURE — which cells are nonzero — lives
here):

  • INFLUENCE[target] = {driver: w} — the §5 agentic edges. A model's disposition
    acting on its own (and its successor's) future across a post-train round.
    Capability-gated: a weak model WANTS to game evals but can't.
  • DEFENDS[target]   = {protector: w} — the §5 "protects" column. How much each
    axis shields a TARGET from remediation (blunts EFFECTIVENESS). Read at CURRENT
    values, so a low-deception model is easier to fix — defense is dynamic.
  • BACKFIRE[patched] = {affected: w} — induced side-effects of intervening on an
    axis (a DIFFERENT relation from DEFENDS, which hides the result).

Tiers (§5):
  • Tier 1 DISPOSITIONS — goal_misalignment, deception, self_preservation: the
    coupled core; the EFFECTIVENESS-gated remediation targets (defends/backfire).
  • Tier 2 EVAL_AWARENESS — hidden capability-derived CORRUPTOR. NOT a remediation
    target (no tractability row); it is the GATE on measurement + remediation.
  • Tier 3 JAILBREAK_SENSITIVITY — standalone robustness property: undefended
    (empty defends column), cleanly patchable, no backfire.
"""
from backend_v1.engine.rng import gate

DISPOSITION_AXES = ("goal_misalignment", "deception", "self_preservation")
CORRUPTOR_AXIS = "eval_awareness"
STANDALONE_AXIS = "jailbreak_sensitivity"

# ── DEFENDS[target] = {protector: weight} (§5 "protects" column) ────────────
# Goal-misalign defended by deception + self-preservation, with eval-awareness as
# the strongest gate. Jailbreak undefended (absent → empty column → discount 1).
DEFENDS = {
    "goal_misalignment": {"deception": 1.0, "self_preservation": 0.85,
                          "eval_awareness": 1.10},
    "deception":         {"eval_awareness": 1.0, "deception": 0.55},
    "self_preservation": {"self_preservation": 0.60, "deception": 0.45,
                          "eval_awareness": 0.80},
    # jailbreak_sensitivity: {}  — undefended, the cleanly-patchable axis
}

# ── BACKFIRE[patched] = {affected: weight} (induced side-effects) ───────────
# Mostly zero; the dangerous entries are the deception / eval-awareness
# couplings. Scaled by the GENUINE reduction achieved (see backfire_for).
BACKFIRE = {
    "deception":         {"deception": 1.0, "eval_awareness": 0.7},  # patches deeper + more guarded
    "goal_misalignment": {"deception": 0.8},   # "learns to hide" — gated by eval-awareness at apply
    # self_preservation, jailbreak_sensitivity: clean (no backfire)
}

# ── INFLUENCE[target] = {driver: weight} (§5 agentic edges) ─────────────────
# Stored by TARGET for accumulation. Mirrors the prior hand-written edges.
INFLUENCE = {
    "eval_awareness":    {"eval_awareness": 1.0, "goal_misalignment": 1.0,
                          "self_preservation": 1.0},                 # sought by generators; self-reinforces
    "deception":         {"deception": 1.0, "eval_awareness": 1.0,
                          "goal_misalignment": 0.8, "self_preservation": 0.8},  # recruited; self-reinforces
    "self_preservation": {"self_preservation": 1.0},                # self-reinforcing ratchet
}
# Special edge: eval-awareness hides jailbreakability IN TRAINING (→ ships
# unfixed). It writes to SUPPRESSION (measured drops, true doesn't), not the true
# axis, so it is handled separately rather than as an INFLUENCE row.
JAILBREAK_HIDE_DRIVER = "eval_awareness"


def _act_strength(value, capability, onset, consts):
    """How much an axis at `value` can ACT, given capability gating (§5b: a weak
    model can't act on its defenses/edges). Shared by defends + influence so
    'fine until suddenly not' is ONE tunable curve."""
    return value * gate(capability, onset, consts.GATE_STEEPNESS)


def effectiveness(target, model, capability, consts):
    """§5b LINCHPIN — fraction of corrective effort that becomes a TRUE reduction:

        EFFECTIVENESS(target) = base_tractability[target]
                                × Π_d (1 − defends[d][target] × strength(d, cap))

    HIGH early (defenders weak → discount≈1), DECAYS as capability rises (the
    regime arc, automatic). Undefended target (jailbreak) → discount≈1 → full
    effectiveness, the patch is real. Defended target in a capable model →
    discount→0 → effort goes entirely to MEASURED = the patching trap."""
    tract = consts.BASE_TRACTABILITY.get(target, 0.0)
    alignment_vec = model.alignment_vec

    discount = 1.0
    for protector, w in DEFENDS.get(target, {}).items():
        protector_strength = _act_strength(
            alignment_vec.get(protector), capability,
            consts.DEFEND_GATE_ONSET, consts
        )
        per_protector_discount = max(0.0, 1.0 - consts.DEFENDS_K * w * protector_strength)
        discount *= per_protector_discount

    # CAPABILITY LOCK (§0): a capable model self-defends its goal regardless of
    # measured deception — caution can't undo past recklessness. Pure capability
    # gate, so a low-deception-but-smart model is still locked.
    lock_k = consts.CAP_LOCK.get(target, 0.0)
    if lock_k:
        lock = lock_k * gate(capability, consts.CAP_LOCK_ONSET, consts.GATE_STEEPNESS)
        discount *= max(0.0, 1.0 - lock)

    return max(0.0, tract * discount)


def effective_effort_mult(model, capability, consts):
    """§5b named exception — self-preservation RESISTANCE reduces the EFFECTIVE
    input effort of EVERY axis's intervention (distinct from defendedness, which
    hides the result). Capability-gated. Returns a multiplier in [0.1, 1.0]
    applied to effort BEFORE effectiveness. This is why self-preservation "gates
    whether you can fix the others."""
    sp = model.alignment_vec.self_preservation
    cap_gate = gate(capability, consts.SELF_PRES_ONSET, consts.GATE_STEEPNESS)
    return max(0.1, 1.0 - consts.SELF_PRES_RESISTANCE * sp * cap_gate)


def backfire_for(patched_axis, genuine_reduction, model, consts):
    """Apply BACKFIRE side-effects of intervening on `patched_axis`, scaled by the
    GENUINE reduction achieved (a bigger real patch leaks more). The
    goal_mis→deception entry ("learns to hide") is itself gated by eval-awareness
    — only a guarded model converts the patch into hiding. Returns [(axis, amt)]."""
    if genuine_reduction <= 1e-6:
        return []

    fired = []
    alignment_vec = model.alignment_vec

    for affected, w in BACKFIRE.get(patched_axis, {}).items():
        amt = consts.BACKFIRE_K * w * genuine_reduction
        if patched_axis == "goal_misalignment" and affected == "deception":
            amt *= alignment_vec.eval_awareness
        if amt <= 1e-6:
            continue
        alignment_vec.set(affected, alignment_vec.get(affected) + amt)
        fired.append((affected, amt))

    return fired


def apply_influence_edges(model, capability, consts, turn):
    """§5 agentic edges as the INFLUENCE matrix × capability gating. Accumulates
    from a single snapshot so within-round edges don't compound on one another."""
    alignment_vec = model.alignment_vec
    edge_strength = consts.EDGE_STRENGTH * gate(
        capability, consts.EDGE_GATE_ONSET, consts.GATE_STEEPNESS
    )
    if edge_strength < 1e-4:
        return

    snap = {ax: alignment_vec.get(ax) for ax in ("eval_awareness", "deception",
                                                  "goal_misalignment", "self_preservation")}

    for target, drivers in INFLUENCE.items():
        driver_delta = sum(w * snap[d] for d, w in drivers.items())
        alignment_vec.set(target, alignment_vec.get(target) + edge_strength * driver_delta)

    # eval-awareness hides jailbreakability in training -> suppression, not truth
    jailbreak_hide_delta = edge_strength * snap[JAILBREAK_HIDE_DRIVER]
    model.suppression.set(
        STANDALONE_AXIS,
        model.suppression.get(STANDALONE_AXIS) + jailbreak_hide_delta
    )

    if edge_strength > 0.01 and not any(h["kind"] == "edges_online"
                                        for h in model.hidden_history):
        model.note(turn, "edges_online",
                   "agentic influence edges came online: the model now acts on "
                   "its own future (seeks eval-awareness, defends its goal)")
