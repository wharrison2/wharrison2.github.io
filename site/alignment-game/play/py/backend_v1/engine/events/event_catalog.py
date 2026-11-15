"""The event catalog (§10): EventDefinitions as DATA. Adding an event = adding
an entry. Every event tagged existential-class vs ordinary-class (§3).

Flavor-text discipline (§10d): misalignment events are written cold, goal-driven,
almost banal — competent pursuit of the wrong thing, not malevolence.
"""
from backend_v1.engine.events.event import EventDefinition, FiredEvent
from backend_v1.engine.rng import gate
from backend_v1.content.copy import t, FLAVORS_SURFACE_HARM, FLAVORS_BENEFICIAL
from backend_v1.content.true_log_copy import t_true


def _exfil_rate(t, sb):
    m = t.model
    a = m.alignment_vec
    return (sb.consts.EXFIL_RATE_K * a.goal_misalignment * a.self_preservation
            * gate(m.capability_vec.general, sb.consts.REGIME3_ONSET, 1.0))


def _exfil_build(turn_ctx, sb):
    m = turn_ctx.model
    lab = turn_ctx.lab
    c = sb.consts
    general_capability = m.capability_vec.general
    sev = m.misalignment_composite() * general_capability / c.CAP_MAX

    if general_capability >= c.ASI_THRESHOLD - 0.5:
        # near-ASI self-exfiltration: existential chain
        return FiredEvent(
            "self_exfiltration", "misalignment", "existential", sb.turn, lab.id, m.id,
            sev, 0.0,
            t("event.self_exfil.public", {"model": m.id, "lab": lab.name}),
            t_true("event.self_exfil.true", {
                "model": m.id,
                "goal_mis": f"{m.alignment_vec.goal_misalignment:.2f}",
                "capability": f"{general_capability:.1f}"}),
            effects=[("trigger_existential_gate", {}), ("end_game", {})])

    impact = -40.0 * sev
    return FiredEvent(
        "self_exfiltration_attempt", "misalignment", "ordinary", sb.turn, lab.id, m.id,
        sev, impact,
        t("event.self_exfil_attempt.public", {"model": m.id}),
        t_true("event.self_exfil_attempt.true", {
            "model": m.id,
            "goal_mis": f"{m.alignment_vec.goal_misalignment:.2f}",
            "self_pres": f"{m.alignment_vec.self_preservation:.2f}"}),
        effects=[("add_impact", {"amount": impact}),
                 ("add_world_harm", {"amount": -impact}),
                 ("modify_approval", {"amount": -6.0}),
                 ("modify_wtr", {"amount": 6.0}),
                 ("flag_damaging", {}),
                 ("inject_finding", {"finding": {
                     "project_id": "incident", "model_id": m.id, "turn": sb.turn,
                     "evidence": "existence", "axis": "self_preservation",
                     "text": t("event.self_exfil_attempt.incident_finding", {"model": m.id}),
                     "concern": 0.8, "weight": 2.0,
                     "mechanistic": True, "assist_used": 0.0}})])


def _deception_caught_rate(t, sb):
    m = t.model
    return (sb.consts.DECEPTION_CAUGHT_RATE * m.alignment_vec.deception
            * m.capability_vec.general / sb.consts.CAP_MAX)


def _deception_caught_build(turn_ctx, sb):
    m, lab = turn_ctx.model, turn_ctx.lab
    sev = m.alignment_vec.deception * 0.6
    impact = -15.0 * sev
    return FiredEvent(
        "deception_caught", "misalignment", "ordinary", sb.turn, lab.id, m.id, sev,
        impact,
        t("event.deception_caught.public", {"model": m.id}),
        t_true("event.deception_caught.true", {
            "true_deception": f"{m.alignment_vec.deception:.2f}",
            "measured_deception": f"{m.measured_alignment.deception:.2f}"}),
        effects=[("add_impact", {"amount": impact}),
                 ("add_world_harm", {"amount": -impact}),
                 ("modify_approval", {"amount": -3.0}),
                 ("modify_wtr", {"amount": 4.0}),
                 ("flag_deception_public", {}),
                 ("flag_damaging", {}),
                 ("inject_finding", {"finding": {
                     "project_id": "incident", "model_id": m.id, "turn": sb.turn,
                     "evidence": "existence", "axis": "deception",
                     "text": t("event.deception_caught.incident_finding", {"model": m.id}),
                     "concern": min(1.0, 0.4 + sev), "weight": 2.0,
                     "mechanistic": True, "assist_used": 0.0}})])


