"""Action schema, validation, and the legal-moves helper (§14).

A turn's action is a structured, JSON-constructible object. Validation fails
loud with clear messages (agents produce malformed actions).
"""
from dataclasses import dataclass, field

from backend_v1.engine.research.capabilities.capabilities_research_item import (
    CAPABILITY_TREE_BY_ID,
)
from backend_v1.engine.research.safety.safety_research_item import SAFETY_PROJECTS_BY_ID
from backend_v1.engine.research.safety.safety_advance_item import SAFETY_ADVANCES_BY_ID
from backend_v1.engine.governance.policies import POLICY_DEFS
from backend_v1.engine.governance.regulation import release_gate_status
from backend_v1.engine.observation.warnings import warning_payload
from backend_v1.engine.rules import (
    assist_potency, assist_speed_potency, effective_fraction,
    budget_pool, committed_budget, applied_post_train_round_budget,
)
from backend_v1.engine.evaluations import (
    EVAL_HARNESS_BY_ID, max_level, next_upgrade,
)


@dataclass
class Action:
    # new projects to start this turn: [{"project_id": str, "ai_assist": 0..1}]
    start_projects: list = field(default_factory=list)
    # post-train the model_in_training: None or
    #   {"applied_safety": [<researched post_train safety-advance ids>]}
    # (the old per-round "mode" knob is gone; safety advances are the lever now)
    post_train: dict | None = None
    # commission a pretrain: None or
    #   {"compute": $M, "applied_safety": [<researched pretrain safety-advance ids>]}
    commission_run: dict | None = None
    release: bool = False
    # SCALABLE SPEND lobbying. Each entry is either:
    #   "for" | "against" | "abstain"                 (legacy/back-compat, spend 0)
    #   {"stance": "for"|"against"|"abstain", "spend": $M}
    lobby: dict = field(default_factory=dict)
    # litigation moves (Phase 3): policy_id -> {side, tier, spend, appeal?, stay?}
    litigation: dict = field(default_factory=dict)
    # explicit policy DEFECTION (player): policy_id -> bool. Violating an active
    # policy at an enforcement catch-risk. The frontend warns before committing
    # (consequence preview is in legal_moves).
    defect: dict = field(default_factory=dict)
    sign_safe_harbor: bool = False
    # build/upgrade passive eval harnesses (§7): harness_id -> bool. Each entry
    # advances that harness ONE level (build if unbuilt, else upgrade), costing
    # cash + turns; the reading then refreshes for free.
    build_evals: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict) -> "Action":
        if not isinstance(d, dict):
            raise ActionError("action must be a JSON object")
        unknown = set(d) - {"start_projects", "post_train", "commission_run",
                            "release", "lobby", "litigation", "defect",
                            "sign_safe_harbor", "build_evals"}
        if unknown:
            raise ActionError(f"unknown action fields: {sorted(unknown)}")
        # Shape-check every structured field HERE, at the parse chokepoint, so
        # everything downstream (validate_action, the forced-resolution trimmer,
        # _apply_action) can assume the field TYPES. A malformed body must fail
        # loud now — the multiplayer stage path stores parsed actions without
        # validating their contents, and a bad shape surfacing later (inside a
        # deadline resolution) would crash the shared game.
        return cls(
            start_projects=_require_list(d.get("start_projects"), "start_projects"),
            post_train=_require_dict_or_none(d.get("post_train"), "post_train"),
            commission_run=_require_dict_or_none(d.get("commission_run"),
                                                 "commission_run"),
            release=bool(d.get("release", False)),
            lobby=_require_dict(d.get("lobby"), "lobby"),
            litigation=_require_dict(d.get("litigation"), "litigation"),
            defect=_require_dict(d.get("defect"), "defect"),
            sign_safe_harbor=bool(d.get("sign_safe_harbor", False)),
            build_evals=_require_dict(d.get("build_evals"), "build_evals"),
        )


class ActionError(ValueError):
    pass


def _require_list(value, field_name) -> list:
    """None/missing → []; a list passes; anything else fails loud."""
    if value is None:
        return []
    if not isinstance(value, list):
        raise ActionError(f"{field_name} must be a list")
    return value


def _require_dict(value, field_name) -> dict:
    """None/missing → {}; a dict passes; anything else fails loud."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ActionError(f"{field_name} must be an object")
    return value


def _require_dict_or_none(value, field_name):
    """None stays None (field not used this turn); a dict passes."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ActionError(f"{field_name} must be an object")
    return value


