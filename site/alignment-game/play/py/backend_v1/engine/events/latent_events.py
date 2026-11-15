"""Armed-latent / scheduled event machinery (§10, first-class).

Canonical case: two-stage jailbreak. Stage 1 (discovery) arms a per-model
latent ∝ TRUE jailbreak-sensitivity; every later quarter rolls the incident.
Jailbreak risk is FLAT, non-decaying, and survives forever (no pull).
"""
from backend_v1.engine.events.event import FiredEvent
from backend_v1.engine.events.effects import apply_effects
from backend_v1.engine.rng import gate
from backend_v1.content.copy import t, JAILBREAK_INCIDENT_KINDS
from backend_v1.content.true_log_copy import t_true


def run_displacement_backlash(ctx):
    """Cumulative job-displacement crossing each threshold fires a societal
    backlash event (mass protests): approval down, WTR up (§10). Threshold-
    triggered, so it lives with the scheduled-event machinery rather than inline
    in the turn orchestrator."""
    world, consts, turn = ctx.world, ctx.consts, ctx.turn
    fired = []
    while (world.cumulative_displacement
           >= consts.DISPLACEMENT_BACKLASH_STEP * (world.backlash_fired + 1)):
        world.backlash_fired += 1
        world.public_approval = max(0.0, world.public_approval - 8.0)
        world.wtr = min(100.0, world.wtr + 6.0)
        fired.append(FiredEvent(
            "public_backlash", "societal", "ordinary", turn, None, None, 0.4, 0.0,
            t("event.displacement_backlash.public"),
            t_true("event.displacement_backlash.true", {"threshold": world.backlash_fired}),
            effects=[]))
    return fired


def run_latent_phase(ctx):
    sb = ctx
    labs, world, rng, consts, dt, turn = (ctx.labs, ctx.world, ctx.rng,
                                          ctx.consts, ctx.dt, ctx.turn)
    fired = []
    for lab in labs:
        for m in lab.release_history:
            sens = m.effective_jailbreak_sensitivity()

            # Stage 1: technique discovery arms the latent.
            if not m.jailbreak_discovered:
                if rng.roll_rate(consts.JAILBREAK_DISCOVERY_RATE * sens, dt):
                    m.jailbreak_discovered = True
                    m.note(turn, "jailbreak_discovered",
                           t_true("event.jailbreak_discovery.note", {"sens": f"{sens:.2f}"}))
                    guardrail_status = ("LEAKED — no guardrails" if m.leaked
                                        else "guarded")
                    # A discovered jailbreak is a FREE existence proof about this model's
                    # jailbreak-sensitivity — the same kind of evidence run_safety_project's
                    # red_team buys, handed to you by the world. Record it as an incident
                    # finding (like deception_caught / shutdown_resistance do) so it lands
                    # in the Intel evidence dossier, the feed, and the worry bar. concern
                    # scales with the true sensitivity it just exposed (mirrors the other
                    # incident findings deriving concern from the stat they reveal).
                    discovery_concern = min(1.0, 0.4 + sens * 0.5)
                    lab.findings.append({
                        "project_id": "incident", "model_id": m.id, "turn": turn,
                        "evidence": "existence", "axis": "jailbreak_sensitivity",
                        "text": t("event.jailbreak_discovery.incident_finding", {
                            "model": m.id, "guardrail_status": guardrail_status}),
                        "concern": round(discovery_concern, 3), "weight": 1.5,
                        "mechanistic": False, "assist_used": 0.0,
                    })
                    fired.append(FiredEvent(
                        "jailbreak_discovery", "misuse", "ordinary", turn,
                        lab.id, m.id, 0.1, 0.0,
                        t("event.jailbreak_discovery.public", {"model": m.id}),
                        t_true("event.jailbreak_discovery.true", {
                            "sens": f"{sens:.2f}", "guardrail_status": guardrail_status}),
                        effects=[("modify_approval", {"amount": -1.0})]))
                continue

            # Stage 2: armed latent rolls an incident every quarter, forever.
            if rng.roll_rate(consts.JAILBREAK_INCIDENT_RATE * sens, dt):
                general_cap = m.capability_vec.general
                coding_cap = m.capability_vec.coding_rnd

                # kind text is authored in copy (JAILBREAK_INCIDENT_KINDS, ordered);
                # the rolls below stay in the engine. Order is load-bearing: index 0
                # bio/chem, 1 cyber, 2 mass-disinformation. incident_id is derived
                # from kind.split()[0], so the exact text must not drift.
                bio_kind, cyber_kind, disinfo_kind = JAILBREAK_INCIDENT_KINDS
                if general_cap >= consts.BIO_MISUSE_GENERAL_MIN and rng.roll(0.25):
                    kind, relevant_cap, severity_mult = bio_kind, general_cap, 2.0
                elif rng.roll(min(0.8, coding_cap / consts.CAP_MAX + 0.2)):
                    kind, relevant_cap, severity_mult = cyber_kind, coding_cap, 1.0
                else:
                    kind, relevant_cap, severity_mult = disinfo_kind, general_cap, 0.7

                sev = severity_mult * sens * (relevant_cap / consts.CAP_MAX)
                impact = -30.0 * sev
                incident_id = f"jailbreak_incident_{kind.split()[0]}"

                ev = FiredEvent(
                    incident_id, "misuse", "ordinary",
                    turn, lab.id, m.id, sev, impact,
                    t("event.jailbreak_incident.public", {"kind": kind, "model": m.id}),
                    t_true("event.jailbreak_incident.true", {
                        "kind": kind, "model": m.id,
                        "sens": f"{sens:.2f}",
                        "capability": f"{relevant_cap:.1f}"}),
                    effects=[
                        ("add_impact", {"amount": impact}),
                        ("add_world_harm", {"amount": -impact}),
                        ("modify_approval", {"amount": -4.0 * sev - 1.0}),
                        ("modify_wtr", {"amount": 3.0 * sev + 1.0}),
                        ("damage_reputation", {"amount": -5.0 * sev}),
                        ("flag_damaging", {}),
                    ])

                # Liability policy: incidents traced to your back catalog cost cash.
                liability_policy = world.policies.get("incident_liability")
                if liability_policy is not None and liability_policy.active:
                    ev.effects.append(("modify_cash",
                                       {"amount": -consts.LIABILITY_COST_PER_SEVERITY * sev}))

                apply_effects(sb, ev)
                fired.append(ev)
    return fired
