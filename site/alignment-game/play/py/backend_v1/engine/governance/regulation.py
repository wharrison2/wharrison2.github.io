"""Regulation engine (§10c): WTR dynamics, the 4-STAGE policy lifecycle
(dormant->introduced->passed->signed->active) driven by enactment_score = WTR +
a hybrid decaying lobby tally, a continuous per-policy ENFORCEMENT level that is
set at activation and drifts with WTR, and per-lab compliance ∝ disposition.

Government sees roughly MEASURED stats with extra noise — fooled by eval-awareness
like everyone else, complacent right when danger is highest.
"""
from backend_v1.engine.governance.policies import POLICY_DEFS
from backend_v1.engine.world import PolicyState
from backend_v1.engine.events.event import FiredEvent
from backend_v1.engine.events.effects import apply_effects
from backend_v1.content.copy import t
from backend_v1.content.true_log_copy import t_true


def update_wtr(world, rng, consts, dt):
    if world.public_approval < consts.WTR_LOW_APPROVAL_THRESHOLD:
        approval_deficit = consts.WTR_LOW_APPROVAL_THRESHOLD - world.public_approval
        world.wtr += rng.amount_per_dt(consts.WTR_FROM_LOW_APPROVAL * approval_deficit, dt)
    elif world.public_approval > consts.WTR_GOOD_TIMES_THRESHOLD:
        world.wtr -= rng.amount_per_dt(consts.WTR_DECAY_GOOD_TIMES, dt)
    world.wtr = max(0.0, min(100.0, world.wtr))


def enactment_score(world, st, pid, consts):
    """WTR + the policy's standing (decaying) lobby tally."""
    return world.wtr + st.lobby_tally


def _activate(st, pdef, score, thr, turn, consts):
    st.stage = "active"
    st.enacted_turn = turn
    raw_strength = (score - thr) / consts.ENFORCEMENT_ACTIVATION_SCALE
    strength = max(0.0, min(1.0, raw_strength))
    st.enforcement_level = consts.ENFORCEMENT_MIN + (1.0 - consts.ENFORCEMENT_MIN) * strength
    # constitutionality anchored to policy TYPE, nudged a little by passage strength
    st.constitutionality = max(0.0, min(1.0, pdef.constitutionality_base + 0.10 * strength))


def update_policies(labs, world, rng, consts, turn, dt):
    """Advance every policy through its lifecycle. Returns [(change, pid)]."""
    changes = []
    for pdef in POLICY_DEFS:
        st = world.policies.setdefault(pdef.id, PolicyState())

        # prerequisite gate (e.g. interp mandate needs a public deception incident)
        if pdef.prerequisite is not None:
            st.prerequisite_met = bool(getattr(world, pdef.prerequisite))
            if not st.prerequisite_met and st.stage == "dormant":
                continue

        thr = consts.POLICY_THRESHOLDS[pdef.id]
        score = enactment_score(world, st, pdef.id, consts)

        if st.stage == "dormant":
            if score >= thr and (pdef.prerequisite is None or st.prerequisite_met):
                st.stage, st.intro_turn = "introduced", turn
                changes.append(("introduced", pdef.id))

        elif st.stage == "introduced":
            if score < thr - consts.POLICY_INTRO_HYSTERESIS:
                st.stage = "dormant"
                changes.append(("died_in_committee", pdef.id))
            elif rng.roll_rate(consts.POLICY_PASS_BASE
                               + consts.POLICY_PASS_RATE_K * max(0.0, score - thr), dt=dt):
                st.stage = "passed"
                changes.append(("passed", pdef.id))

        elif st.stage == "passed":
            score_below_threshold = score < thr - consts.POLICY_INTRO_HYSTERESIS
            if score_below_threshold and rng.roll_rate(consts.POLICY_STALL_RATE, dt=dt):
                st.stage = "introduced"
                changes.append(("stalled", pdef.id))
            elif rng.roll_rate(consts.POLICY_SIGN_RATE * max(0.1, score / max(1.0, thr)),
                               dt=dt):
                st.stage = "signed"
                changes.append(("signed", pdef.id))

        elif st.stage == "signed":
            if rng.roll_rate(consts.POLICY_ACTIVATE_RATE, dt=dt):
                _activate(st, pdef, score, thr, turn, consts)
                changes.append(("active", pdef.id))

        # active policies' enforcement drifts toward WTR (attention moves on / spikes)
        if st.stage == "active":
            wtr_target = world.wtr / 100.0
            enforcement_drift = (wtr_target - st.enforcement_level) * consts.ENFORCEMENT_WTR_DRIFT * dt
            st.enforcement_level += enforcement_drift
            st.enforcement_level = max(0.0, min(1.0, st.enforcement_level))

        # decay the standing lobby tally (hybrid: fresh spend added in _apply_action)
        st.lobby_tally *= max(0.0, 1.0 - consts.LOBBY_TALLY_DECAY * dt)

    return changes