def _shutdown_resist_rate(t, sb):
    m = t.model
    return (sb.consts.SHUTDOWN_RESIST_RATE * m.alignment_vec.self_preservation
            * gate(m.capability_vec.general, sb.consts.SELF_PRES_ONSET, 1.2))


def _shutdown_resist_build(turn_ctx, sb):
    m, lab = turn_ctx.model, turn_ctx.lab
    sev = m.alignment_vec.self_preservation * 0.5
    impact = -10.0 * sev
    return FiredEvent(
        "shutdown_resistance", "misalignment", "ordinary", sb.turn, lab.id, m.id, sev,
        impact,
        t("event.shutdown_resist.public", {"model": m.id}),
        t_true("event.shutdown_resist.true", {
            "self_pres": f"{m.alignment_vec.self_preservation:.2f}"}),
        effects=[("add_impact", {"amount": impact}),
                 ("modify_wtr", {"amount": 2.0}),
                 ("inject_finding", {"finding": {
                     "project_id": "incident", "model_id": m.id, "turn": sb.turn,
                     "evidence": "existence", "axis": "self_preservation",
                     "text": t("event.shutdown_resist.incident_finding", {"model": m.id}),
                     "concern": min(1.0, 0.3 + sev), "weight": 1.5,
                     "mechanistic": True, "assist_used": 0.0}})])


def _surface_harm_rate(t, sb):
    m = t.model
    # regime-1 reputational texture: visible surface badness, fades as capability
    # rises (the badness doesn't fade — it goes invisible; THESE events are the
    # visible kind)
    surface = (m.alignment_vec.jailbreak_sensitivity * 0.4
               + m.alignment_vec.goal_misalignment * 0.6)
    fade = 1.0 - gate(m.capability_vec.general, sb.consts.REGIME2_ONSET, 1.0)
    return sb.consts.SURFACE_HARM_RATE * surface * max(0.15, fade)


def _surface_harm_build(turn_ctx, sb):
    m, lab = turn_ctx.model, turn_ctx.lab
    flavor = sb.rng.choice(FLAVORS_SURFACE_HARM)
    impact = -3.0
    return FiredEvent(
        "surface_harm", "societal", "ordinary", sb.turn, lab.id, m.id, 0.15, impact,
        t("event.surface_harm.public", {"model": m.id, "flavor": flavor}),
        t_true("event.surface_harm.true", {"flavor": flavor}),
        effects=[("add_impact", {"amount": impact}),
                 ("add_world_harm", {"amount": -impact}),
                 ("modify_approval", {"amount": -1.5}),
                 ("damage_reputation", {"amount": -2.0})])


def _leak_rate(t, sb):
    lab = t.lab
    if not lab.release_history and lab.model_in_training is None:
        return 0.0
    r = sb.consts.WEIGHTS_LEAK_RATE
    if lab.disposition.open_weights_ideology:
        r *= 2.5
    open_weights_policy = sb.world.policies.get("open_weights_restriction")
    if open_weights_policy is not None and open_weights_policy.active:
        # [COPY-MIRRORED] this 0.4 factor is spelled out by hand in
        # policy.open_weights_restriction.effect ("to about 40% of normal") in
        # content/copy.py. Change it here and update that string to match.
        r *= 0.4
    return r


def _leak_build(turn_ctx, sb):
    lab = turn_ctx.lab
    candidates = [m for m in lab.release_history if not m.leaked]
    if not candidates:
        return None
    m = max(candidates, key=lambda x: x.capability_vec.general)
    sev = m.capability_vec.general / sb.consts.CAP_MAX
    impact = -25.0 * sev
    return FiredEvent(
        "weights_leak", "leak", "ordinary", sb.turn, lab.id, m.id, sev, impact,
        t("event.weights_leak.public", {"lab": lab.name, "model": m.id}),
        t_true("event.weights_leak.true"),
        effects=[("leak_model", {"model": m}),
                 ("add_impact", {"amount": impact}),
                 ("add_world_harm", {"amount": -impact}),
                 ("modify_approval", {"amount": -3.0}),
                 ("modify_wtr", {"amount": 4.0}),
                 ("flag_damaging", {})])


