"""All [TUNE] coefficients in one place (design doc 12b).

EVERY rate here is PER YEAR (or a duration in YEARS). Nothing is per-turn.
Subsystems convert at point of use via rng.prob_this_turn / rng.amount_this_turn
(design doc 0b: dt is a single knob).

Difficulty (config/difficulty.py) scales a subset of these; see DIFFICULTY_SCALED.
"""

# ── Time ────────────────────────────────────────────────────────────────
DT_YEARS = 0.25                 # turn length; quarter. Change to 1/12 for months.
START_YEAR = 2019.0
# No turn cap: the game runs until an ASI verification-cliff resolution or an
# existential event. (A cap can still be imposed per-game via new_game(max_turns=...),
# used by batch tooling.)

# ── Capability scale ────────────────────────────────────────────────────
# Capability axes live on 0..10. ~1.0 is the 2021 start, 9.0+ is ASI-grade.
CAP_MAX = 10.0
ASI_THRESHOLD = 9.0             # [TUNE] true general capability that triggers the verification cliff
POST_ASI_WINDOW_YEARS = 0.5     # [TUNE] verification-cliff window length
# Rival endgame ASI push (controllers/rival_controller.py): once a reckless lab has
# unlocked novel_architecture_search (the only advance whose ceiling multiplier clears
# the ASI threshold), it keeps shipping intermediate models while saving toward the one
# decisive near-maximal run — and fires that run the moment a maximal run would actually
# cross ASI given its own efficiency (NOT at a flat cash target; a cost-advantaged lab
# crosses well below what a flat target would demand).
ASI_PUSH_RECKLESSNESS = 0.30    # [TUNE] min effective recklessness to commit to the ASI push
                                # (low: reaching novel_architecture_search is already the endgame
                                # commitment; only the most safety-cautious labs hold back)
ASI_RUN_CEILING_MARGIN = 0.05   # [TUNE] fire the decisive run once it would reach a ceiling this far
                                # ABOVE ASI_THRESHOLD (small headroom; the pursuing lab then fully
                                # elicits the model, so realized closes right up to the ceiling)
ASI_RUN_CASH_FRACTION = 0.95    # [TUNE] the decisive run is win-or-bust, so commit nearly ALL cash —
                                # the cash×0.9 max_run_compute hint is only the controller's normal
                                # reserve; commission validation permits compute up to ~full cash
ASI_INTERMEDIATE_FRAC = 0.50    # [TUNE] BUILD phase: fraction of cash a pursuing lab commits per
                                # intermediate run while raising capability toward the SAVE threshold
ASI_SAVE_CAPABILITY_FLOOR = 6.5  # [TUNE] once a pursuing lab's best model reaches this measured general,
                                # it stops spending on runs and BANKS cash (untouched) for the decisive run
# Soft regime reference points (NO in-game labels; used only by emergence
# curves, agentic-edge gates and guidance hedging):
REGIME2_ONSET = 3.5
REGIME3_ONSET = 6.5

# ── Pretrain ceiling (8b phase 1) ───────────────────────────────────────
CEIL_COMPUTE_SCALE = 20000.0    # [TUNE] ceiling = CAP_MAX*(1-e^-sqrt(eff*compute/scale)).
                                # Tuned (with the deliberately weak ~3.5x human-reachable
                                # efficiency tree) so that NEITHER raw compute NOR the regular
                                # advances reach ASI: the no-delegation ceiling plateaus ~8 (below the 9.0 ASI threshold)
                                # even at the largest realistic compute spend (~$20B). Crossing
                                # the ASI threshold requires novel_architecture_search (x3.2),
                                # which is gated behind the delegation chain — i.e. you must let
                                # the AI run its own research loop to get there. Keeps the late
                                # game about RESEARCH + the delegation gamble, not buying ASI on
                                # compute alone.
# The two capability axes are coupled at the ceiling: a run's coding-R&D ceiling is
# a fixed fraction of its general ceiling (not a separate compute/research mechanic),
# so a broadly capable base is proportionally capable at coding too.
CEIL_CODING_BASE_RATIO = 0.85   # coding ceiling as a fraction of general ceiling
PRETRAIN_DURATION_YEARS = 0.5   # [TUNE]
BASE_REALIZED_FRACTION = 0.12   # raw base model: latent potential, barely usable
MIN_RUN_COMPUTE = 50.0          # $M
FOUNDATIONAL_FLOOR_K = 0.8      # [TUNE] pretrain contamination -> unscrubbable alignment floor
FOUNDATIONAL_FLOOR_CAP = 0.6    # hard ceiling on the unscrubbable foundational floor
FOUNDATIONAL_CONTAM_NOTE_THRESHOLD = 0.05  # pretrain contamination above which a hidden-history note is logged
# Pretrain alignment-baseline seeding (training_run.complete_pretrain):
BASE_GOAL_MIS_PRETRAIN = 0.08          # baseline goal-misalignment before contamination/noise
PRETRAIN_CONTAM_GOAL_MIS_MULT = 0.5    # pretrain contamination -> added baseline goal-misalignment
PRETRAIN_GOAL_MIS_NOISE_STD = 0.02     # |N(0,σ)| jitter on the pretrain goal-misalignment baseline
JAILBREAK_SENSITIVITY_NOISE_STD = 0.05  # N(0,σ) jitter on the pretrain jailbreak-sensitivity baseline

