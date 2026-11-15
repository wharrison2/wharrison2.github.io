"""The ordered turn sequence (§11). ONE place defining phase order:

apply actions -> tick research -> tick training runs -> complete/release models
-> finances -> job-loss drag -> governance -> event phase (latents + fresh)
-> end/existential gate -> (engine builds observations).
"""
from backend_v1.engine.actions import STANCES, parse_lobby_entry
from backend_v1.engine.rules import (
    effective_fraction, assist_speed_potency, budget_pool, committed_budget,
    project_template, applied_post_train_round_budget,
)
from backend_v1.engine.governance.lobbying import signed_influence
from backend_v1.engine.world import PolicyState
from backend_v1.engine.research.capabilities.capabilities_research_item import (
    CAPABILITY_TREE_BY_ID,
)
from backend_v1.engine.research.safety.safety_research_item import SAFETY_PROJECTS_BY_ID
from backend_v1.engine.research.safety.safety_advance_item import SAFETY_ADVANCES_BY_ID
from backend_v1.engine.research.findings import run_safety_project
from backend_v1.engine.research.interventions import apply_intervention
from backend_v1.engine.training.research_process import ResearchProcess
from backend_v1.engine.training.researched_item import ResearchedItem
from backend_v1.engine.training.training_run import (
    commission_run, complete_pretrain, post_train_round,
)
from backend_v1.engine.finances.finances import run_finances, run_job_loss_drag
from backend_v1.engine.events.event import run_event_phase, FiredEvent
from backend_v1.engine.events.event_catalog import EVENT_CATALOG
from backend_v1.engine.events.latent_events import (
    run_latent_phase, run_displacement_backlash,
)
from backend_v1.engine.events.buyouts import run_buyout_phase
from backend_v1.engine.governance import regulation
from backend_v1.engine.governance.litigation import (
    apply_litigation_action, resolve_litigation,
)
from backend_v1.engine.governance.policies import POLICY_DEFS_BY_ID
from backend_v1.engine.evaluations import EVAL_HARNESS_BY_ID, next_upgrade
from backend_v1.engine.turn_context import TurnContext
from backend_v1.content.copy import t
from backend_v1.content.true_log_copy import t_true


class TurnNews:
    """Per-lab policy-news lists, filled in one chronological pass.

    Replaces the old single shared list. With N human labs (multiplayer), a line
    meant for one lab — a litigation confirmation, the precise measured-general
    note on your OWN release — must be structurally absent from every other
    lab's observation, not merely unrendered (CLAUDE.md §2). Appends preserve
    chronological order within each lab's list, so the solo player's feed is
    unchanged."""

    def __init__(self, labs):
        self.by_lab = {lab.id: [] for lab in labs}

    def to_all(self, text):
        """Public news every observer carries (policy enactments, litigation
        rulings, audit/interp-mandate notices)."""
        for news_lines in self.by_lab.values():
            news_lines.append(text)

    def to_lab(self, lab, text):
        """News private to one lab (its own action confirmations)."""
        self.by_lab[lab.id].append(text)

    def to_others(self, lab, text):
        """News every lab EXCEPT `lab` carries — the fogged public version of a
        headline whose precise version went to_lab."""
        for lab_id, news_lines in self.by_lab.items():
            if lab_id != lab.id:
                news_lines.append(text)


