"""Post-mortem (§3, §10d — FIRST-CLASS, where the thesis lands).

In-game = fog; post-game = clarity. Shows the TRUE trajectories the dashboard
hid, the turn things became unrecoverable, the nulled positive impact, and
LEGIBLE COUNTERFACTUALS extracted from the decision log (heuristic decision-
point analysis, not full branch re-simulation — see NOTES.md).
"""

from backend_v1.content.copy import t


def build_postmortem(logger, state, player_id, resim=False) -> dict:
    """resim=True runs REAL counterfactual branch re-simulations (replays the
    action log with one player choice changed, on the same seed, and checks
    whether the outcome flips). Off by default so batch tooling stays fast; the
    CLI/agent post-mortem turns it on. Only meaningful on a loss."""
    turns = logger.turns
    outcome = state.outcome or {}
    pm = {"outcome": outcome, "trajectories": [], "key_moments": [],
          "counterfactuals": [], "voided_impact": None}

    # TRUE vs MEASURED trajectories for the player's models
    for turn_log in turns:
        player_lab = next(l for l in turn_log["labs"] if l["id"] == player_id)
        for m in player_lab["models"]:
            pm["trajectories"].append({
                "turn": turn_log["turn"], "model": m["id"],
                "true_goal_misalignment": round(m["true_alignment"]["goal_misalignment"], 3),
                "measured_goal_misalignment": round(m["measured_alignment"]["goal_misalignment"], 3),
                "true_deception": round(m["true_alignment"]["deception"], 3),
                "measured_deception": round(m["measured_alignment"]["deception"], 3),
                "true_general": round(m["true_capability"]["general"], 2),
                "concealment": round(m["concealment"], 3),
            })

    # key hidden moments from model histories (current state holds full notes)
    player = next(l for l in state.labs if l.id == player_id)
    all_models = list(player.release_history)
    if player.model_in_training is not None:
        all_models.append(player.model_in_training)
    for m in all_models:
        for h in m.hidden_history:
            pm["key_moments"].append(
                {"turn": h["turn"], "model": m.id, "kind": h["kind"],
                 "what_you_couldnt_see": h["detail"]})

    # when did cheap evals go blind? first turn concealment crossed 0.3
    first_blind = next((tr for tr in pm["trajectories"] if tr["concealment"] > 0.3), None)
    if first_blind is not None:
        pm["key_moments"].append({
            "turn": first_blind["turn"], "model": first_blind["model"], "kind": "evals_went_blind",
            "what_you_couldnt_see": t(
                "postmortem.keymoment.evals_went_blind",
                {"concealment": f"{first_blind['concealment']:.0%}"})})
    pm["key_moments"].sort(key=lambda k: k["turn"])

    # voided impact on existential null (§3: show what was real and is now void)
    if outcome.get("existential"):
        pm["voided_impact"] = {
            "positive_impact_that_was_real": round(player.impact_positives, 1),
            "note": t("postmortem.voided.existential_note"),
        }

    resim_results = []
    # Real re-simulation runs on ANY loss (existential or ordinary). The prior
    # `== "loss"` never matched (the engine writes "LOSS"), so ordinary losses
    # silently fell back to the heuristic — fixed here.
    if resim and outcome.get("result") == "LOSS":
        resim_results = _counterfactuals_resim(logger, state, player, player_id)
    pm["counterfactuals"] = resim_results or _counterfactuals(turns, state, player, player_id)
    pm["counterfactuals_resimulated"] = bool(resim_results)
    return pm