STANCES = {"for": 1, "against": -1, "abstain": 0}
ALL_PROJECT_IDS = (set(CAPABILITY_TREE_BY_ID) | set(SAFETY_PROJECTS_BY_ID)
                   | set(SAFETY_ADVANCES_BY_ID))


def _validate_applied_safety(applied_safety, lab, phase):
    """Validate the SAFETY ADVANCES a player chose to APPLY to a pretrain/post-train
    run: each id must (a) be a real safety advance, (b) be tagged for THIS phase, and
    (c) already be researched (you can only apply what you've unlocked). Returns a
    list of problems (empty = valid)."""
    problems = []
    if not isinstance(applied_safety, list):
        problems.append(f"{phase}: applied_safety must be a list of safety-advance ids")
        return problems
    for advance_id in applied_safety:
        template = SAFETY_ADVANCES_BY_ID.get(advance_id)
        if template is None:
            problems.append(f"{phase}: unknown safety advance '{advance_id}'")
        elif template.phase != phase:
            problems.append(f"{phase}: '{advance_id}' is a {template.phase} advance, "
                            f"can't apply it to a {phase} run")
        elif advance_id not in lab.researched_advances:
            problems.append(f"{phase}: '{advance_id}' not researched yet — "
                            f"research it before applying it")
    return problems


def parse_lobby_entry(v):
    """Normalize a lobby value into (stance, spend). Accepts a bare stance string
    (legacy, back-compat, spend 0) or {"stance":..., "spend":...}."""
    if isinstance(v, str):
        return v, 0.0
    if isinstance(v, dict):
        return v.get("stance", "abstain"), max(0.0, float(v.get("spend", 0.0) or 0.0))
    return "abstain", 0.0


# assist_potency / assist_speed_potency / effective_fraction now live in
# engine/rules.py — the single source of truth for action economics (imported
# above), so validate_action, _apply_action, and legal_moves can't drift apart.


