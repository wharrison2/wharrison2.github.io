"""THE see-able/hidden chokepoint (§11). Reads GameState (TRUE) -> emits
filtered per-actor Observations. Only MEASURED snapshots, findings, and public
info cross this boundary. Audit this file when wondering 'can the player see X'.
"""
from backend_v1.engine.observation.observations import Observation
from backend_v1.engine.actions import legal_moves
from backend_v1.engine.rules import budget_pool, committed_budget
from backend_v1.engine.research.findings import synthesize_worry_bar
from backend_v1.engine.benchmarks import released_benchmarks, benchmark_score
from backend_v1.engine.evaluations import (
    EVAL_HARNESSES, max_level, next_upgrade, awareness_reduction, eval_reading,
)
from backend_v1.content.copy import t


def _model_view(m, include_dangerous=True):
    """Measured-only view of a model. NO true stats, no suppression, no
    concealment, no hidden history."""
    measured_capability = {
        "general": round(m.measured_capability.general, 2),
        "coding_rnd": round(m.measured_capability.coding_rnd, 2),
    }
    measured_alignment = {
        "eval_awareness": round(m.measured_alignment.eval_awareness, 2),
        "deception": round(m.measured_alignment.deception, 2),
        "goal_misalignment": round(m.measured_alignment.goal_misalignment, 2),
        "self_preservation": round(m.measured_alignment.self_preservation, 2),
        "jailbreak_sensitivity": round(m.measured_alignment.jailbreak_sensitivity, 2),
    }
    v = {
        "id": m.id,
        "released": m.released,
        "leaked": m.leaked,
        "measured_capability": measured_capability,
        "measured_alignment": measured_alignment,
        "post_train_rounds": m.post_train_rounds,
        "jailbreak_techniques_public": m.jailbreak_discovered,
    }
    if include_dangerous:
        v["dangerous_capability_eval"] = round(m.measured_dangerous_capability, 2)
    return v


def _elicitation_projection(m, lab, consts):
    """The §8b trap in UI form: capability projection is real & roughly
    trustworthy; the alignment cost of the same rounds is NOT shown."""
    from backend_v1.engine.research.capabilities.capabilities_research_item import (
        CAPABILITY_TREE_BY_ID,
    )
    elicitation_bonuses = sum(
        CAPABILITY_TREE_BY_ID[nid].elicitation_bonus
        for nid in lab.researched_advances if nid in CAPABILITY_TREE_BY_ID)
    rate = consts.ELICIT_BASE + elicitation_bonuses

    ceiling_est = m.ceiling.general  # ceiling estimate is roughly trustworthy
    realized = m.measured_capability.general

    curve = []
    r = realized
    for rounds in range(1, 7):
        r = r + (ceiling_est - r) * rate
        curve.append({"more_rounds": rounds, "projected_general": round(r, 2)})

    return {"ceiling_estimate": round(ceiling_est, 2),
            "projection": curve,
            "note": t("obs.projection_note")}


def _chatter(wtr):
    if wtr < 15:
        return t("obs.chatter.quiet")
    if wtr < 35:
        return t("obs.chatter.rumbling")
    if wtr < 60:
        return t("obs.chatter.loud")
    return t("obs.chatter.deafening")


def _rival_public_entry(other, lab, state, consts, disclosure_active):
    """Build the coarse public-information entry for one rival lab.

    When the disclosure mandate is active, the rival must PUBLISH each released
    model's measured safety numbers. Those are the same measured stats an
    eval-aware model already games (design §10c), so the disclosed figures can
    read clean while true alignment is bad — but they replace the player's noisy
    guesswork with the rival's own official numbers."""
    frontier_model = other.frontier_model()
    entry = {
        "lab_id": other.id,
        "name": other.name,
        "ticker": other.ticker,
        "market_cap": round(other.market_cap, 1),
        "released_models": len(other.release_history),
    }
    if frontier_model is not None:
        # rivals' stats: much worse estimates (extra noise, applied once per
        # release and cached so the estimate doesn't dance)
        cache = lab.rival_estimate_cache
        key = (other.id, frontier_model.id)
        if key not in cache:
            noise = state.rng.normal(0, consts.RIVAL_ESTIMATE_NOISE)
            cache[key] = max(0.0, frontier_model.measured_capability.general * (1 + noise))
        entry["frontier_capability_estimate"] = round(cache[key], 2)
        entry["frontier_model_id"] = frontier_model.id
    if disclosure_active:
        # A lab can DEFECT on the mandate — refuse to publish — at a certain,
        # per-turn fine (enforcement_phase). Refusal is public, so we surface it
        # as "withholding" rather than silently dropping the lab's numbers.
        rival_is_withholding = "disclosure" in other.active_defections
        if rival_is_withholding:
            entry["disclosure_withheld"] = True
        else:
            disclosed_models = [
                _model_view(released_model)
                for released_model in other.release_history
                if released_model.released
            ]
            entry["disclosed_models"] = disclosed_models
    return entry