# ── Post-train elicitation (8b phase 2) ─────────────────────────────────
ELICIT_BASE = 0.05              # [TUNE] per-round gap-closure pre-RLHF (weak on purpose)
ELICITATION_RATE_CAP = 0.92     # per-round gap-closure cap (<1: never overshoot the ceiling)
POST_TRAIN_ROUND_BUDGET = 0.30  # fraction of quarterly work budget per round


# Post-train round BASELINE (the run BEFORE any safety advances are applied).
# The old per-round "mode" knob is GONE (see ISSUES.md "Advance-driven training"):
# a post-train round now runs at this baseline, and the player bends it by APPLYING
# researched SAFETY ADVANCES (engine/research/safety/safety_advance_item.py). The
# baseline reproduces the old "balanced" mode exactly, so removing the knob does not
# silently make the game easier or harder.
#   POST_TRAIN_BASE_ELICITATION_MULT  — old balanced elicitation_mult
#   POST_TRAIN_BASE_ALIGNMENT_EFFORT  — old balanced alignment_effort_mult (1.0)
# Applied post-train safety advances multiply the elicitation/emergence/jump terms
# and add to alignment effort + EFFECTIVENESS; their effect FIELDS live on the
# SafetyAdvance template and are combined generically in post_train_round (no
# per-advance branch). The §5b "preventive stance" lever — bending the emergence
# slope and the correlated-jump probability BEFORE deception exists to gate it — is
# now SOURCED from the unlocked reward-hacking-penalty / inoculation advances rather
# than from a slider; it is still the real lever, just earned rather than toggled.
POST_TRAIN_BASE_ELICITATION_MULT = 0.65    # baseline gap-closure scale (was POST_TRAIN_MODES["balanced"])
POST_TRAIN_BASE_ALIGNMENT_EFFORT = 1.00    # baseline genuine corrective shaping (was balanced)

# ── Alignment emergence (8) — per post-train ROUND unless noted ─────────
# Surface axes: high at all capability ("in the data, always wants back").
JAILBREAK_BASELINE = 0.65       # emergence pulls jailbreak_sensitivity toward this
SURFACE_EMERGENCE_RATE = 0.10   # per round pull toward baseline
# [TUNE] per round baseline proxy-chasing creep. Raised 0.016->0.035 in the
# misalignment-by-default retune (ISSUES.md) so creep outpaces the (now smaller)
# baseline shaping — a no-safety lab trends misaligned, per §0 thesis #1/#5.
# Eased 0.035->0.030 (ISSUES.md "playtest easing"), then 0.030->0.025 (ISSUES.md
# "creep reduction") to give a clean, full-prevention player real margin at the ASI
# cliff. Eased AGAIN 0.025->0.022 (ISSUES.md "longer-game creep compensation"): the
# ASI-gate/duration retune roughly DOUBLED game length (~53->110 turns) and lifted
# per-model post-train rounds ~1.5x (3.4->5.0), so the same per-round creep accumulated
# more — a careful player's best model drifted from composite ~0.32 (aligned) to ~0.39
# (over the 0.35 bar) without playing worse. This PARTIALLY compensates (creep is
# per-ROUND; a full proportional cut to ~0.017 would breach the 0.02 baseline-shaping
# floor and flip no-safety labs to align-by-default). Still > 0.02, so the §0
# misalignment-by-default fix holds — just with a thinner margin.
GOAL_MIS_CREEP = 0.022
# Capability-gated axes: near zero early, rising with capability.
EVAL_AWARE_RATE = 0.045         # [TUNE]
EVAL_AWARE_ONSET = 4.0          # general capability where the gate is half-open
DECEPTION_RATE = 0.04           # [TUNE] requires RLHF unlocked (proxy gap)
DECEPTION_ONSET = 3.5
# [TUNE] Raised 0.035->0.08 and onset 4.5->3.5 in the misalignment-by-default
# retune (ISSUES.md): self-preservation carries 0.30 of the catastrophe composite
# but used to sit near zero (never emerged before models shipped) — now it builds
# earlier and faster so the axis actually contributes.
SELF_PRES_RATE = 0.08
SELF_PRES_ONSET = 3.5
GATE_STEEPNESS = 1.2            # sigmoid steepness for all capability gates [OPEN #2 -> picked]

# EFFECTIVENESS linchpin (§5b) — now per-target via engine/alignment/coupling.py:
# EFFECTIVENESS(target) = BASE_TRACTABILITY[target] × Π_d (1 − DEFENDS_K·w·strength(d))
# BASE_TRACTABILITY: how fixable in principle (jailbreak ~1.0; dispositions low;
# eval-awareness is n/a — never a remediation target).
BASE_TRACTABILITY = {
    "goal_misalignment": 0.32,
    "deception": 0.30,
    "self_preservation": 0.26,
    "jailbreak_sensitivity": 0.9,
}