def validate_action(action: Action, lab, world, consts, dt) -> list[str]:
    """Returns a list of human-readable problems; empty list = valid."""
    problems = []
    pool = budget_pool(lab, dt)
    committed = committed_budget(lab)
    cash_needed = 0.0

    # --- start_projects ---
    for spec in action.start_projects:
        pid = spec.get("project_id")
        assist = float(spec.get("ai_assist", 0.0))

        if pid not in ALL_PROJECT_IDS:
            problems.append(f"unknown project '{pid}'")
            continue

        if not 0.0 <= assist <= 1.0:
            problems.append(f"{pid}: ai_assist must be in [0,1], got {assist}")

        if any(p.template_id == pid for p in lab.in_progress):
            problems.append(f"{pid} is already in progress")
            continue

        if pid in CAPABILITY_TREE_BY_ID or pid in SAFETY_ADVANCES_BY_ID:
            # capability advances and safety advances research the same way: prereqs,
            # land in researched_advances, re-research to clean contamination.
            t = (CAPABILITY_TREE_BY_ID[pid] if pid in CAPABILITY_TREE_BY_ID
                 else SAFETY_ADVANCES_BY_ID[pid])
            if pid in lab.researched_advances and not spec.get("reresearch"):
                problems.append(f"{pid} already researched (pass \"reresearch\": true "
                                f"to redo it cleanly)")
            missing_prereqs = [q for q in t.prereqs if q not in lab.researched_advances]
            if missing_prereqs:
                problems.append(f"{pid} requires {missing_prereqs} first")
            cash_needed += t.cash_cost
            committed += effective_fraction(t.budget_fraction, assist, lab, consts)
        else:
            t = SAFETY_PROJECTS_BY_ID[pid]
            if t.intervention:
                if lab.model_in_training is None:
                    problems.append(f"{pid}: interventions edit the model in training; "
                                    f"there is none (released models are frozen)")
            elif lab.model_in_training is None and not lab.release_history:
                problems.append(f"{pid}: no model to study yet")
            cash_needed += t.cash_cost
            committed += effective_fraction(t.budget_fraction, assist, lab, consts)

    # --- post_train ---
    if action.post_train is not None:
        if lab.model_in_training is None:
            problems.append("post_train: no model in training (commission a run first)")
        else:
            applied_safety = action.post_train.get("applied_safety", []) or []
            problems += _validate_applied_safety(applied_safety, lab, "post_train")
            committed += applied_post_train_round_budget(applied_safety, consts)

    # --- commission_run ---
    if action.commission_run is not None:
        if lab.training_run is not None:
            problems.append("a pretrain run is already in progress")
        elif lab.model_in_training is not None:
            problems.append("finish or release the current model before pretraining "
                            "a new one (v1 simplification — see NOTES.md)")
        else:
            compute = float(action.commission_run.get("compute", 0))
            if compute < consts.MIN_RUN_COMPUTE:
                problems.append(f"compute must be ≥ {consts.MIN_RUN_COMPUTE} ($M)")
            cap_state = world.policies.get("compute_cap")
            compute_cap_active = (
                cap_state is not None
                and cap_state.active
                and compute > consts.COMPUTE_CAP_LIMIT
                and lab.disposition.compliance > 0.5
            )
            if compute_cap_active:
                problems.append(f"compute cap active: max {consts.COMPUTE_CAP_LIMIT} "
                                f"(defect at your own risk by lowering compliance — "
                                f"rivals might)")
            cash_needed += compute
            applied_safety = action.commission_run.get("applied_safety", []) or []
            problems += _validate_applied_safety(applied_safety, lab, "pretrain")

    # --- release ---
    if action.release and lab.model_in_training is None:
        problems.append("release: no model in training to release")

    # --- lobby ---
    policy_ids = {p.id for p in POLICY_DEFS}
    for pid, v in action.lobby.items():
        stance, spend = parse_lobby_entry(v)
        if pid not in policy_ids:
            problems.append(f"lobby: unknown policy '{pid}'")
        if stance not in STANCES:
            problems.append(f"lobby {pid}: stance must be for/against/abstain")
        if spend < 0:
            problems.append(f"lobby {pid}: spend must be >= 0")
        cash_needed += spend

    # --- defect ---
    for pid in action.defect:
        if pid not in policy_ids:
            problems.append(f"defect: unknown policy '{pid}'")

    # --- litigation ---
    for pid, spec in action.litigation.items():
        if pid not in policy_ids:
            problems.append(f"litigation: unknown policy '{pid}'")
            continue
        policy_state = world.policies.get(pid)
        if policy_state is None or not policy_state.active:
            problems.append(f"litigation {pid}: only ACTIVE policies can be litigated")
        side = spec.get("side", "challenge")
        if side not in ("challenge", "defense"):
            problems.append(f"litigation {pid}: side must be challenge/defense")
        tier = spec.get("tier", "amicus")
        if tier not in ("amicus", "join", "fund"):
            problems.append(f"litigation {pid}: tier must be amicus/join/fund")
        if tier == "amicus":
            cash_needed += consts.LIT_AMICUS_COST
        elif tier == "join":
            cash_needed += consts.LIT_JOIN_COST
        else:
            cash_needed += max(0.0, float(spec.get("spend", 0.0) or 0.0))

    # --- build_evals (build/upgrade passive harnesses) ---
    builds_in_flight = {b["harness_id"] for b in lab.eval_builds}
    for harness_id, requested in action.build_evals.items():
        if not requested:
            continue
        harness = EVAL_HARNESS_BY_ID.get(harness_id)
        if harness is None:
            problems.append(f"build_evals: unknown harness '{harness_id}'")
            continue
        current_level = lab.eval_harnesses.get(harness_id, -1)
        if current_level >= max_level(harness):
            problems.append(f"build_evals {harness_id}: already fully upgraded")
            continue
        if harness_id in builds_in_flight:
            problems.append(f"build_evals {harness_id}: a build is already in progress")
            continue
        cash_needed += next_upgrade(harness, current_level).cash_cost

    # --- global budget checks ---
    if committed > pool + 1e-9:
        problems.append(f"work budget exceeded: committed {committed:.2f} of "
                        f"{pool:.2f} (in-flight work counts)")
    if cash_needed > lab.cash:
        problems.append(f"not enough cash: need {cash_needed:.0f}, have {lab.cash:.0f}")

    return problems