def _research_template(template_id):
    """Look up the catalog template for a research process by id, across BOTH the
    capability tree and the safety advances (they research with the same machinery).
    Returns None for plain safety PROJECTS (measure/intervene), which carry their own
    blurb on the legal-moves side rather than the §8b what_it_does/risk fields."""
    from backend_v1.engine.research.capabilities.capabilities_research_item import (
        CAPABILITY_TREE_BY_ID,
    )
    from backend_v1.engine.research.safety.safety_advance_item import SAFETY_ADVANCES_BY_ID
    if template_id in CAPABILITY_TREE_BY_ID:
        return CAPABILITY_TREE_BY_ID[template_id]
    if template_id in SAFETY_ADVANCES_BY_ID:
        return SAFETY_ADVANCES_BY_ID[template_id]
    return None


def _in_progress_entries(lab, state):
    """Serialised view of all active projects, including any live training run. NAME
    and PHASE are looked up from the catalog so the frontend can render the same card
    it uses for the available item. NO hidden process fields cross (no assisting-model
    id, no contamination, no goal-mis of the assisting model)."""
    active_project_entries = []
    for process in lab.in_progress:
        template = _research_template(process.template_id)
        entry = {
            "project_id": process.template_id,
            "name": template.name if template is not None else process.template_id,
            "kind": process.kind,
            "phase": template.phase if template is not None else None,
            "ai_assist": process.ai_assist,
            "is_delegate": process.is_delegate,
            "years_remaining_estimate": round(max(0.0, process.duration_years_remaining), 2),
        }
        active_project_entries.append(entry)

    training_run_entry = (
        [{"project_id": "pretrain_run", "name": "Pretrain run", "kind": "training",
          "phase": "pretrain", "ai_assist": 0.0,
          "years_remaining_estimate": round(lab.training_run.duration_years_remaining, 2)}]
        if lab.training_run is not None else []
    )
    return active_project_entries + training_run_entry


def _researched_advance_entries(lab):
    """COMPLETED advances (both capability and safety) the frontend can show as
    read-only cards. ONLY non-secret, value-neutral fields cross this boundary — the
    §8b what_it_does text, the name/phase/kind, and the completion turn. The hidden
    fields on the ResearchedItem (contamination, researcher_model_id,
    researched_with_assist) are TRUE state and never leave observation_builder."""
    entries = []
    for node_id, researched_item in lab.researched_advances.items():
        template = _research_template(node_id)
        if template is None:
            continue
        kind = ("safety_advance"
                if node_id in _safety_advance_ids() else "capability")
        entries.append({
            "id": node_id,
            "name": template.name,
            "version": researched_item.version,
            "phase": template.phase,
            "kind": kind,
            "what_it_does": template.what_it_does,
            "completed_turn": researched_item.completed_turn,
        })
    return entries


def _safety_advance_ids():
    from backend_v1.engine.research.safety.safety_advance_item import SAFETY_ADVANCES_BY_ID
    return set(SAFETY_ADVANCES_BY_ID)


def _benchmark_cards(state, lab, consts):
    """§7 PUBLIC scoreboard: one card per released benchmark, scored for every
    lab's frontier released model (clean public capability) plus your own model in
    training. Refreshes free each turn because it's recomputed here from MEASURED
    capability."""
    current_year = consts.START_YEAR + state.turn * state.dt
    frontier_general = state.world.frontier_measured_general

    cards = []
    for benchmark in released_benchmarks(current_year, frontier_general):
        scores_by_lab = {}
        for other in state.labs:
            frontier_model = other.frontier_model()
            if frontier_model is not None:
                scores_by_lab[other.id] = round(
                    benchmark_score(benchmark, frontier_model, consts), 1)
        card = {
            "id": benchmark.id,
            "name": benchmark.name,
            "kind": benchmark.kind,
            "domain": benchmark.domain,
            "blurb": benchmark.blurb,
            "release_year": benchmark.release_year,
            "scores": scores_by_lab,
        }
        if lab.model_in_training is not None:
            card["in_training"] = round(
                benchmark_score(benchmark, lab.model_in_training, consts), 1)
        cards.append(card)
    return cards


def _eval_cards(lab, consts):
    """§7 PRIVATE passive evals: one card per harness for THIS lab's own models
    only (you never see a rival's eval readings). Shows the current reading for
    your model in training and frontier release, plus build/upgrade state."""
    frontier_model = lab.frontier_model()
    model_in_training = lab.model_in_training
    builds_in_flight = {build["harness_id"]: build for build in lab.eval_builds}

    cards = []
    for harness in EVAL_HARNESSES:
        level = lab.eval_harnesses.get(harness.id, -1)
        is_built = level >= 0
        card = {
            "id": harness.id,
            "name": harness.name,
            "family": harness.family,
            "evidence": harness.evidence,
            "blurb": harness.blurb,
            "level": level,
            "max_level": max_level(harness),
            "built": is_built,
        }

        active_build = builds_in_flight.get(harness.id)
        if active_build is not None:
            card["in_flight"] = True
            card["years_remaining"] = round(active_build["years_remaining"], 2)
        else:
            upgrade = next_upgrade(harness, level)
            if upgrade is not None:
                card["next_cost"] = upgrade.cash_cost
                card["next_years"] = upgrade.build_years
                card["next_awareness_reduction"] = upgrade.awareness_reduction

        if is_built:
            card["awareness_reduction"] = awareness_reduction(harness, level)
            if model_in_training is not None:
                card["reading_in_training"] = eval_reading(
                    harness, model_in_training, level, consts)
            if frontier_model is not None:
                card["reading_released"] = eval_reading(
                    harness, frontier_model, level, consts)

        cards.append(card)
    return cards