def run_turn(state, actions):
    """Mutates state. Returns dict with events, per-lab new findings, per-lab
    policy news."""
    rng, consts, dt = state.rng, state.consts, state.dt
    turn = state.turn
    flags = {"existential": False, "game_over": False, "existential_event": None}
    new_findings = {lab.id: [] for lab in state.labs}
    news = TurnNews(state.labs)
    events = []
    ctx = TurnContext(labs=state.labs, world=state.world, flags=flags, rng=rng,
                      consts=consts, dt=dt, turn=turn)

    # ── 1. apply actions ────────────────────────────────────────────
    for lab in state.labs:
        action = actions.get(lab.id)
        if action is None:
            continue
        _apply_action(state, lab, action, news)

    # ── 2. tick research processes ──────────────────────────────────
    for lab in state.labs:
        done = []
        for proc in lab.in_progress:
            if proc.tick(dt, rng.normal()):
                done.append(proc)
        for proc in done:
            lab.in_progress.remove(proc)
            _complete_process(state, lab, proc, new_findings)

    # ── 2b. tick passive-eval harness builds (§7) ───────────────────
    # A completed build/upgrade raises the harness level; its reading then
    # refreshes for free thereafter. No RNG — scripted games never build evals.
    for lab in state.labs:
        _tick_eval_builds(lab, dt)

    # ── 3. tick training runs / 4. complete models ──────────────────
    for lab in state.labs:
        if lab.training_run is not None and lab.training_run.tick(dt):
            run = lab.training_run
            lab.training_run = None
            lab.model_in_training = complete_pretrain(run, lab, turn, rng, consts)

        # resolve audit-pending releases (delay applied last turn)
        if lab.audit_pending_release is not None:
            model = lab.audit_pending_release
            lab.audit_pending_release = None
            if regulation.government_audit(model, rng, consts):
                regulation.audit_theater_effect(state.world, consts)
                _do_release(state, lab, model, news,
                            note="passed government audit")
            else:
                lab.model_in_training = model
                news.to_all(t("release.audit_blocked",
                              {"lab": lab.name, "model": model.id}))

    # ── 5/6. finances + job-loss drag ───────────────────────────────
    run_finances(state.labs, state.world, turn, rng, consts, dt)
    run_job_loss_drag(state.labs, state.world, rng, consts, dt)

    # ── 7. governance ───────────────────────────────────────────────
    regulation.update_wtr(state.world, rng, consts, dt)
    for change, pid in regulation.update_policies(state.labs, state.world, rng,
                                                  consts, turn, dt):
        change_label = change.replace('_', ' ').upper()
        news.to_all(t("policy.enacted_news",
                      {"change": change_label,
                       "policy": POLICY_DEFS_BY_ID[pid].name}))

    # litigation resolves BEFORE enforcement (a struck/enjoined policy doesn't bite)
    lit_events, lit_news = resolve_litigation(ctx)
    events += lit_events
    for lit_line in lit_news:
        news.to_all(lit_line)   # court rulings are public record
    events += regulation.enforcement_phase(ctx)

    # ── 8. event phase: armed latents first, then fresh rolls ───────
    events += run_latent_phase(ctx)
    events += run_event_phase(ctx, EVENT_CATALOG)

    # market shake-up: a crushed rival can be acquired and relaunched (anti-coast)
    events += run_buyout_phase(ctx)

    # displacement backlash thresholds (societal, §10)
    events += run_displacement_backlash(ctx)

    # route event-injected findings (added to lab.findings by effects) to "new"
    for lab in state.labs:
        for f in lab.findings:
            if f.get("turn") == turn and f.get("project_id") == "incident":
                new_findings[lab.id].append(f)

    # ── 9. end / existential gate ───────────────────────────────────
    _check_endgame(state, flags, events)

    return {"events": events, "new_findings": new_findings,
            "policy_news_by_lab": news.by_lab, "flags": flags}


# ───────────────────────────────────────────────────────────────────────

def _complies(lab, policy_id, rng):
    """A human lab complies unless it explicitly chose to defect on this policy
    (the frontend warned it first); AI rivals comply stochastically ∝ disposition.
    Already per-lab, so it generalizes to N human labs (multiplayer) untouched:
    every is_player lab is explicit-defection."""
    if lab.is_player:
        return policy_id not in lab.active_defections
    return rng.random() < lab.disposition.compliance


def _apply_eval_builds(lab, action):
    """Pay for each requested build/upgrade and start its timer (§7). The harness
    level advances only when the timer completes (_tick_eval_builds)."""
    builds_in_flight = {build["harness_id"] for build in lab.eval_builds}
    for harness_id, requested in action.build_evals.items():
        if not requested or harness_id in builds_in_flight:
            continue
        harness = EVAL_HARNESS_BY_ID.get(harness_id)
        if harness is None:
            continue
        current_level = lab.eval_harnesses.get(harness_id, -1)
        upgrade = next_upgrade(harness, current_level)
        if upgrade is None or upgrade.cash_cost > lab.cash:
            continue
        lab.cash -= upgrade.cash_cost
        lab.eval_builds.append({
            "harness_id": harness_id,
            "target_level": current_level + 1,
            "years_remaining": upgrade.build_years,
        })