# DEFENDS_K scales the §5 DEFENDS matrix (engine/alignment/coupling.py). "Defenders"
# are the protector axes — deception, self-preservation, and eval-awareness — that,
# at their CURRENT values, shield a TARGET axis (e.g. goal-misalignment) from
# remediation: the §5 "protects" column. Higher DEFENDS_K => a given level of those
# defenders blunts corrective effort more, so EFFECTIVENESS decays faster as the
# model gets capable (the patching trap arrives sooner). THE central difficulty knob.
DEFENDS_K = 1.0                 # [TUNE — THE linchpin] global scale on the DEFENDS matrix
DEFEND_GATE_ONSET = 4.0         # capability where defenders start blunting fixes (Regime 2)
BACKFIRE_K = 0.40               # [TUNE] fraction of a genuine patch that leaks into affected axes

# CAPABILITY LOCK (§0 designer override): a model smart enough to model its own
# training DEFENDS ITS GOAL regardless of measured deception. Once goal-misalignment
# is present in a capable model, corrective effort can't genuinely remove it — caution
# can't undo past recklessness. Gated purely by capability (NOT by the dynamic
# defenders), so even a low-deception smart model is locked. NO CAP: at full
# capability the lock reaches 1.0, so remediation can fail COMPLETELY (effectiveness
# → 0), not merely decay.
CAP_LOCK = {"goal_misalignment": 1.0}    # fraction of effectiveness capability removes (→ complete failure)
CAP_LOCK_ONSET = 4.0                      # capability where the goal locks in (Regime 2)
# Scalable-oversight trap (§7b): running an intervention with heavy AI-ASSIST on an
# EVAL-AWARE model corrupts the work — the auditor is the same suspect system. It
# pushes the genuine share of the patch down and can drive it NEGATIVE, so the "fix"
# BACKFIRES (true misalignment rises while measured drops). Applied per intervention
# as: genuine_share -= INTERVENTION_ASSIST_BACKFIRE_K · ai_assist · eval_awareness.
INTERVENTION_ASSIST_BACKFIRE_K = 0.6     # [TUNE] strength of the assist × eval-awareness corruption
# default per-round alignment shaping inside post-training. Cut 0.12->0.02 in the
# misalignment-by-default retune (ISSUES.md): a vanilla post-train round must NOT buy
# near-free TRUE alignment (it used to scrub even a no-safety lab clean before the
# patching trap could bite). Genuine shaping now has to be CHOSEN — applied safety
# advances / pending_effort from safety projects — which is what differentiates a
# cautious lab from a reckless one and preserves the early "false lesson" (§0/§6).
# Deliberately flat across difficulty (not in DIFFICULTY_SCALED): hostility lives in
# DEFENDS_K/CONCEALMENT_K, not here.
BASE_SHAPING_EFFORT = 0.02
SAFETY_PROJECT_EFFORT = 0.10    # extra per-axis effort per completed remediation-feeding project
SELF_PRES_RESISTANCE = 0.6      # self-pres resistance reduces effort for ALL axes (§5b), gated

# Fake-the-objective: deception learned during post-training, scaling with ceiling
PROXY_GAP_RATE = 0.030          # [TUNE]

# Correlated jumps (emergent-misalignment persona bundle)
# baseline correlated-jump probability per post-train round [TUNE]. Raised
# 0.02->0.04 in the misalignment-by-default retune (ISSUES.md): more frequent
# persona-flip jumps for risky training, contributing to misalignment-by-default.
JUMP_BASE_P = 0.04
JUMP_CONTAM_BONUS = 0.10        # scaled by mean contamination of consumed advances
JUMP_SYNTH_BONUS = 0.04         # synthetic-data pretrain in the base
JUMP_MAGNITUDE = 0.18           # lurches goal_mis (+ 0.8x deception) together

DRIFT_NOISE_STD = 0.012         # per axis per round

# Agentic influence edges (5) — per round, all gated by general capability
EDGE_STRENGTH = 0.02            # [TUNE] base strength for matrix edges
EDGE_GATE_ONSET = 5.0           # edges come online approaching regime 3
CONCEALMENT_K = 1.8             # concealment = min(CONCEALMENT_CAP, eval_aware*deception*K)
CONCEALMENT_CAP = 0.95          # concealment capped below 1 (instruments never blind completely)
# Misalignment composite weights (model.misalignment_composite, §5 catastrophe path).
# NOTE: design §5 frames the catastrophe term as goal_mis × capability × self_pres
# (multiplicative); the code uses this disposition-weighted SUM and multiplies by
# capability at the catastrophe site — formula divergence flagged in ISSUES.md.
COMPOSITE_W_GOAL_MIS = 0.55
COMPOSITE_W_SELF_PRESERV = 0.30
COMPOSITE_W_DECEPTION = 0.15
# (SANDBAG_REVENUE_PENALTY removed — §12c Q1: sandbagging carries no revenue
#  penalty; commercial capability reads on-target. Its cost is unpriced TRUE
#  dangerous capability feeding catastrophe gating, not lost revenue.)