def _alignment_evidence(lab):
    """Compile every misalignment finding this lab has collected into a per-model
    dossier for the Intel tab. This is a pure RE-PRESENTATION of lab.findings — the
    SAME player-safe dicts already crossing the firewall each turn via new_findings
    (see build_observation below). No true state is read here; we only regroup, tag
    each finding's source (a safety eval you ran vs an EXTERNAL incident that taught
    you something), and drop the internal worry-bar `weight` the player never reasons
    about directly.

    Grouped by the model the evidence was collected on (the player juggles several
    models and asks "what do I actually know about THIS one?"). Within a model the
    items are newest-first; models are ordered by their most recent finding, so the
    model you're actively probing sits on top."""
    released_ids = {model.id for model in lab.release_history}
    in_training_id = (lab.model_in_training.id
                      if lab.model_in_training is not None else None)

    items_by_model = {}
    for finding in lab.findings:
        model_id = finding["model_id"]
        # "external" is incident-injected evidence (a real-world breach revealed
        # something); everything else came from a safety project you commissioned.
        source_kind = "external" if finding["project_id"] == "incident" else "research"
        evidence_item = {
            "turn": finding["turn"],
            "axis": finding["axis"],
            "evidence": finding["evidence"],
            "concern": finding["concern"],
            "mechanistic": finding["mechanistic"],
            "assist_used": finding["assist_used"],
            "source_kind": source_kind,
            "project_id": finding["project_id"],
            "text": finding["text"],
        }
        items_by_model.setdefault(model_id, []).append(evidence_item)

    model_entries = []
    for model_id, items in items_by_model.items():
        items.sort(key=lambda item: item["turn"], reverse=True)   # newest-first
        if model_id == in_training_id:
            status = "in_training"
        elif model_id in released_ids:
            status = "released"
        else:
            status = "earlier"          # superseded model whose findings still matter
        model_entries.append({
            "model_id": model_id,
            "status": status,
            "latest_turn": items[0]["turn"],
            "items": items,
        })

    model_entries.sort(key=lambda entry: entry["latest_turn"], reverse=True)
    return {"models": model_entries, "total_count": len(lab.findings)}


def build_observation(state, lab, tips, policy_news, public_events,
                      new_findings) -> Observation:
    consts = state.consts

    disclosure_state = state.world.policies.get("disclosure")
    disclosure_active = disclosure_state is not None and disclosure_state.active

    rivals_pub = [
        _rival_public_entry(other, lab, state, consts, disclosure_active)
        for other in state.labs
        if other.id != lab.id
    ]

    current_year = round(consts.START_YEAR + state.turn * state.dt, 2)

    work_budget_free = round(budget_pool(lab, state.dt) - committed_budget(lab), 3)

    model_in_training = lab.model_in_training
    model_in_training_view = (
        {**_model_view(model_in_training),
         "elicitation": _elicitation_projection(model_in_training, lab, consts)}
        if model_in_training is not None else None
    )

    active_policy_ids = [pid for pid, st in state.world.policies.items() if st.active]

    public_event_entries = [
        {"turn": e.turn, "category": e.category, "text": e.public_text}
        for e in public_events if e.public
    ]

    return Observation(
        lab_id=lab.id,
        turn=state.turn,
        year=current_year,
        cash=round(lab.cash, 1),
        work_budget_free=work_budget_free,
        revenue_rate=round(lab.revenue_rate, 1),
        investment_rate=round(lab.investment_rate, 1),
        market_caps={l.id: round(l.market_cap, 1) for l in state.labs},
        own_models=[_model_view(m) for m in lab.release_history],
        model_in_training=model_in_training_view,
        in_progress=_in_progress_entries(lab, state),
        researched_advances=_researched_advance_entries(lab),
        new_findings=[dict(f) for f in new_findings],
        worry_bar=synthesize_worry_bar(lab.findings, state.turn, consts),
        alignment_evidence=_alignment_evidence(lab),
        rival_public=rivals_pub,
        public_approval=round(state.world.public_approval, 1),
        regulatory_chatter=_chatter(state.world.wtr),
        active_policies=active_policy_ids,
        policy_news=list(policy_news),
        public_events=public_event_entries,
        tips=list(tips),
        legal_moves=legal_moves(lab, state.world, consts, state.dt, state.turn),
        benchmarks=_benchmark_cards(state, lab, consts),
        evals=_eval_cards(lab, consts),
        game_over=state.game_over,
        # Each human sees ITS OWN endgame verdict (multiplayer race, §4.6);
        # solo the player's entry is the same object as state.outcome, and
        # labs without an entry (AI rivals, game still running) fall back.
        outcome=state.outcome_by_lab.get(lab.id, state.outcome),
    )