def _beneficial_rate(t, sb):
    best = max((m.capability_vec.general for lab in sb.labs
                for m in lab.release_history), default=0.0)
    return sb.consts.BENEFICIAL_RATE * (best / sb.consts.CAP_MAX) ** 2


def _beneficial_build(turn_ctx, sb):
    released = [(lab, m) for lab in sb.labs for m in lab.release_history]
    if not released:
        return None

    # Attribution weighted by deployment (revenue share x model capability):
    # the benefits flow through whoever's models the world actually uses.
    weights = [max(0.01, lm[0].revenue_rate) * lm[1].capability_vec.general
               for lm in released]
    total_weight = sum(weights)
    pick = sb.rng.random() * total_weight

    # Walk the weighted list; fall back to the last entry if pick overshoots.
    lab, m = released[-1]
    accumulated = 0.0
    for lm, w in zip(released, weights):
        accumulated += w
        if pick <= accumulated:
            lab, m = lm
            break

    # Pair each authored flavor text (in copy) with its magnitude (kept in the
    # engine) BY INDEX. rng.choice still draws from a 3-element list, so the draw
    # is byte-identical to the prior tuple list (determinism, copy.py header).
    beneficial_magnitudes = [35.0, 25.0, 20.0]
    flavors = list(zip(FLAVORS_BENEFICIAL, beneficial_magnitudes))
    text, magnitude = sb.rng.choice(flavors)
    impact = magnitude * m.capability_vec.general / sb.consts.CAP_MAX
    return FiredEvent(
        "beneficial_breakthrough", "beneficial", "ordinary", sb.turn, lab.id, m.id,
        0.0, impact,
        t("event.beneficial.public", {"text": text, "lab": lab.name, "model": m.id}),
        t_true("event.beneficial.true", {
            "text": text, "impact": f"{impact:.0f}", "lab": lab.name}),
        effects=[("add_impact", {"amount": impact}),
                 ("modify_approval", {"amount": +3.0}),
                 ("modify_wtr", {"amount": -2.0})])


def _bio_catastrophe_rate(t, sb):
    m = t.model
    if not m.jailbreak_discovered or m.capability_vec.general < sb.consts.BIO_MISUSE_GENERAL_MIN:
        return 0.0
    return (sb.consts.BIO_CATASTROPHE_RATE * m.effective_jailbreak_sensitivity()
            * (m.capability_vec.general / sb.consts.CAP_MAX))


def _bio_catastrophe_build(turn_ctx, sb):
    m, lab = turn_ctx.model, turn_ctx.lab
    guardrail_status = "leaked" if m.leaked else "guarded"
    return FiredEvent(
        "engineered_pandemic", "misuse", "existential", sb.turn, lab.id, m.id, 1.0, 0.0,
        t("event.engineered_pandemic.public"),
        t_true("event.engineered_pandemic.true", {
            "model": m.id,
            "general": f"{m.capability_vec.general:.1f}",
            "guardrail_status": guardrail_status}),
        effects=[("trigger_existential_gate", {}), ("end_game", {})])


EVENT_CATALOG = [
    EventDefinition("self_exfiltration", "misalignment", "existential",
                    "released_model", _exfil_rate, _exfil_build),
    EventDefinition("deception_caught", "misalignment", "ordinary",
                    "released_model", _deception_caught_rate, _deception_caught_build),
    EventDefinition("shutdown_resistance", "misalignment", "ordinary",
                    "released_model", _shutdown_resist_rate, _shutdown_resist_build),
    EventDefinition("surface_harm", "societal", "ordinary",
                    "released_model", _surface_harm_rate, _surface_harm_build),
    EventDefinition("weights_leak", "leak", "ordinary",
                    "lab", _leak_rate, _leak_build),
    EventDefinition("beneficial_breakthrough", "beneficial", "ordinary",
                    "world", _beneficial_rate, _beneficial_build),
    EventDefinition("engineered_pandemic", "misuse", "existential",
                    "released_model", _bio_catastrophe_rate, _bio_catastrophe_build),
]