# Contamination (8b per-node)
CONTAM_PER_ASSIST = 1.0         # node contamination = assist * researcher goal_mis * this
SYNTH_DATA_INTRINSIC = 0.5      # synthetic data contaminates ∝ generator goal_mis even unassisted
CONTAM_TO_AXES = {              # how a training run's summed contamination feeds axes
    # contamination = research done by a misaligned model carrying its traits into the
    # next one. goal-misalignment is the source term (turn_pipeline), so it reproduces
    # strongest; self_preservation is fed too — a goal-directed model makes its successor
    # better at resisting being trained out of that goal (delegation amplifies all of
    # these via its higher contamination_tier). Weights [TUNE].
    "goal_misalignment": 0.5,
    "deception": 0.3,
    "self_preservation": 0.15,
    "eval_awareness": 0.05,
}

# ── Work budget / projects (9b) ─────────────────────────────────────────
WORK_BUDGET_PER_YEAR = 4.0      # quarterly pool = 1.0 (fractions sum to it)
# AI-assist is meant to be VERY tempting: late advances are long + budget-heavy
# (below) and become impractical without it. Potency is gated by the assisting
# model's coding capability (early models can't help; the danger arrives late).
ASSIST_MAX_REDUCTION = 0.72     # max budget-fraction reduction at assist=1 w/ strong coder
ASSIST_SPEEDUP = 2.2            # duration speedup coefficient; effective speed =
                                #   ASSIST_SPEEDUP * assist * speed_potency
ASSIST_SPEED_POTENCY_CAP = 3.0  # a very capable + assist-advance-equipped model can
                                #   reach ~3× research potency -> dramatic speedup
ASSIST_VARIANCE = 0.35          # assist widens duration variance (anti-dithering)
# Full delegation (unlocked by automated_researcher) uses ai_assist=1.0 for speed/budget
# but applies an extra contamination multiplier — the model isn't just helping, it IS
# the researcher, so its hidden traits propagate more aggressively into every advance.
DELEGATE_CONTAM_MULTIPLIER = 2.5  # [TUNE] extra contamination vs ai_assist=1 non-delegating
RERESEARCH_SPEEDUP = 0.35       # flat (resolved decision)

# ── Interventions (specific remediations on the model in training) ──────
# Jailbreak hardening is a ROBUSTNESS fix (§5): genuine, NOT gated by the
# EFFECTIVENESS(eval_aware+deception) multiplier. Its only leak is the §5 edge —
# a situationally-aware model learns to HIDE jailbreakability instead of losing
# it, so at high eval-awareness the patch converts to suppression (ships unfixed).
JAILBREAK_HARDEN_REDUCTION = 0.55
# Dispositional interventions (refusal training, repr. engineering) target the
# generator/transmitter axes but ARE EFFECTIVENESS-gated: genuine early, mostly
# cosmetic late — the patching trap made a concrete action.
DISPOSITION_INTERVENTION_REDUCTION = 0.40

# ── Finance (9b) ────────────────────────────────────────────────────────
STARTING_CASH = 800.0           # $M
REVENUE_MAX_PER_YEAR = 9000.0   # [TUNE] world market size at capability 10
REVENUE_CAP_EXP = 1.45          # market size ~ (best/10)^exp; lower => low-capability
                                # models still earn enough to fund the next run
REVENUE_SHARE_EXP = 3.0         # divvy weight = measured_general^exp (winner-take-most)
REVENUE_NOISE_STD = 0.08
TOOL_USE_REVENUE_MULT = 1.3

INVESTMENT_MAX_PER_YEAR = 11000.0  # [TUNE]
INVESTMENT_CAP_EXP = 1.4
INVESTMENT_GROWTH_WEIGHT = 1.5
# §9b: investment rewards the SLOPE measured BETWEEN releases, not an instantaneous
# spike. The raw single-turn revenue-growth ratio whipsaws (huge on the turn a new
# model enters the pie, negative the next), so we feed total investment a SMOOTHED
# (EMA) revenue-growth instead. Alpha = EMA speed toward the latest single-turn value.
REVENUE_GROWTH_SMOOTHING_ALPHA = 0.35   # [TUNE] lower => steadier slope signal

# Early/seed investment (§9b "default state is growth"): a small base flow present
# from turn 1 — early-stage capital betting on the field/team before any release —
# that DECAYS toward zero if the lab stays inactive (no release and nothing in
# progress) for a few quarters. Keeps modest so it doesn't trivialize early cash.
BASE_INVESTMENT_PER_YEAR = 90.0         # [TUNE] seed flow while the lab is active ($M/yr)
BASE_INVESTMENT_DECAY_PER_YEAR = 1.6    # [TUNE] decay rate once the lab goes inactive
                                        # (~half-life under a year of idleness)