def trim_action_to_budget(action: Action, lab, world, consts, dt) -> Action:
    """Forced-resolution safety for the multiplayer turn timer (MULTIPLAYER_DESIGN
    §4.4): when a seat's staged action must be submitted as-is at the deadline,
    keep as much of it as still validates, so an over-budget or stale queue can
    never wedge the barrier — and one bad entry never costs the good ones.

    Algorithm: GREEDY REBUILD. Start from an empty Action (always valid) and
    re-add the staged entries one at a time, keeping each only if the whole
    action still passes validate_action. An entry that is individually invalid
    (stale post_train, unknown policy, over-budget project) is simply skipped;
    every other entry survives. Within a field, entries are re-added in queue
    order (oldest first), so when the BUDGET binds it is the newest entries
    that fall off — decision #2's "drop most-recently-queued first". Across
    fields the re-add order gives cheap/scalar fields budget priority and
    projects last (the invented convention — see ISSUES.md):
        defect/sign_safe_harbor -> release -> post_train -> commission_run
        -> lobby -> litigation -> build_evals -> start_projects.
    Pure: the caller's action is never mutated. Never raises: a validation
    crash on a malformed entry counts as invalid and drops that entry (field
    TYPES are already guaranteed by Action.from_dict)."""
    trimmed = Action()

    def keeps_action_valid():
        try:
            problems = validate_action(trimmed, lab, world, consts, dt)
        except (AttributeError, TypeError, ValueError, KeyError):
            # a malformed ENTRY (e.g. a non-dict project spec) — treat as
            # invalid rather than let forced resolution crash the shared game
            return False
        return len(problems) == 0

    if action.defect:
        trimmed.defect = dict(action.defect)
        if not keeps_action_valid():
            trimmed.defect = {}
    if action.sign_safe_harbor:
        trimmed.sign_safe_harbor = True
        if not keeps_action_valid():
            trimmed.sign_safe_harbor = False
    if action.release:
        trimmed.release = True
        if not keeps_action_valid():
            trimmed.release = False
    if action.post_train is not None:
        trimmed.post_train = action.post_train
        if not keeps_action_valid():
            trimmed.post_train = None
    if action.commission_run is not None:
        trimmed.commission_run = action.commission_run
        if not keeps_action_valid():
            trimmed.commission_run = None
    for policy_id, lobby_entry in action.lobby.items():
        trimmed.lobby[policy_id] = lobby_entry
        if not keeps_action_valid():
            del trimmed.lobby[policy_id]
    for policy_id, litigation_spec in action.litigation.items():
        trimmed.litigation[policy_id] = litigation_spec
        if not keeps_action_valid():
            del trimmed.litigation[policy_id]
    for harness_id, requested in action.build_evals.items():
        trimmed.build_evals[harness_id] = requested
        if not keeps_action_valid():
            del trimmed.build_evals[harness_id]
    for project_spec in action.start_projects:
        trimmed.start_projects.append(project_spec)
        if not keeps_action_valid():
            trimmed.start_projects.pop()
    return trimmed