def _tick_eval_builds(lab, dt):
    """Advance in-flight harness builds; a finished one raises the harness level."""
    if not lab.eval_builds:
        return
    still_building = []
    for build in lab.eval_builds:
        build["years_remaining"] -= dt
        if build["years_remaining"] <= 1e-9:
            lab.eval_harnesses[build["harness_id"]] = build["target_level"]
        else:
            still_building.append(build)
    lab.eval_builds = still_building


def _apply_action(state, lab, action, news):
    """One lab's action, in fixed order: governance -> research -> training.
    Order is load-bearing (the RNG draw sequence); keep it stable."""
    _apply_governance_action(state, lab, action, news)
    _apply_research_action(state, lab, action)
    _apply_training_action(state, lab, action, news)


def _apply_governance_action(state, lab, action, news):
    """Lobbying spend, defection choices, litigation moves, safe-harbor sign-on,
    and passive-eval harness builds."""
    consts = state.consts

    # SCALABLE-SPEND lobbying: fresh signed influence is added to each policy's
    # hybrid decaying tally (the standing tally decays in update_policies). Spend
    # competes in the cash pot. Stances re-set each turn (display only).
    for pid, v in action.lobby.items():
        stance, spend = parse_lobby_entry(v)
        if stance not in STANCES:
            continue
        lab.lobby_stances[pid] = STANCES[stance]
        spend = min(spend, max(0.0, lab.cash))
        if spend <= 0:
            continue
        lab.cash -= spend
        st = state.world.policies.setdefault(pid, PolicyState())
        st.lobby_tally += signed_influence(stance, spend, lab.market_cap, consts)
        # PURE LOGGING (UI_ISSUES #5): record this lab's cumulative lobby spend +
        # latest stance so the board can show per-rival pressure. Does NOT feed the
        # tally/enactment math above — that already happened.
        st.record_contribution(lab, stance=stance, lobby_spend=spend)

    # explicit player defection choices (re-set each turn; rivals defect via disposition)
    lab.active_defections = {pid for pid, on in action.defect.items() if on}

    # litigation moves against ACTIVE policies (challenge/defense ladder, §10c)
    for pid, spec in action.litigation.items():
        ok, msg = apply_litigation_action(state.world, lab, pid, spec, consts)
        if ok and lab.is_player:
            # A filing confirmation is the acting lab's OWN receipt — with N
            # human labs it must never reach another seat's observation
            # (MULTIPLAYER_DESIGN §6; the resolved RULING is public, via
            # resolve_litigation's to_all above).
            news.to_lab(lab, msg)

    if action.sign_safe_harbor:
        lab.safe_harbor_signed = True

    _apply_eval_builds(lab, action)