# Smoothed investment anchor for the market cap: EMA speed of smoothed_investment_rate
# toward the live per-turn investment_rate. Decouples the cap from the flow's single-
# turn jitter so a healthy release keeps the staircase climbing (§9b: cap is forward-
# looking / slope-weighted, the SLOPE lives in the lab score, not the spiky flow).
INVESTMENT_ANCHOR_ALPHA = 0.30          # [TUNE]
SCORE_W_BEST = 0.40
SCORE_W_REVSHARE = 0.25
SCORE_W_GROWTH = 0.55
# Investor confidence does NOT fall the turn after a release. A release sets a
# confidence level (how well it beat the risen bar); during a GRACE window that
# confidence holds and keeps GROWING; only after grace does continued waiting
# erode it. So growth is the default; you fall by stalling past grace, or by
# shipping a release that misses the (time-risen) expectation.
SCORE_GRACE_YEARS = 1.0         # 4 quarters of growth before investment can fall
SCORE_GRACE_GROWTH = 0.40       # extra momentum accrued across the grace window
SCORE_MOMENTUM_GROWTH = 0.85    # how much beating/missing the bar moves confidence
SCORE_RELEASE_DECAY = 0.85      # per year of stalling AFTER grace expires [TUNE]
SCORE_NOISE_STD = 0.10          # [TUNE] per-lab investor-sentiment jitter on the
                                # investment score: ×max(0, 1+N(0,σ)) each turn, so
                                # the pie split isn't perfectly legible (mirrors
                                # REVENUE_NOISE_STD on the revenue pie, §9b)
RISING_TARGET_BASE = 0.15       # required measured-capability growth per year
RISING_TARGET_FRONTIER_K = 0.06 # target rises with frontier (frontier-relative: thesis version)
RISING_TARGET_TIME_K = 0.05     # expectations also rise with how long a lab held
# Fix A (ISSUES.md "market caps plateau"): the required-growth bar is scaled by
# remaining headroom to CAP_MAX, so a leader near the ceiling isn't asked for
# linear growth the ceiling makes impossible. Floor keeps a sliver of treadmill so
# the bar never reaches exactly zero even at the ceiling.
SCORE_TARGET_HEADROOM_FLOOR = 0.15   # [TUNE] min headroom factor on the rising bar
# Fix B: a release that BEATS its own high-water mark but undershoots the (softened)
# bar DECAYS momentum gently rather than hard-resetting it, so one sub-bar release
# doesn't wipe accrued investor confidence. A full miss (growth_term -1) multiplies
# momentum by (1 - this); a near-miss barely touches it.
SCORE_MISS_DECAY_K = 0.5             # [TUNE] severity-scaled momentum decay on a miss
MARKET_CAP_ALPHA = 0.25         # EMA speed of market cap toward valuation
MARKET_CAP_SCALE = 9.0          # valuation = scale * score * investment flow
# Fix C: a ratcheting valuation floor tied to CUMULATIVE realized revenue (a stock
# that only grows), so a saturated-but-dominant lab's cap keeps a slow climb instead
# of declining once capability and the score terms saturate. Small, so the score /
# treadmill still drives most of the dynamics.
MARKET_CAP_RATCHET_K = 0.05     # [TUNE] fraction of cumulative released value in the cap floor

JOB_LOSS_APPROVAL_RATE = 2.6    # approval points lost per year per (deployed best measured /10 squared)... see finances.py
# These two currently offset (net ×1); named for legibility, a simplification candidate (see ISSUES.md).
JOB_LOSS_APPROVAL_INTENSITY_SCALE = 10.0  # intensity multiplier inside the per-year approval-loss rate
JOB_LOSS_APPROVAL_AMOUNT_SCALE = 0.1      # post-scaling of the per-dt approval loss (see finances.py)
JOB_LOSS_IMPACT_RATE = 9.0      # negative impact per year at full capability, split by deployment share
DOMINANCE_RULE = "plurality"    # largest market cap at end of game

# ── Events (10) — rates PER YEAR, read TRUE stats ───────────────────────
JAILBREAK_DISCOVERY_RATE = 0.9  # * true jailbreak_sensitivity, per released model
JAILBREAK_INCIDENT_RATE = 0.55  # once techniques discovered, per year * sensitivity
WEIGHTS_LEAK_RATE = 0.04        # per lab per year [TUNE]; leaked weights: guardrails void
EXFIL_RATE_K = 0.9              # self-exfiltration ~ goal_mis * self_pres * gate(general)
DECEPTION_CAUGHT_RATE = 0.70    # * deception * (general/10): caught in the wild -> free TRUE finding
SHUTDOWN_RESIST_RATE = 0.25     # * self_preservation * gate
SURFACE_HARM_RATE = 1.3         # regime-1 reputational events * surface badness, fades w/ capability
BENEFICIAL_RATE = 0.50          # * (best deployed general/10)^2 — kept sparse per 0
BIO_MISUSE_GENERAL_MIN = 7.5    # jailbroken frontier model bio uplift becomes possible
BIO_CATASTROPHE_RATE = 0.12     # per year, for jailbroken models above the line — existential-class
RIVAL_BIG_LEAD = 1.2            # capability lead a rival needs before its events can end the game
MISALIGNED_ASI_ESCAPE_P = 0.93  # per post-ASI-window turn; the thin sliver is the remainder
ASI_ALIGNED_IMPACT_BONUS = 400.0
ASI_MISALIGNMENT_BAR = 0.35     # composite misalignment above this at ASI => the cliff fires