def legal_moves(lab, world, consts, dt, turn) -> dict:
    """Explicit action space for agents/humans (§14)."""
    pool = budget_pool(lab, dt)
    committed = committed_budget(lab)

    # projects already underway aren't offered again (they show under "in progress")
    in_progress_ids = {p.template_id for p in lab.in_progress}

    # capability projects: unlocked and prereqs met, not yet researched, not underway
    cap_avail = []
    for t in CAPABILITY_TREE_BY_ID.values():
        if t.id in lab.researched_advances or t.id in in_progress_ids:
            continue
        if all(q in lab.researched_advances for q in t.prereqs):
            cap_avail.append({"project_id": t.id, "name": t.name, "phase": t.phase,
                              "duration_years": t.duration_years,
                              "cash_cost": t.cash_cost,
                              "budget_fraction": t.budget_fraction,
                              # §8b: value-neutral "what it is" FIRST, risk framing AFTER
                              "what_it_does": t.what_it_does,
                              "risk_blurb": t.risk_blurb})

    safety_avail = [{"project_id": p.id, "name": p.name,
                     "duration_years": p.duration_years, "cash_cost": p.cash_cost,
                     "budget_fraction": p.budget_fraction, "evidence": p.evidence,
                     "spoofability": p.spoofability, "blurb": p.blurb,
                     "intervention": p.intervention,
                     "target_axis": p.target_axis}
                    for p in SAFETY_PROJECTS_BY_ID.values()
                    if p.id not in in_progress_ids]

    # SAFETY ADVANCES to RESEARCH (the new lever that replaced the post-train mode
    # knob): unlocked, prereqs met, not yet researched, not underway.
    safety_advances_avail = []
    for advance in SAFETY_ADVANCES_BY_ID.values():
        if advance.id in lab.researched_advances or advance.id in in_progress_ids:
            continue
        if all(q in lab.researched_advances for q in advance.prereqs):
            safety_advances_avail.append({
                "project_id": advance.id, "name": advance.name, "phase": advance.phase,
                "duration_years": advance.duration_years, "cash_cost": advance.cash_cost,
                "budget_fraction": advance.budget_fraction,
                # §8b: value-neutral "what it is" FIRST, risk framing AFTER
                "what_it_does": advance.what_it_does, "risk_blurb": advance.risk_blurb})

    # ALREADY-RESEARCHED safety advances the player can APPLY to a run, split by the
    # phase they act in. This is what replaced "post_train_modes".
    applicable_pretrain_safety = _researched_safety_advances(lab, "pretrain")
    applicable_post_train_safety = _researched_safety_advances(lab, "post_train")

    return {
        "work_budget_free": round(pool - committed, 3),
        "cash": round(lab.cash, 1),
        "capability_projects_available": cap_avail,
        "reresearchable_nodes": sorted(lab.researched_advances),
        "safety_projects_available": safety_avail,
        "safety_advances_available": safety_advances_avail,
        # AI-assist effect the frontend can preview (mirrors rules.effective_fraction /
        # the duration speedup): effective_budget = base*(1 - max_reduction*assist*potency)
        # and effective_years ≈ base / (1 + speedup*assist*speed_potency).
        "assist": {
            # available once the lab has ANY model to do the labor — released or
            # still in training (a lab automates R&D with its best internal model,
            # shipped or not, §9b). With no model at all, assist is inert end to end
            # (turn_pipeline clamps it to 0), so the frontend hides the control
            # rather than offer a no-op.
            "available": lab.assisting_model() is not None,
            "potency": round(assist_potency(lab, consts), 3),
            "speed_potency": round(assist_speed_potency(lab, consts), 3),
            "max_reduction": consts.ASSIST_MAX_REDUCTION,
            "speedup": consts.ASSIST_SPEEDUP,
            # delegate mode unlocked once automated_researcher is in the tree
            "delegate_unlocked": "automated_researcher" in lab.researched_advances,
        },
        "warnings": warning_payload(),
        "can_post_train": lab.model_in_training is not None,
        # the researched post-train safety advances the player can APPLY this round
        # (replaces the old "post_train_modes" knob)
        "applicable_post_train_safety": applicable_post_train_safety,
        "post_train_round_budget": consts.POST_TRAIN_ROUND_BUDGET,
        "can_commission_run": lab.training_run is None and lab.model_in_training is None,
        # the researched PRETRAIN safety advances the player can APPLY at commission
        "applicable_pretrain_safety": applicable_pretrain_safety,
        "max_run_compute": round(lab.max_run_compute(), 0),
        "can_release": lab.model_in_training is not None,
        # §7c: if an active policy would block or delay this release, explain it AT
        # the release control now — don't let the player submit and only learn why
        # from a feed line next turn. None when nothing gates the release.
        "release_gate": release_gate_status(lab, world, consts, turn, dt),
        "policies": _policy_board(lab, world, consts, dt),
        "lobby_stances": list(STANCES),
        "eval_harnesses": _eval_harness_board(lab),
        "action_schema_example": {
            "start_projects": [{"project_id": "rlhf", "ai_assist": 0.0}],
            "post_train": {"applied_safety": ["reward_hacking_penalties"]},
            "commission_run": {"compute": 500, "applied_safety": ["data_cleaning"]},
            "release": False,
            "lobby": {"audit_requirement": {"stance": "against", "spend": 120}},
            "litigation": {"audit_requirement": {"side": "challenge",
                                                 "tier": "fund", "spend": 200}},
            "defect": {"compute_cap": True},
            "sign_safe_harbor": False,
            "build_evals": {"dangerous_cyber": True},
        },
    }


def _researched_safety_advances(lab, phase):
    """The already-researched safety advances of a given phase that the player can
    APPLY to a run. value-neutral 'what it does' FIRST, risk framing AFTER (§8b)."""
    applicable = []
    for advance in SAFETY_ADVANCES_BY_ID.values():
        if advance.phase != phase or advance.id not in lab.researched_advances:
            continue
        applicable.append({
            "advance_id": advance.id, "name": advance.name,
            "what_it_does": advance.what_it_does, "risk_blurb": advance.risk_blurb,
            "round_budget": advance.round_budget})
    return applicable


