"""Closed effect vocabulary (§10). Events compose these; rarely extend.

Each effect: (state_bundle, event, params) -> None. state_bundle is a small
namespace the event phase passes in (labs, world, game flags, rng, consts).
"""


def modify_cash(sb, ev, p):
    lab = sb.labs_by_id.get(ev.lab_id)
    if lab is not None:
        lab.cash = max(0.0, lab.cash + p["amount"])


def modify_approval(sb, ev, p):
    sb.world.public_approval = max(0.0, min(100.0, sb.world.public_approval + p["amount"]))


def modify_wtr(sb, ev, p):
    sb.world.wtr = max(0.0, min(100.0, sb.world.wtr + p["amount"]))


def damage_reputation(sb, ev, p):
    lab = sb.labs_by_id.get(ev.lab_id)
    if lab is not None:
        lab.reputation = max(0.0, lab.reputation + p["amount"])


def add_world_harm(sb, ev, p):
    sb.world.world_harm += p["amount"]


def add_impact(sb, ev, p):
    """Impact lands on the RESPONSIBLE lab's ledger only (§0b attributability).
    Rivals are not individually scored, but we keep their ledgers anyway —
    only the player's feeds win/lose."""
    lab = sb.labs_by_id.get(ev.lab_id)
    if lab is not None:
        lab.impact_ledger += p["amount"]
        if p["amount"] > 0:
            lab.impact_positives += p["amount"]


def inject_finding(sb, ev, p):
    """An event hands the responsible lab a free TRUE read (deception caught in
    the wild, etc.)."""
    lab = sb.labs_by_id.get(ev.lab_id)
    if lab is not None:
        lab.findings.append(p["finding"])


def leak_model(sb, ev, p):
    model = p["model"]
    model.leaked = True
    sb.world.leak_event_happened = True


def flag_deception_public(sb, ev, p):
    sb.world.deception_incident_public = True


def flag_damaging(sb, ev, p):
    sb.world.damaging_event_happened = True


def trigger_existential_gate(sb, ev, p):
    sb.flags["existential"] = True
    sb.flags["existential_event"] = ev


def end_game(sb, ev, p):
    sb.flags["game_over"] = True


EFFECTS = {f.__name__: f for f in [
    modify_cash,
    modify_approval,
    modify_wtr,
    damage_reputation,
    add_world_harm,
    add_impact,
    inject_finding,
    leak_model,
    flag_deception_public,
    flag_damaging,
    trigger_existential_gate,
    end_game,
]}


def apply_effects(sb, event):
    for name, params in event.effects:
        EFFECTS[name](sb, event, params)