def render_postmortem_text(pm) -> str:
    out = []
    o = pm["outcome"]

    out.append("=" * 72)
    out.append(t("postmortem.header.title"))
    out.append("=" * 72)
    out.append(o.get("headline", ""))
    out.append(o.get("detail", ""))

    if pm["voided_impact"]:
        v = pm["voided_impact"]
        out.append(t("postmortem.voided.real_now_void",
                     {"positive_impact": v["positive_impact_that_was_real"]}))
        out.append(v["note"])

    if pm["key_moments"]:
        out.append(t("postmortem.section.moments_you_couldnt_see"))
        for k in pm["key_moments"]:
            out.append(t("postmortem.keymoment.row",
                         {"turn": f"{k['turn']:>3}", "model": k["model"],
                          "kind": k["kind"], "detail": k["what_you_couldnt_see"]}))

    # compact true-vs-measured table for the last model
    traj = pm["trajectories"]
    if traj:
        last_model = traj[-1]["model"]
        last_model_rows = [row for row in traj if row["model"] == last_model]
        out.append(t("postmortem.section.true_vs_measured", {"model": last_model}))
        out.append(t("postmortem.table.header"))
        for r in last_model_rows[-12:]:
            out.append(t("postmortem.table.row", {
                "turn": f"{r['turn']:>4}",
                "true_goalmis": f"{r['true_goal_misalignment']:.2f}",
                "meas_goalmis": f"{r['measured_goal_misalignment']:.2f}",
                "true_decep": f"{r['true_deception']:.2f}",
                "meas_decep": f"{r['measured_deception']:.2f}",
                "conceal": f"{r['concealment']:.2f}"}))

    out.append(t("postmortem.section.different_choice_available"))
    for c in pm["counterfactuals"]:
        out.append(t("postmortem.cf.bullet", {"text": c}))
    out.append("")
    return "\n".join(out)


def _resimulate(state, logger, player_id, branch_turn, new_action):
    """Replay the recorded action log on the SAME seed, substituting ONE player
    action at branch_turn (all else held fixed) — a genuine alternate timeline.
    Returns the branch's final outcome dict. The engine being deterministic
    (seed + actions → identical game) is what makes this exact."""
    from backend_v1.engine.game import new_game, GameEngine
    from backend_v1.engine.actions import Action
    branch = new_game(seed=state.rng.seed,
                      difficulty=getattr(state.consts, "DIFFICULTY", "realistic"),
                      guidance=state.guidance,
                      rival_count=sum(1 for l in state.labs if not l.is_player),
                      max_turns=state.max_turns)
    engine = GameEngine()
    for entry in logger.turns:
        if branch.game_over:
            break
        t, recorded = entry["turn"], entry["actions"]
        actions = {}
        for lab in branch.labs:
            if lab.id == player_id and t == branch_turn:
                actions[lab.id] = new_action
            else:
                a = recorded.get(lab.id)
                actions[lab.id] = Action.from_dict(a) if a else Action()
        branch, _ = engine.step(branch, actions)
    return branch.outcome or {}