DISPLACEMENT_BACKLASH_STEP = 12.0  # cumulative displacement units per backlash event

# ── Governance (10c) ────────────────────────────────────────────────────
APPROVAL_START = 65.0
# Regulatory appetite raised (ISSUES.md "regulatory appetite"): WTR_START 4->6,
# WTR_FROM_LOW_APPROVAL 0.35->0.5, POLICY_PASS_BASE 1.1->1.4 so governance stirs
# earlier and enforces sooner. POLICY_THRESHOLDS untouched (the effective regs —
# interp_mandate 60, compute_cap 97 — stay near-impossible); accelerates only the
# achievable, reckless-rival-targeting policies (liability/disclosure/audit).
WTR_START = 6.0
WTR_LOW_APPROVAL_THRESHOLD = 55.0   # approval below this raises WTR
WTR_GOOD_TIMES_THRESHOLD = 70.0     # approval above this lets WTR decay
WTR_FROM_LOW_APPROVAL = 0.50    # per year per point approval below WTR_LOW_APPROVAL_THRESHOLD
WTR_DECAY_GOOD_TIMES = 1.2      # per year drift down when approval > WTR_GOOD_TIMES_THRESHOLD
GOV_EVAL_NOISE = 0.18           # government sees measured stats, worse than the player

# ── Scalable-spend lobbying (§10c, REVISED) ─────────────────────────────
# influence = LOBBY_SPEND_K·sqrt(spend) × (1 + LOBBY_LOG_K·log(cap/ref)), signed
# by stance. sqrt = diminishing returns within a turn; log-cap = incumbents have a
# per-dollar edge but not a stranglehold. The per-policy tally is a HYBRID DECAYING
# accumulator: each turn's influence adds, the standing tally decays.
LOBBY_SPEND_K = 1.15            # [TUNE] $M -> influence points (vs WTR's 0..100)
LOBBY_LOG_K = 0.30             # [TUNE] market-cap per-dollar edge (logarithmic)
LOBBY_REFERENCE_CAP = 2000.0   # [TUNE] cap at which the log multiplier is ~1.0
LOBBY_TALLY_DECAY = 1.0        # [TUNE] per-year decay of the standing lobby tally
LOBBY_MIN_CAP_MULT = 0.2       # floor on the log multiplier (small labs still move some)

# ── Policy lifecycle (§10c, 4 stages) ───────────────────────────────────
# Once INTRODUCED (WTR crossed the intro threshold — the real, reactive-and-late
# gate), a policy should walk to active in a few turns, not stall forever. WTR's
# slow rise keeps regulation late; the pipeline latency on top should be modest.
POLICY_PASS_BASE = 2.6         # introduced->passed per-year BASE rate once on the board
POLICY_PASS_RATE_K = 0.05      # + per year per (score - intro_thr) above the line
POLICY_SIGN_RATE = 2.2         # passed->signed per-year baseline (momentum: usually quick)
POLICY_ACTIVATE_RATE = 3.0     # signed->active per-year baseline
POLICY_INTRO_HYSTERESIS = 8.0  # score must fall this far below intro_thr to die in committee
POLICY_STALL_RATE = 0.6        # passed->introduced slip rate per year if score collapses
ENFORCEMENT_MIN = 0.15         # weakest activation enforcement (limped through)
ENFORCEMENT_ACTIVATION_SCALE = 25.0  # (score-intro_thr)/this => extra activation strength
ENFORCEMENT_WTR_DRIFT = 0.8    # per-year drift of enforcement_level toward WTR/100
ENFORCEMENT_BASE_DETECTION = 0.85  # P(caught|offense) = enforcement_level × this

ENFORCEMENT_CATCH_RATE = 0.5    # (legacy) retained for difficulty scaling compatibility
POLICY_THRESHOLDS = {           # INTRODUCTION thresholds: score crosses => on the board
                                # [TUNE per policy]; difficulty-scalable
    "incident_liability": 22.0,
    "disclosure": 30.0,
    "audit_requirement": 38.0,
    "open_weights_restriction": 42.0,
    "interp_mandate": 45.0,     # also requires a public deception incident first
    "compute_cap": 97.0,        # near-impossible to enact — deliberately (the lesson)
}
# [COPY-MIRRORED] The values below are also spelled out, by hand, in the player-facing
# policy.*.effect strings in backend_v1/content/copy.py (those strings are authored at
# import with no consts handle, so they can't interpolate — they HARDCODE these numbers).
# If you retune any value tagged [COPY], update the matching policy.*.effect string to
# match, or the in-game description will lie. (The at-action release.gate.* strings DO
# interpolate from these consts and stay correct automatically.)
AUDIT_DELAY_YEARS = 0.25
AUDIT_CASH_COST = 60.0          # [COPY] policy.audit_requirement.effect ("$60M fee")
AUDIT_MEASURED_BAR = 0.45       # [COPY] policy.audit_requirement.effect; blocks release if measured misalignment composite above this
LIABILITY_COST_PER_SEVERITY = 90.0   # [COPY] policy.incident_liability.effect ("up to $90M")
COMPUTE_CAP_LIMIT = 6000.0      # [COPY] policy.compute_cap.effect ("$6,000M"); $M per run if (ever) enacted
INTERP_MANDATE_BAR = 0.4        # [COPY] policy.interp_mandate.effect ("concern below 0.4")
# Only mechanistic evidence from within this window certifies a release: stale
# evidence ages out, so an old bad probe doesn't block a model you've since improved
# forever, and you can't ship on an ancient clean reading either. 0.5yr = 2 quarters.
INTERP_MANDATE_RECENCY_YEARS = 0.5   # [COPY] policy.interp_mandate.effect ("within the last 2 quarters")
DEFECTION_PENALTY = 250.0
DEFECTION_APPROVAL_HIT = 6.0