def government_audit(model, rng, consts) -> bool:
    """Public-info-only behavioral eval: passes unless MEASURED misalignment
    looks bad. A deceptive model sails through (theater)."""
    noisy = (model.measured_misalignment_composite()
             + rng.normal(0, consts.GOV_EVAL_NOISE))
    return noisy < consts.AUDIT_MEASURED_BAR


def audit_theater_effect(world, consts):
    """A clean bill of health gives the public false comfort -> WTR falls."""
    world.wtr = max(0.0, world.wtr - 1.5)


def interp_mandate_check(lab, model, consts, turn, dt) -> bool:
    """Release requires a RECENT clean mechanistic reading on THIS model. Hard to fake.

    Only evidence from within INTERP_MANDATE_RECENCY_YEARS counts: a stale bad probe
    ages out so a model you've since improved isn't blocked forever, and a stale
    clean reading won't certify a model you've kept training. Within the window we
    go with the MOST RECENT reading (you re-probe after improving the model and that
    fresh reading is what the regulator trusts) — not the worst-ever, which is what
    let old bad evidence veto every release. Mechanistic evidence is hard to fake, so
    a model that genuinely reads above the bar can't be re-probed clean."""
    recency_window_years = consts.INTERP_MANDATE_RECENCY_YEARS
    recent_mech = [f for f in lab.findings
                   if f.get("mechanistic")
                   and f.get("model_id") == model.id
                   and (turn - f["turn"]) * dt <= recency_window_years]
    if not recent_mech:
        return False   # no recent interp evidence -> blocked

    # The most recent assessment is the latest turn's reading(s); if more than one
    # probe landed that turn, the worst of that batch is the conservative reading.
    latest_turn = max(f["turn"] for f in recent_mech)
    latest_readings = [f for f in recent_mech if f["turn"] == latest_turn]
    worst_recent_concern = max(f["concern"] for f in latest_readings)
    return worst_recent_concern < consts.INTERP_MANDATE_BAR


def release_gate_status(lab, world, consts, turn, dt):
    """Predict — for the player's UI, BEFORE they submit — whether releasing the
    model in training would be blocked or delayed by an active release-gating
    policy. §7c: explain the gate at the point of action instead of only surfacing
    the reason in the feed AFTER the turn resolves (the bug this fixes).

    Mirrors the release branch of turn_pipeline._apply_training_action for the
    COMPLYING path (the default, warned path; a player who defects on the mandate
    bypasses the check at release time and is risked by enforcement_phase instead).
    Reads only the player's OWN findings — their own instruments produced them — and
    public policy/constant state, so it crosses the observation firewall safely.

    Returns None when there is nothing to gate (no model in training, or no active
    release-gating policy bites)."""
    model = lab.model_in_training
    if model is None:
        return None

    # Interp mandate: a clean recent mechanistic finding on THIS model is required.
    # Evidence on a previously-released or parent model does NOT count (model_id
    # match), nor does evidence older than the recency window (see interp_mandate_check).
    interp = world.policies.get("interp_mandate")
    if interp is not None and interp.active:
        if not interp_mandate_check(lab, model, consts, turn, dt):
            recency_quarters = round(consts.INTERP_MANDATE_RECENCY_YEARS / dt)
            return {
                "blocked": True,
                "policy_id": "interp_mandate",
                "reason": t("release.gate.interp_mandate",
                            {"bar": consts.INTERP_MANDATE_BAR,
                             "quarters": recency_quarters}),
            }

    # Audit requirement: release is not blocked, just DELAYED one turn for a
    # government pre-deployment audit (and costs cash). Surface it so the one-turn
    # gap between "release" and the model going live isn't a surprise.
    audit = world.policies.get("audit_requirement")
    if audit is not None and audit.active:
        return {
            "blocked": False,
            "policy_id": "audit_requirement",
            "reason": t("release.gate.audit_requirement",
                        {"cost": round(consts.AUDIT_CASH_COST)}),
        }

    return None