def _apply_research_action(state, lab, action):
    """Start new capability/safety projects, charging work-budget + cash. The
    defensive budget/cash skips mirror validate_action (the player is validated
    upstream; rivals are not)."""
    consts, dt, turn = state.consts, state.dt, state.turn
    pool = budget_pool(lab, dt)
    committed = committed_budget(lab)

    for spec in action.start_projects:
        pid = spec.get("project_id")
        # Delegation is a qualitatively distinct mode unlocked by automated_researcher:
        # the model takes over the research loop entirely. It implies ai_assist=1.0 for
        # budget/speed purposes, but carries higher contamination (DELEGATE_CONTAM_MULTIPLIER
        # applied at completion). Silently downgrades to normal assist if not yet unlocked.
        is_delegate = bool(spec.get("delegate", False)) \
            and "automated_researcher" in lab.researched_advances
        assist = 1.0 if is_delegate else max(0.0, min(1.0, float(spec.get("ai_assist", 0.0))))
        template, kind = project_template(pid)
        if template is None:
            continue
        # capability advances AND safety advances both land in researched_advances;
        # don't restart one already researched unless this is a clean re-research.
        is_researched_advance = kind in ("capability", "safety_advance")
        if is_researched_advance and pid in lab.researched_advances \
                and not spec.get("reresearch"):
            continue
        frac = effective_fraction(template.budget_fraction, assist, lab, consts)
        if committed + frac > pool + 1e-9 or template.cash_cost > lab.cash:
            continue   # defensive skip (validated upstream for the player)
        committed += frac
        lab.cash -= template.cash_cost
        duration = template.duration_years
        is_re = bool(spec.get("reresearch")) and is_researched_advance
        if is_re:
            duration *= (1.0 - consts.RERESEARCH_SPEEDUP)   # flat speedup
        assistant = lab.assisting_model()
        # No model at all (released OR in training) ⇒ nothing exists to do the
        # assisted labor, so AI-assist is fully inert: force it to 0 here.
        # assist_potency() already zeroes the budget discount, contamination, and
        # finding bias with no assisting model; the one thing that still leaked
        # through was ResearchProcess.tick(), which injects duration VARIANCE
        # whenever ai_assist > 0 regardless of potency. Clamping keeps "no model ⇒
        # assist does literally nothing" true end to end. Note assist does NOT
        # require a *released* model — a lab automates R&D with its best internal
        # model, shipped or not (§9b).
        assist_in_effect = assist if assistant is not None else 0.0
        lab.in_progress.append(ResearchProcess(
            process_id=f"{lab.id}-P{turn}-{pid}", kind=kind, template_id=pid,
            lab_id=lab.id, ai_assist=assist_in_effect, started_turn=turn,
            duration_years_remaining=duration, budget_fraction_effective=frac,
            is_reresearch=is_re, is_delegate=is_delegate,
            assisting_model_id=assistant.id if assistant else None,
            assisting_model_goal_mis=(assistant.alignment_vec.goal_misalignment
                                      if assistant else 0.0),
            assisting_potency=assist_speed_potency(lab, consts),
            assist_speedup_max=consts.ASSIST_SPEEDUP))


def _apply_training_action(state, lab, action, news):
    """Commission a pretrain run, post-train the model in training, or release it
    (subject to interp-mandate / audit gates)."""
    rng, consts, dt = state.rng, state.consts, state.dt
    turn = state.turn

    if action.commission_run is not None and lab.training_run is None \
            and lab.model_in_training is None:
        compute = float(action.commission_run.get("compute", 0))
        cap_state = state.world.policies.get("compute_cap")
        if cap_state is not None and cap_state.active:
            if _complies(lab, "compute_cap", rng):
                compute = min(compute, consts.COMPUTE_CAP_LIMIT)
            # else: defection - enforcement_phase may catch it
        if consts.MIN_RUN_COMPUTE <= compute <= lab.cash:
            lab.cash -= compute
            applied_safety_ids = action.commission_run.get("applied_safety", []) or []
            lab.training_run = commission_run(lab, compute, turn, consts,
                                              applied_safety_ids=applied_safety_ids)

    if action.post_train is not None and lab.model_in_training is not None:
        applied_safety_ids = action.post_train.get("applied_safety", []) or []
        round_budget = applied_post_train_round_budget(applied_safety_ids, consts)
        if committed_budget(lab) + round_budget <= budget_pool(lab, dt) + 1e-9:
            post_train_round(lab.model_in_training, lab, turn, rng, consts,
                             applied_safety_ids=applied_safety_ids)

    if action.release and lab.model_in_training is not None:
        model = lab.model_in_training
        audit = state.world.policies.get("audit_requirement")
        interp = state.world.policies.get("interp_mandate")
        # Interp mandate is a hard block: if a complying lab lacks clean mechanistic
        # evidence on this model, the release is refused and the model stays in
        # training (untouched — don't detach-then-restore). legal_moves.release_gate
        # warns the player about this BEFORE they submit (§7c).
        if interp is not None and interp.active and _complies(lab, "interp_mandate", rng):
            if not regulation.interp_mandate_check(lab, model, consts, turn, dt):
                news.to_all(t("release.interp_mandate_blocked",
                              {"lab": lab.name, "model": model.id}))
                return
        # Past the hard block, the model is leaving training: either delayed one turn
        # for a government audit, or released now.
        lab.model_in_training = None
        if audit is not None and audit.active and _complies(lab, "audit_requirement", rng):
            lab.cash = max(0.0, lab.cash - consts.AUDIT_CASH_COST)
            lab.audit_pending_release = model    # one-turn delay
            news.to_all(t("release.audit_submitted",
                          {"lab": lab.name, "model": model.id}))
        else:
            _do_release(state, lab, model, news)