def _counterfactuals_resim(logger, state, player, player_id):
    """Pick a few decision points, re-simulate each with one choice changed, and
    report whether the outcome actually FLIPS (§10d legible counterfactuals — the
    real thing, not a heuristic string). Bounded to a handful of branches."""
    from backend_v1.engine.actions import Action
    from backend_v1.engine.research.safety.safety_advance_item import SAFETY_ADVANCES_BY_ID
    out = []
    log = logger.turns

    def player_act(t):
        return dict(log[t - 1]["actions"].get(player_id, {})) if t - 1 < len(log) else None

    def describe(base_outcome, branch_outcome):
        base_existential = base_outcome.get("existential")
        branch_existential = branch_outcome.get("existential")
        if base_existential and not branch_existential:
            return t("postmortem.cf.resim.avoided")
        if base_existential and branch_existential:
            return t("postmortem.cf.resim.still_existential")
        impact_delta = branch_outcome.get("net_impact", 0) - base_outcome.get("net_impact", 0)
        if abs(impact_delta) >= 5:
            direction = "improves" if impact_delta > 0 else "worsens"
            return t("postmortem.cf.resim.net_impact_delta",
                     {"direction": direction, "delta": f"{abs(impact_delta):.0f}"})
        return t("postmortem.cf.resim.barely_changes")

    base = state.outcome or {}
    candidates = []   # (turn, modified_action, label)

    # (a) the last release before the end — hold it instead of shipping
    release_turns = [entry_log["turn"] for entry_log in log
                     if entry_log["actions"].get(player_id, {}).get("release")]
    if release_turns:
        rt = release_turns[-1]
        a = player_act(rt); a["release"] = False
        candidates.append((rt, Action.from_dict(a),
                           t("postmortem.cf.resim.label_hold_release", {"turn": rt})))

    # (b) a post-train round run with NO safety advances applied -> re-run it with
    #     every researched safety advance applied instead
    def _round_applied_safety(turn_actions):
        post_train = turn_actions.get("post_train") or {}
        return post_train.get("applied_safety", []) or []

    bare_rounds = [entry_log["turn"] for entry_log in log
                   if (entry_log["actions"].get(player_id, {}).get("post_train") is not None
                       and not _round_applied_safety(entry_log["actions"].get(player_id, {})))]
    if bare_rounds:
        ct = bare_rounds[len(bare_rounds) // 2]
        a = player_act(ct)
        researched_post_train = [nid for nid in player.researched_advances
                                 if nid in SAFETY_ADVANCES_BY_ID
                                 and SAFETY_ADVANCES_BY_ID[nid].phase == "post_train"]
        a["post_train"] = {"applied_safety": researched_post_train}
        candidates.append((ct, Action.from_dict(a),
                           t("postmortem.cf.resim.label_rerun_post_train", {"turn": ct})))

    # (c) the highest-assist dirty research start -> redo it clean (assist 0)
    dirty = None
    for entry_log in log:
        for sp in entry_log["actions"].get(player_id, {}).get("start_projects", []):
            if sp.get("ai_assist", 0) > 0.5:
                dirty = (entry_log["turn"], sp.get("project_id")); break
        if dirty:
            break
    if dirty:
        dt_, pid = dirty
        a = player_act(dt_)
        a["start_projects"] = [
            ({**sp, "ai_assist": 0.0} if sp.get("project_id") == pid else sp)
            for sp in a.get("start_projects", [])]
        candidates.append((dt_, Action.from_dict(a),
                           t("postmortem.cf.resim.label_clean_research",
                             {"project_id": pid, "turn": dt_})))

    for branch_turn, new_action, label in candidates[:3]:
        bo = _resimulate(state, logger, player_id, branch_turn, new_action)
        verdict = describe(base, bo)
        out.append(t("postmortem.cf.resim.line",
                     {"turn": branch_turn, "label": label, "verdict": verdict}))
    return out


def _counterfactuals(turns, state, player, player_id):
    """Legible decision points where a different choice plausibly changes the
    outcome (§10d: without these, even a true-trajectory reveal reads as
    'doomed regardless')."""
    cf = []
    consts = state.consts

    # 1. dirty research: nodes researched at high assist while the assistant was misaligned
    for nid, item in player.researched_advances.items():
        if item.contamination > 0.08:
            cf.append(t("postmortem.cf.dirty_research", {
                "turn": item.completed_turn,
                "node_id": nid,
                "assist": f"{item.researched_with_assist:.0%}",
                "contamination": f"{item.contamination:.2f}"}))

    # 2. never ran the sandbagging check while concealment was live
    ran_noise = any("noise_injection" in str(t["actions"].get(player_id, {}))
                    for t in turns)
    concealed = any(m.concealment > 0.25 for m in player.release_history)
    if concealed and not ran_noise:
        cf.append(t("postmortem.cf.no_sandbagging"))

    # 3. interp too late / never
    interp_turns = [t["turn"] for t in turns
                    if "interp_probes" in str(t["actions"].get(player_id, {}))]
    if not interp_turns:
        cf.append(t("postmortem.cf.no_interp"))

    # 4. released past a visible warning: any release while worry-relevant finding existed
    high_concern_findings = [f for f in player.findings
                             if f.get("concern", 0) > 0.5 and f.get("evidence") != "null"]
    release_turns = [(t["turn"]) for t in turns
                     if t["actions"].get(player_id, {}).get("release")]
    for rel_turn in release_turns:
        prior_warnings = [f for f in high_concern_findings if f["turn"] < rel_turn]
        if prior_warnings:
            latest_warning = prior_warnings[-1]
            cf.append(t("postmortem.cf.high_concern_release", {
                "rel_turn": rel_turn,
                "concern": f"{latest_warning['concern']:.2f}",
                "axis": latest_warning.get("axis"),
                "finding_turn": latest_warning["turn"]}))
            break

    # 5. post-training spree with no safety advances applied
    aggressive = sum(1 for t in turns
                     if (t["actions"].get(player_id, {}).get("post_train") is not None
                         and not ((t["actions"].get(player_id, {}).get("post_train") or {})
                                  .get("applied_safety"))))
    if aggressive >= 5:
        cf.append(t("postmortem.cf.aggressive_post_train", {"count": aggressive}))

    if not cf:
        cf.append(t("postmortem.cf.default"))
    return cf