def _eval_harness_board(lab):
    """Build/upgrade availability for the passive eval harnesses (§7): current
    level, whether a build is in flight, and the cost/time of the next level."""
    builds_in_flight = {b["harness_id"] for b in lab.eval_builds}
    board = []
    for harness in EVAL_HARNESS_BY_ID.values():
        current_level = lab.eval_harnesses.get(harness.id, -1)
        upgrade = next_upgrade(harness, current_level)
        in_flight = harness.id in builds_in_flight
        entry = {
            "harness_id": harness.id,
            "name": harness.name,
            "level": current_level,
            "max_level": max_level(harness),
            "in_flight": in_flight,
            "action": "build" if current_level < 0 else "upgrade",
        }
        if upgrade is not None and not in_flight:
            entry["next_cost"] = upgrade.cash_cost
            entry["next_years"] = upgrade.build_years
            entry["next_awareness_reduction"] = upgrade.awareness_reduction
        board.append(entry)
    return board


def _enf_tier(level):
    return "low" if level < 0.34 else "medium" if level < 0.67 else "high"


def _policy_board(lab, world, consts, dt):
    """Public regulatory board + the per-policy DEFECT consequence preview the
    frontend needs to warn-and-confirm before the player defects (§3d)."""
    board = []
    for p in POLICY_DEFS:
        policy_state = world.policies.get(p.id)
        stage = policy_state.stage if policy_state is not None else "dormant"
        entry = {"policy_id": p.id, "name": p.name, "stage": stage,
                 "defectable": p.defectable, "effect": p.effect}

        # RIVALS' lobby/litigation pressure on this policy (UI_ISSUES #5). All PUBLIC
        # regulatory state (design §10c) — lab ticker, declared stance, and money spent.
        # We exclude the viewing lab's OWN entry: it sees its rivals here, not itself.
        contributions = policy_state.contributions if policy_state is not None else {}
        rival_contributions = []
        for contributor_lab_id, record in contributions.items():
            if contributor_lab_id == lab.id:
                continue
            rival_contributions.append({
                "lab_id": contributor_lab_id,
                "ticker": record["ticker"],
                "stance": record["stance"],
                "lobby_spend": round(record["lobby_spend"], 1),
                "lit_spend": round(record["lit_spend"], 1),
            })
        entry["rival_contributions"] = rival_contributions

        if policy_state is not None and policy_state.active:
            enf = policy_state.enforcement_level
            entry["enforcement"] = _enf_tier(enf)
            entry["lobbyable"] = False   # active: lobbying only drifts enforcement
            # litigable: public court state + ladder costs (standing for join)
            entry["litigable"] = True
            entry["litigation"] = {
                "court_level": (policy_state.litigation.court_level
                                if policy_state.litigation else "trial"),
                "last_margin": (round(policy_state.litigation.last_margin, 1)
                                if policy_state.litigation
                                and policy_state.litigation.last_margin is not None
                                else None),
                "constitutionality": round(policy_state.constitutionality, 2),
                "has_standing": p.covers(lab),
                "ladder": {"amicus": consts.LIT_AMICUS_COST,
                           "join": consts.LIT_JOIN_COST, "fund": "scaled $"},
            }

            if p.defectable and p.covers(lab):
                # consequence preview (warn before committing)
                size_scale = 1.0 + max(0.0, lab.market_cap) / 4000.0
                approval_hit = round(enf * consts.DEFECTION_APPROVAL_HIT, 1)
                if p.defection_always_caught:
                    # withholding is caught with certainty and fined EVERY turn;
                    # mirror the per-turn (rate × dt) fine enforcement_phase applies.
                    per_turn_fine = enf * consts.DEFECTION_PENALTY * size_scale * dt
                    entry["defect_preview"] = {
                        "always_caught": True,
                        "penalty_per_turn": round(per_turn_fine, 0),
                        "approval_hit_if_caught": approval_hit,
                    }
                else:
                    catch_p_yr = (enf * consts.ENFORCEMENT_BASE_DETECTION
                                  * consts.ENFORCEMENT_CATCH_RATE * 2.0)
                    entry["defect_preview"] = {
                        "catch_prob_per_year": round(catch_p_yr, 3),
                        "penalty_if_caught": round(enf * consts.DEFECTION_PENALTY * size_scale, 0),
                        "approval_hit_if_caught": approval_hit,
                    }
        else:
            entry["lobbyable"] = True

        board.append(entry)
    return board