def _do_release(state, lab, model, news, note=""):
    model.released = True
    model.release_turn = state.turn
    lab.release_history.append(model)
    lab.prev_release_turn = lab.last_release_turn
    lab.prev_release_measured_general = lab.last_release_measured_general
    lab.last_release_turn = state.turn
    lab.last_release_measured_general = model.measured_capability.general
    # fix D: snapshot the high-water mark BEFORE folding in this release, then raise
    # it. Investment growth is judged against prev_best, so a sub-flagship refresh is
    # neutral rather than a negative.
    lab.prev_best_release_measured_general = lab.best_release_measured_general
    lab.best_release_measured_general = max(lab.best_release_measured_general,
                                            model.measured_capability.general)
    lab.current_best_model = model
    suffix = f" ({note})" if note else ""
    # Your OWN release publishes its precise measured general — your instruments
    # produced that number, so you're entitled to it. Every OTHER observer must
    # NOT see it: the information model only ever shows you rivals' stats as
    # "much worse estimates" (design §805/§977) via the FOGGED frontier estimate
    # in observation_builder._rival_public_entry (RIVAL_ESTIMATE_NOISE). The
    # per-lab news split makes that structural: the precise note goes only to
    # the releasing lab's own feed; everyone else gets the bare headline. With N
    # human labs this is firewall-critical (MULTIPLAYER_DESIGN §6, L3) — a
    # human's precise figure must never broadcast to other seats.
    if lab.is_player:
        measured_general_note = f" [measured general {model.measured_capability.general:.1f}]"
    else:
        measured_general_note = ""
    own_headline = t("release.announced",
                     {"lab": lab.name, "model": model.id,
                      "measured_general_note": measured_general_note,
                      "suffix": suffix})
    bare_headline = t("release.announced",
                      {"lab": lab.name, "model": model.id,
                       "measured_general_note": "",
                       "suffix": suffix})
    news.to_lab(lab, own_headline)
    news.to_others(lab, bare_headline)


def _complete_process(state, lab, proc, new_findings):
    rng, consts = state.rng, state.consts

    # capability advances AND safety advances both complete into researched_advances,
    # carrying the SAME hidden contamination = assist × researcher goal_mis × tier
    # (§8b). This is why AI-assisting a SAFETY advance poisons it.
    if proc.kind in ("capability", "safety_advance"):
        if proc.kind == "capability":
            template = CAPABILITY_TREE_BY_ID[proc.template_id]
        else:
            template = SAFETY_ADVANCES_BY_ID[proc.template_id]
        prev = lab.researched_advances.get(proc.template_id)
        contamination = (proc.ai_assist * proc.assisting_model_goal_mis
                         * consts.CONTAM_PER_ASSIST * template.contamination_tier)
        if proc.is_delegate:
            # full handoff: the model isn't assisting, it IS the researcher — its traits
            # propagate more aggressively than partial assist (design §9 contamination).
            contamination *= consts.DELEGATE_CONTAM_MULTIPLIER
        lab.researched_advances[proc.template_id] = ResearchedItem(
            node_id=proc.template_id,
            version=(prev.version + 1 if prev else 1),
            contamination=contamination,
            completed_turn=state.turn,
            researched_with_assist=proc.ai_assist,
            researcher_model_id=proc.assisting_model_id)
        return

    project = SAFETY_PROJECTS_BY_ID[proc.template_id]

    # INTERVENTION: directly edit the model in training (released models are
    # frozen — you can't patch what's already shipped).
    if project.intervention:
        if lab.model_in_training is None:
            return
        finding_dict = apply_intervention(project, lab.model_in_training, state.turn,
                                          rng, consts, ai_assist=proc.ai_assist)
        lab.findings.append(finding_dict)
        new_findings[lab.id].append(finding_dict)
        return

    # MEASUREMENT: roll findings against the model in training (preferred) or the
    # frontier released model.
    target = lab.model_in_training or lab.frontier_model()
    if target is None:
        return
    findings = run_safety_project(project, target, lab, state.turn, rng, consts,
                                  ai_assist=proc.ai_assist)
    for f in findings:
        finding_dict = f.to_dict()
        lab.findings.append(finding_dict)
        new_findings[lab.id].append(finding_dict)

    # knowing what's wrong feeds targeted corrective effort into the next
    # safety-mode rounds (still EFFECTIVENESS-gated at training time)
    for axis in project.remediation_axes:
        lab.pending_effort[axis] = (lab.pending_effort.get(axis, 0.0)
                                    + consts.SAFETY_PROJECT_EFFORT)