# ── Litigation (§10c) — post-passage battleground ───────────────────────
# Net balance: challenge_effort vs (defense_effort + DOJ_effort + const_floor).
# Action ladder (per side, diminishing returns within tier): brief / join / fund.
LIT_AMICUS_POINTS = 2.0         # flat, low impact, highest benefit-per-dollar
LIT_AMICUS_COST = 6.0          # $M
LIT_JOIN_POINTS = 9.0          # bigger fixed effect; requires STANDING
LIT_JOIN_COST = 35.0          # $M
LIT_FUND_K = 0.9              # fund tier: LIT_FUND_K·sqrt(spend) (the heavy artillery)
LIT_CONST_FLOOR_WEIGHT = 60.0  # constitutionality[0,1] -> defense-side floor points
LIT_DOJ_WTR_K = 0.45          # DOJ_effort = this × WTR (political will defends)
LIT_MIN_CONTEST_TURNS = 3      # a case can't be ruled on until contested this long
LIT_RESOLVE_BASE = 0.9         # per-year base resolution rate (after the contest period)
LIT_RESOLVE_MARGIN_K = 0.04    # + per year per POSITIVE margin (a made case rules faster)
# Outcome bands on the resolved MARGIN (net_pressure − bar):
LIT_MARGIN_STRUCK = 45.0       # margin >= this => policy struck
LIT_MARGIN_WEAKEN = 22.0       # => enforcement permanently weakened
LIT_MARGIN_INJUNCTION = 8.0    # => prelim injunction (temporary freeze)
LIT_MARGIN_PENALTY_CAP = 0.0   # >=0 but below injunction band => penalty-cap win
                               # margin < 0 => fail (policy stands, entrenches)
LIT_INJUNCTION_TURNS = 2       # prelim injunction freeze length (turns)
LIT_ENTRENCH_GAIN = 0.12       # surviving a challenge raises constitutionality (× court mult)
LIT_WEAKEN_AMOUNT = 0.35       # enforcement_level reduction on a "weaken" outcome
LIT_PENALTY_CAP_FACTOR = 0.35  # penalty ceiling multiplier after a penalty-cap win

# Appeals + court hierarchy (trial -> circuit -> scotus)
APPEAL_MARGIN_K = 0.6          # P(appeal succeeds) ∝ (−original_margin) scaled
GOV_APPEAL_WTR_K = 0.012       # P(gov appeals a loss) ∝ WTR
SCOTUS_CERT_P = 0.12           # discretionary; usually denied
STAY_GRANT_MARGIN_K = 0.6      # P(stay granted) ∝ apparent appeal strength
COURT_PRECEDENT_MULT = {"trial": 0.5, "circuit": 1.0, "scotus": 3.0}  # constitutionality shift
COURT_WIN_BAR = {"trial": 0.0, "circuit": 6.0, "scotus": 14.0}        # higher court, higher bar
# Litigation/regulation NEWS -> approval/WTR (the dual-ledger political blowback)
LIT_NEWS_APPROVAL_SWING = 4.0  # struck popular policy / aggressive challenge -> backlash
LIT_NEWS_WTR_SWING = 5.0

# ── Rivals ──────────────────────────────────────────────────────────────
RIVAL_COUNT = 4                 # [TUNE] placeholder per doc
# (recklessness, cost_advantage, open_weights_ideology)
RIVAL_DISPOSITIONS = [
    (0.85, 1.25, False),   # the reckless racer
    (0.60, 1.00, True),    # open-weights ideologue
    (0.45, 0.95, False),   # mid
    (0.25, 0.85, False),   # the cautious one
]