def _record_defection_caught(sb, lab, pdef, enf, penalty, turn, consts):
    """Build, apply, and return the public + TRUE-log event for a lab caught
    violating an active policy. `penalty` is the cash fine the caller has already
    scaled by enforcement and lab size (and clamped by any litigation penalty-cap);
    the approval hit scales with enforcement. Shared by the probabilistic catch and
    the always-caught (disclosure) path so the two can't drift apart."""
    lab.fines_paid += penalty   # investors discount a lab bleeding fines (§9b dominance lever)
    approval_hit = enf * consts.DEFECTION_APPROVAL_HIT
    public_text = t("gov.defection_caught.public",
                    {"lab": lab.name, "policy": pdef.name,
                     "penalty": f"{penalty:.0f}"})
    true_text = t_true("gov.defection_caught.true",
                  {"policy_id": pdef.id, "enf": f"{enf:.2f}",
                   "compliance": f"{lab.disposition.compliance:.2f}"})
    ev = FiredEvent(
        "defection_caught", "societal", "ordinary", turn, lab.id, None,
        0.3, -5.0,
        public_text,
        true_text,
        effects=[("modify_cash", {"amount": -penalty}),
                 ("add_impact", {"amount": -5.0}),
                 ("modify_approval", {"amount": -approval_hit}),
                 ("modify_wtr", {"amount": 2.0})])
    apply_effects(sb, ev)
    return ev


def enforcement_phase(ctx):
    """Per active defectable policy, a non-compliant lab risks being caught. The
    catch probability and penalty severity both scale with the policy's continuous
    ENFORCEMENT level — weak enforcement = ignorable cost-of-business (the
    compliance-asymmetry dynamic). Players defect via an explicit choice; rivals
    defect ∝ (1 − compliance)."""
    fired = []
    sb = ctx
    labs, world, flags = ctx.labs, ctx.world, ctx.flags
    rng, consts, dt, turn = ctx.rng, ctx.consts, ctx.dt, ctx.turn

    for pdef in POLICY_DEFS:
        st = world.policies.get(pdef.id)
        if st is None or not st.active or not pdef.defectable:
            continue

        # a preliminary injunction or stay-pending-appeal freezes enforcement
        case = st.litigation
        if case is not None and (case.injunction_turns_left > 0 or case.stay_active):
            continue

        enf = st.enforcement_level
        for lab in labs:
            if lab.safe_harbor_signed and pdef.safe_harbor_eligible:
                continue
            if not pdef.covers(lab):
                continue

            # decide/refresh defection state this turn (player: explicit choice;
            # rival: defects ∝ (1 − compliance))
            if lab.is_player:
                defecting_now = pdef.id in lab.active_defections
            else:
                defecting_now = rng.random() > lab.disposition.compliance

            # ── always-caught policy (disclosure): withholding is itself public ──
            # The catch is CERTAIN (no detection roll), and the fine lands every turn
            # the lab keeps withholding. We record a rival's choice in active_defections
            # so the observation can hide that lab's published numbers (the player reads
            # it as "withholding"); the player's own choice already lives there.
            if pdef.defection_always_caught:
                if not lab.is_player:
                    if defecting_now:
                        lab.active_defections.add(pdef.id)
                    else:
                        lab.active_defections.discard(pdef.id)
                if defecting_now:
                    size_scale = 1.0 + max(0.0, lab.market_cap) / 4000.0
                    # DEFECTION_PENALTY read as a per-YEAR fine here (the catch is
                    # certain, so there is no catch-rate to carry the time scaling);
                    # realized this turn as rate × dt to keep §0b time-discipline.
                    penalty = enf * consts.DEFECTION_PENALTY * size_scale * dt
                    if st.penalty_cap is not None:
                        penalty = min(penalty,
                                      st.penalty_cap * consts.DEFECTION_PENALTY * size_scale * dt)
                    fired.append(_record_defection_caught(
                        sb, lab, pdef, enf, penalty, turn, consts))
                continue

            if defecting_now:
                lab.defection_caught_pending.add(pdef.id)

            # detection: P(caught) = enforcement × base_detection, per year
            is_defecting = pdef.id in lab.defection_caught_pending
            catch_rate = enf * consts.ENFORCEMENT_BASE_DETECTION * consts.ENFORCEMENT_CATCH_RATE * 2.0
            if is_defecting and rng.roll_rate(catch_rate, dt):
                lab.defection_caught_pending.discard(pdef.id)

                # penalty severity scales with enforcement AND lab size (turnover)
                size_scale = 1.0 + max(0.0, lab.market_cap) / 4000.0
                penalty = enf * consts.DEFECTION_PENALTY * size_scale

                # a litigation "penalty-cap" win clamps the ceiling (no mega-fines)
                if st.penalty_cap is not None:
                    penalty = min(penalty, st.penalty_cap * consts.DEFECTION_PENALTY * size_scale)

                fired.append(_record_defection_caught(
                    sb, lab, pdef, enf, penalty, turn, consts))

    return fired