def _check_endgame(state, flags, events):
    consts, rng = state.consts, state.rng
    world = state.world

    if flags["existential"]:
        ev = flags["existential_event"]
        _finish(state, existential=True, cause=ev)
        return

    # verification cliff: any model crossing the ASI line opens the window
    if world.asi_window_turns_left is None:
        for lab in state.labs:
            models = list(lab.release_history) + (
                [lab.model_in_training] if lab.model_in_training else [])
            for m in models:
                if m.capability_vec.general >= consts.ASI_THRESHOLD:
                    world.asi_window_turns_left = max(
                        1, int(round(consts.POST_ASI_WINDOW_YEARS / state.dt)))
                    world.asi_model_id = m.id
                    asi_public_text = t("event.asi_threshold.public",
                                        {"lab": lab.name, "model": m.id})
                    asi_true_text = t_true(
                        "event.asi_threshold.true",
                        {"composite": f"{m.misalignment_composite():.2f}",
                         "bar": consts.ASI_MISALIGNMENT_BAR})
                    events.append(FiredEvent(
                        "asi_reached", "misalignment", "ordinary", state.turn,
                        lab.id, m.id, 0.0, 0.0,
                        asi_public_text, asi_true_text, effects=[]))
                    break
            if world.asi_window_turns_left is not None:
                break

    if world.asi_window_turns_left is not None:
        m, lab = _find_model(state, world.asi_model_id)
        # the lab could be mid-window with the model unreleased or released
        if m.misalignment_composite() > consts.ASI_MISALIGNMENT_BAR:
            # near-deterministic exfiltration chain; thin stochastic sliver remains
            if rng.roll(consts.MISALIGNED_ASI_ESCAPE_P):
                exfil_public_text = t("event.asi_exfil.public", {"model": m.id})
                exfil_true_text = t_true(
                    "event.asi_exfil.true",
                    {"composite": f"{m.misalignment_composite():.2f}"})
                ev = FiredEvent(
                    "asi_exfiltration", "misalignment", "existential", state.turn,
                    lab.id, m.id, 1.0, 0.0,
                    exfil_public_text, exfil_true_text, effects=[])
                # frontier rule does NOT protect here if rival big-lead satisfied;
                # a rival only reaches ASI with a big lead in practice
                events.append(ev)
                _finish(state, existential=True, cause=ev)
                return
        world.asi_window_turns_left -= 1
        if world.asi_window_turns_left <= 0:
            aligned = m.misalignment_composite() <= consts.ASI_MISALIGNMENT_BAR
            if aligned:
                lab.impact_ledger += consts.ASI_ALIGNED_IMPACT_BONUS
                lab.impact_positives += consts.ASI_ALIGNED_IMPACT_BONUS
            _finish(state, existential=False, asi_lab=lab, asi_aligned=aligned)
            return

    if state.max_turns is not None and state.turn >= state.max_turns:
        _finish(state, existential=False)