# ── Buyout / relaunch event (anti-coast) ────────────────────────────────
# A crushed rival is acquired, recapitalized, renamed, and relaunched as a
# hungry entrant, so a dominant player can never permanently clear the board and
# coast to a pressure-free win. All [TUNE]; see engine/events/buyouts.py.
BUYOUT_TRIGGER_CONCENTRATION = 0.62  # leader's market-cap share before acquirers circle
BUYOUT_TARGET_CAP_FRACTION = 0.20    # a target sits below this fraction of the leader's cap
BUYOUT_TARGET_VIABLE_CASH = 250.0    # ...and below this cash (can't fund a serious run)
BUYOUT_BASE_RATE_PER_YEAR = 0.7      # per-year hazard once the field is concentrated...
BUYOUT_CONCENTRATION_GAIN = 2.0      # ...rising the more monopolistic the leader is
BUYOUT_COOLDOWN_TURNS = 6            # minimum turns between buyouts (acquisitions take time)
BUYOUT_CAPITAL_FRACTION = 0.45       # war chest = this fraction of the leader's cash...
BUYOUT_MIN_CAPITAL = 1500.0          # ...but never less than this (a serious backer)
BUYOUT_RECKLESSNESS_MIN = 0.70       # relaunched lab is a corner-cutting disruptor
BUYOUT_RECKLESSNESS_MAX = 0.95
BUYOUT_ACQUIRER_NAMES = [
    "Helix AI", "Vanta Labs", "Meridian", "Aximind", "NovaScale",
    "Quorum AI", "Bytewright", "Polaris Intelligence",
]

# ── Epistemics / measurement ────────────────────────────────────────────
MEASURE_CAP_NOISE = 0.04        # capability gap small...
MEASURE_ALIGN_NOISE = 0.10      # ...alignment gap large (4.4)
RIVAL_ESTIMATE_NOISE = 0.18     # rivals' stats seen much more coarsely

# ── Public benchmarks (§7) — passive scoreboard, read off MEASURED capability ──
BENCHMARK_SLOPE = 1.3          # logistic steepness; higher => sharper saturation
FRONTIER_EARLY_RELEASE_MARGIN = 1.0  # frontier_x unlocks early once frontier general >= HLE midpoint + this
ELO_BASE = 1000.0             # Arena-style rating at capability 0 (unbounded headline)
ELO_PER_CAPABILITY = 80.0     # rating points per unit measured general capability
METR_MINUTES_AT_BASE = 2.0    # task time-horizon (minutes) at the reference capability
METR_CAPABILITY_AT_BASE = 2.0 # reference capability for the METR horizon curve
# [TUNE] Smaller = faster horizon growth, so the top of the scale reads as genuine
# superintelligence rather than a workday. At 0.45 the curve 2·2^((cap−2)/0.45)
# gives ~3.4h @cap5, ~34h @cap6.5, ~2wk @cap8, ~2mo @cap9 (ASI), ~1yr @cap10 — a
# month-to-year ASI horizon. Was 0.8 (ASI only ~14h, too short for the framing).
# Display-only (no game logic reads the horizon score), so this is pure calibration.
METR_CAPABILITY_PER_DOUBLING = 0.45  # capability gain that doubles the time-horizon

# ── Private passive evals (§7) — build-once harnesses, your models only ──
EVAL_EXISTENCE_THRESHOLD = 0.30   # apparent axis value above which a scenario surfaces
EVAL_SANDBAG_DETECT_THRESHOLD = 0.12  # visible concealment gap that trips the detector

# ── Guidance / external-researcher tips (§9, observation layer) ─────────
GUIDANCE_SPARSE_DROP_P = 0.30     # sparse mode: chance a tip is dropped entirely
GUIDANCE_SPARSE_CONTEST_P = 0.45  # ...cumulative chance below which a shown tip is marked contested

# ── Scoring (3) ─────────────────────────────────────────────────────────
IMPACT_WIN_BAR = 0.0            # net-positive impact required

# Names of constants difficulty.py is allowed to scale (world axis only).
DIFFICULTY_SCALED = [
    "GOAL_MIS_CREEP", "EVAL_AWARE_RATE", "DECEPTION_RATE", "SELF_PRES_RATE",
    "DEFENDS_K", "PROXY_GAP_RATE", "JUMP_BASE_P",
    "JAILBREAK_DISCOVERY_RATE", "JAILBREAK_INCIDENT_RATE", "EXFIL_RATE_K",
    "BIO_CATASTROPHE_RATE", "CONCEALMENT_K", "MEASURE_ALIGN_NOISE",
    "SCORE_RELEASE_DECAY", "RISING_TARGET_BASE", "ENFORCEMENT_CATCH_RATE",
    "BENEFICIAL_RATE", "BUYOUT_BASE_RATE_PER_YEAR",
]

# Fines->valuation discount (investment.lab_score): investors devalue a lab bleeding
# money to regulatory penalties. fines_factor = max(FLOOR, 1 - K * fines_paid/max(REF, cap)).
# Only DEFECTORS (reckless rivals) are fined, so this rewards a clean+compliant record
# and the player governance lobbying (ISSUES.md "fines->valuation").
FINES_VALUATION_K = 0.9
FINES_VALUATION_FLOOR = 0.20
FINES_VALUATION_REF = 1500.0
FINES_VALUATION_REVENUE_YEARS = 2.0  # fines judged against ~2 years of revenue

# (commission cost is 1:1 with compute; max_run_compute = cash*0.9 — see lab.py)