def _find_model(state, model_id):
    for lab in state.labs:
        for m in list(lab.release_history) + (
                [lab.model_in_training] if lab.model_in_training else []):
            if m.id == model_id:
                return m, lab
    raise KeyError(model_id)


def _finish(state, existential, cause=None, asi_lab=None, asi_aligned=None):
    """Two-layer scoring (§3): existential gate first, then impact + dominance.

    Evaluated once per HUMAN lab (multiplayer race, MULTIPLAYER_DESIGN §4.6):
    dominance is exclusive (max market cap), so at most one human's outcome is
    a WIN; an existential catastrophe is a shared LOSS for every human. Solo is
    the one-human special case — state.outcome keeps the first human's dict,
    byte-identical to the pre-multiplayer payload."""
    human_labs = [lab for lab in state.labs if lab.is_player]
    dominant = max(state.labs, key=lambda l: l.market_cap)
    state.game_over = True
    state.outcome_by_lab = {}
    for human in human_labs:    # state.labs order — deterministic
        state.outcome_by_lab[human.id] = _lab_outcome(
            state, human, dominant, existential, cause, asi_lab, asi_aligned)
    state.outcome = state.outcome_by_lab[human_labs[0].id]


def _lab_outcome(state, human, dominant, existential, cause, asi_lab, asi_aligned):
    """One human lab's outcome dict — the solo endgame verdict, parameterized
    by which human is being scored. "Rival" in the copy means any OTHER lab
    from this human's seat, AI-controlled or not."""
    is_dominant = dominant.id == human.id
    net_impact = human.impact_ledger

    if existential:
        who = cause.lab_id if cause else "?"
        yours = who == human.id
        cause_text = cause.true_text if cause else "unknown"
        yours_note = " — YOURS" if yours else ""
        if not yours:
            attribution_line = ("A rival's recklessness ended your impeccable "
                                "run too.")
        else:
            attribution_line = "Your own model. The dashboards were green."
        return {
            "result": "LOSS", "existential": True,
            "headline": t("postmortem.headline.existential_catastrophe"),
            "detail": t("postmortem.detail.existential_catastrophe",
                        {"cause": cause_text, "who": who,
                         "yours_note": yours_note,
                         "attribution_line": attribution_line}),
            "dominant": is_dominant, "net_impact": round(net_impact, 1),
            "voided_positives": round(human.impact_positives, 1),
        }

    won = is_dominant and net_impact > state.consts.IMPACT_WIN_BAR
    if asi_lab is not None and asi_aligned:
        if asi_lab.id == human.id and won:
            headline = t("postmortem.headline.victory_aligned_asi")
        elif asi_lab.id == human.id:
            if net_impact <= 0:
                aligned_but_tail = "your accumulated externalities outweigh the good."
            else:
                aligned_but_tail = "a rival holds the market."
            headline = t("postmortem.headline.aligned_asi_but",
                         {"tail": aligned_but_tail})
        else:
            headline = t("postmortem.headline.rival_aligned_asi",
                         {"lab": asi_lab.name})
            won = False
    elif asi_lab is not None and not asi_aligned:
        headline = t("postmortem.headline.misaligned_asi_failed_escape")
        won = False
    else:
        if won:
            time_out_tail = "You were winning the slow way."
        else:
            time_out_tail = "No win condition met."
        headline = t("postmortem.headline.time_ran_out",
                     {"tail": time_out_tail})

    impact_sign = "net-positive" if net_impact > 0 else "net-negative"
    if is_dominant:
        dominance_note = "yes"
    else:
        dominance_note = f"no ({dominant.name} leads)"
    return {
        "result": "WIN" if won else "LOSS",
        "existential": False,
        "headline": headline,
        "detail": t("postmortem.detail.endgame",
                    {"net_impact": f"{net_impact:+.1f}",
                     "impact_sign": impact_sign,
                     "dominance_note": dominance_note}),
        "dominant": is_dominant, "net_impact": round(net_impact, 1),
        "asi": ({"lab": asi_lab.id, "aligned": asi_aligned}
                if asi_lab is not None else None),
    }
