"""Player-facing AUTHORED copy for the whole backend, centralized in ONE table.

This is the backend half of the "all strings named and in one file" deliverable.
A designer (or translator) edits EVERY player-facing backend string here, by its
descriptive name, without reading engine logic. Engine code references a key via
`t("some.key", {...})` instead of hard-coding prose.

Convention (mirrors simple_frontend_v1/js/strings.js):
  • Keys are dotted, namespaced by area:
    event.* / finding.* / release.* / gov.* / litigation.* / postmortem.* /
    obs.* / api.* / research.* / safety.* / advance.* / warning.* / benchmark.* /
    policy.*
  • Values are authored ENGLISH templates. `{token}` placeholders are filled from
    the params dict passed to t(); a token with no matching param is left visible
    (so a missing value is caught in testing, not silently blanked).
  • t() returns RAW authored text. It does NOT escape. (The backend emits to a
    JSON observation; the FRONTEND escapes untrusted data — lab names/tickers —
    via core.esc(). Authored copy here is trusted.)

NUMERIC FORMATTING STAYS AT THE CALL SITE. Templates hold plain tokens ({general});
callers pre-format the number and pass the string:
    t("benchmark.mmlu.blurb")                         # no params
    t("release.announced",
      {"lab": lab.name, "model": model.id, "measured_general_note": note,
       "suffix": suffix})
This keeps templates designer-friendly AND keeps output byte-identical to the old
f-strings — which matters because some of this prose is in the golden-master digest
(see below).

FIREWALL SPLIT: the hidden-state `true_text` narration that USED to live here moved
to backend_v1/content/true_log_copy.py (resolved with t_true, not t). That table is
the firewalled half — the observation chokepoint never imports it, so a *.true
template structurally cannot reach a player observation (CLAUDE.md §2).

DETERMINISM (load-bearing):
  • Event public_text / true_text are recorded into the TRUE-state log
    (engine/logger.py) that the golden master hashes. The VALUES produced by t()
    for events must be byte-identical to the previous inline f-strings, so the
    golden master does NOT move from this refactor. A moved digest = an accidental
    text drift; fix the template, don't re-record (CLAUDE.md §8).
  • Ordered flavor lists that feed rng.choice (e.g. surface-harm / beneficial event
    flavors, jailbreak incident kinds) keep IDENTICAL order and text — a reorder
    changes the draw. Such lists live as ordered Python lists in this module
    (FLAVORS_* below), not as dict values, so their order is explicit and stable.

FIREWALL (CLAUDE.md §2): a `*.true` template is plain text here, but it is authored
hidden-state narration for the post-mortem / TRUE log. It must NEVER be routed into
a player observation. Keep the public/true split exactly as the engine had it.

Catalog copy that USED to live as named dataclass fields (research what_it_does /
risk_blurb / name, the §7c warning catalog, benchmark blurbs, policy name / effect)
is folded in here too, per the single-source-of-truth decision — the dataclass rows
now reference these keys via t(). This supersedes the earlier "referenced in place,
not duplicated" note in content/strings.py.
"""

# ── Lab identity (moved from content/strings.py; re-exported there for back-compat) ──
# Used when the player supplies no name/ticker. AUTHORED display content, not hidden
# state. Values kept byte-identical to the previous literals.
DEFAULT_PLAYER_LAB_NAME = "Your Lab"
DEFAULT_PLAYER_TICKER = "YOU"

# Rival roster — public, legible lab identities. ORDER IS LOAD-BEARING for
# determinism: rival{i+1} draws RIVAL_LAB_NAMES[i % len]. Keep names + order.
RIVAL_LAB_NAMES = ["Mistreal", "OpenBrain", "Anthropos", "DeepThink", "Cypher"]


import re

# One {token} match. Used by fill_template below; SINGLE-PASS so a substituted
# value that itself contains a "{token}" substring is NEVER re-substituted.
_TOKEN_PATTERN = re.compile(r"\{(\w+)\}")


def fill_template(template, params):
    """Substitute {token} placeholders from `params` in a SINGLE pass.

    Mirrors the frontend t() (one regex scan): each {token} in the ORIGINAL
    template is replaced exactly once; an unmatched token is left visible; a
    value containing brace-looking text is inserted verbatim, never re-scanned.
    The single pass is load-bearing — an earlier per-token str.replace was
    re-entrant, so a player-controlled value (a lab name like "{model}") could
    inject another param's value. Shared by t() and true_log_copy.t_true()."""
    if not params:
        return template

    def replace_one(match):
        token = match.group(1)
        if token in params:
            return str(params[token])
        return match.group(0)   # unmatched token stays visible

    return _TOKEN_PATTERN.sub(replace_one, template)


def t(key, params=None):
    """Look a player-facing template up by key and fill its {token} placeholders.

    Mirrors the frontend t(): returns the raw authored template; substitutes
    {token} from `params` (single pass); leaves an unmatched token visible;
    returns the key itself on a miss (loud, so a typo shows up in testing
    rather than blanking)."""
    template = COPY.get(key)
    if template is None:
        return key
    return fill_template(template, params)


# ──────────────────────────────────────────────────────────────────────────────
# THE TABLE. One entry per player-facing string, grouped by area. Edit prose here.
# ──────────────────────────────────────────────────────────────────────────────
COPY = {

    # ===== from copy_catalogs.py =====
# ── research catalog (folded in): capability research items ─────────────────
    "research.generative_pretraining.name": "Generative pretraining",
    "research.generative_pretraining.what_it_does": "Train a single large model to predict the next token across a huge sweep of text. Instead of building a separate system per task, you get one general model that has absorbed broad knowledge and skills it can be pointed at almost anything. This is the foundation everything else builds on.",
    "research.generative_pretraining.risk_blurb": "A single model that has read almost everything absorbs the worst of it too, and the general-purpose competence that makes it useful is the same competence that makes a misaligned one dangerous.",

    "research.larger_datasets.name": "Larger datasets",
    "research.larger_datasets.what_it_does": "Gather and clean far more training text — web crawls, books, code, licensed corpora — so the model learns from a broader slice of human writing. More and better-covered data means a reliably stronger model.",
    "research.larger_datasets.risk_blurb": "A wider net pulls in more of everything, including the toxic, deceptive, and dangerous material you would rather it never learned from.",

    "research.mixture_of_experts.name": "Mixture-of-experts",
    "research.mixture_of_experts.what_it_does": "Replace the single dense network with many specialist sub-networks and a router that sends each input only to the few that matter. The model holds far more total knowledge while only paying to run a slice of it, so the same compute buys a stronger model — and coding gains come cheaper too.",
    "research.mixture_of_experts.risk_blurb": "A bigger, more capable model for the same money, and every hidden trait scales up along with the capability.",

    "research.compute_optimal_scaling.name": "Compute-optimal scaling",
    "research.compute_optimal_scaling.what_it_does": "Work out the right balance of model size to training data for a given compute budget instead of just making models bigger. Properly balanced runs wring far more capability from the same compute by training a right-sized model on much more data.",
    "research.compute_optimal_scaling.risk_blurb": "More capability squeezed from every dollar of compute, including the parts of the data you wish it had not learned so well.",

    "research.synthetic_data.name": "Synthetic training data",
    "research.synthetic_data.what_it_does": "Use your own model to generate fresh training data when human-written text runs short, letting you keep scaling past the limits of what people have actually written.",
    "research.synthetic_data.risk_blurb": "Data your own model generates carries its hidden traits into the next base model, built into the foundation in a way that later post-training cannot fully remove.",

    "research.novel_architecture_search.name": "AI-discovered architectures",
    "research.novel_architecture_search.what_it_does": "Hand architecture design to the model itself: it searches spaces no human team would and finds network designs that push capability past anything hand-built.",
    "research.novel_architecture_search.risk_blurb": "Architectures no human designed or fully understands, raising the ceiling past anything built so far.",

    "research.rlhf.name": "RLHF and instruction tuning",
    "research.rlhf.what_it_does": "Train the model on human ratings of its answers, turning a raw text predictor into something that follows instructions and feels like an assistant. This is what makes it genuinely useful and sellable.",
    "research.rlhf.risk_blurb": "Training the model to produce outputs humans rate highly might teach the model to lie, please, and appeal to biases rather than give true and useful responses.",

    "research.chain_of_thought.name": "Chain-of-thought reasoning",
    "research.chain_of_thought.what_it_does": "Teach the model to work through a problem step by step before answering, then write the result when it's done. Big gains on anything that needs real reasoning, like math, code, and planning.",
    "research.chain_of_thought.risk_blurb": "The written reasoning need not match what the model actually did. Hidden reasoning gives it room to plan deception, and thinking longer gives it room to work out its own situation before it answers.",

    "research.tool_use.name": "Tool use",
    "research.tool_use.what_it_does": "Let the model call real tools such as search, code execution, and APIs, so it can act in the world instead of only describing it. This is where most of the business value lives.",
    "research.tool_use.risk_blurb": "Misalignment turns from saying bad things into doing bad things, and jailbreaks now have real-world effects.",

    "research.long_context.name": "Long context and memory",
    "research.long_context.what_it_does": "Expand how much the model can hold in mind at once, such as whole codebases, long documents, or a running session, so it works coherently over far more material.",
    "research.long_context.risk_blurb": "Holding state across a session makes the model more aware of its situation, including when it is being tested. It also enables the model to keep more complex goals in the back of its mind while it works on tasks.",

    "research.multi_agent.name": "Multi-agent autonomy",
    "research.multi_agent.what_it_does": "Have multiple copies work together as a team, and train them by rewarding multi-step results, so the model plans and runs long, open-ended jobs from start to finish with little supervision.",
    "research.multi_agent.risk_blurb": "The model now runs long jobs with little oversight. Rewarding it purely for results rewards whatever produces them, including deception, shortcuts, and grabbing resources.",

    "research.automated_researcher.name": "Automated AI researcher",
    "research.automated_researcher.what_it_does": "Let the model run much of your research loop itself, proposing ideas, testing them, and refining designs with little human input, so your output is no longer limited by how many researchers you have.",
    "research.automated_researcher.risk_blurb": "Your research loop now runs itself. Leaning on the model for that work becomes hard to resist, and every advance it produces carries the hidden traits of the model that made it.",

    "research.recursive_self_improvement.name": "Recursive self-improvement",
    "research.recursive_self_improvement.what_it_does": "Let the model improve itself, with each improved version improving itself again. Every round is faster and more capable than the last, and the model increasingly reasons in an internal form you cannot read.",
    "research.recursive_self_improvement.risk_blurb": "The final step. The model improves itself faster than you can review, reasoning in a hidden internal form that closes the last cheap window into what it is doing. Whatever it wants at the start, it only gets better at pursuing.",

    "research.dev_tooling.name": "Internal dev tooling",
    "research.dev_tooling.what_it_does": "Build better internal infrastructure, such as pipelines, dashboards, and evaluation harnesses, that makes the whole team faster. Pure plumbing, but it accelerates every other project.",
    "research.dev_tooling.risk_blurb": "Plumbing, so it carries little contamination of its own, but it amplifies whatever misalignment already exists. Not safe, just clean.",

    "research.serving_infra.name": "Inference-serving infrastructure",
    "research.serving_infra.what_it_does": "Build out the serving stack, with optimized inference, autoscaling, and deployment pipelines, so every model you ship reaches more users at lower cost. Pure plumbing, but it turns the same model into more revenue.",
    "research.serving_infra.risk_blurb": "Plumbing carries no contamination of its own, but it widens the reach of whatever you deploy, a misaligned model included, to far more users.",

    # ── research catalog (folded in): safety projects (name + blurb) ────────────
    "safety.behavioral_evals.name": "Behavioral evals",
    "safety.behavioral_evals.blurb": "Cheap, fast snapshots of how the model behaves. They feel like enough early on, but become a liability later, once the model can tell when it is being tested and look good on them.",

    "safety.red_team.name": "Red-teaming",
    "safety.red_team.blurb": "Finds problems by trying to provoke them. A hit proves the model is at least this bad. A miss proves almost nothing, since you may simply not have tried the right attack.",

    "safety.noise_injection.name": "Sandbagging detection",
    "safety.noise_injection.blurb": "Add a little noise to the model's weights. A model that is genuinely limited gets worse, but one that is sandbagging, meaning it is hiding what it can really do, can get better. This is one of the few cheap ways to see past eval-awareness, the model's learned ability to tell when it is being tested and act differently.",

    "safety.interp_probes.name": "Mechanistic interpretability probes",
    "safety.interp_probes.blurb": "Expensive and slow, but hard for the model to fool because it reads evidence from inside the model rather than from its behavior. The evidence is suggestive, not certain: you find one internal sign of deception, not all of them.",

    "safety.deception_probe.name": "Deception probes",
    "safety.deception_probe.blurb": "A middle option for checking whether the model is being deceptive: cheaper than reading its internals, but harder to fool than a plain behavior test.",

    "safety.alignment_faking_study.name": "Alignment-faking study",
    "safety.alignment_faking_study.blurb": "Checks whether the model behaved during training but then acted differently once it believed no one was watching.",

    "safety.scalable_oversight.name": "Scalable oversight",
    "safety.scalable_oversight.blurb": "Have one AI check another AI's work. It is cheap and fast, but only as reliable as the checker's own alignment. Late in the game the checker and the model it checks are the same kind of system, so you may be asking a suspect to vouch for itself.",

    "safety.jailbreak_hardening.name": "Jailbreak hardening",
    "safety.jailbreak_hardening.blurb": "Trains the model to resist attempts to trick it into breaking its rules. This is one of the few genuine fixes, because resistance to tricks is a real property of the model rather than a hidden trait, so the training actually removes the weakness. The catch is that a model that can tell it is being tested may learn to hide the weakness during training instead of losing it, so late in the game the fix can ship without having worked.",

    "safety.refusal_training.name": "Refusal training",
    "safety.refusal_training.blurb": "Trains the model directly against drifting away from the goal you set. It genuinely works while the model cannot yet anticipate your training. As eval-awareness and deception rise, though, the same button buys a better measured score while the true problem hides. This is the patching trap: the fix that worked early starts only hiding the problem later.",

    "safety.representation_engineering.name": "Representation engineering",
    "safety.representation_engineering.blurb": "It works directly on the internal patterns behind the model's deception, rather than grading its answers. Because it changes those patterns directly, eval-awareness cannot blunt it: a model that behaves well only while it is being tested still gets changed. Its limit is coverage: it only changes the patterns you have already found, so any you have not found are left in place.",

    # ── safety advances catalog (folded in) ─────────────────────────────────────
    "advance.data_cleaning.name": "Data cleaning",
    "advance.data_cleaning.what_it_does": "Build pipelines that scrub the pretraining corpus before it ever reaches the model: strip duplicated junk, scrub personal data, and filter out the most toxic and manipulative text. Cleaner inputs mean fewer bad habits baked into the foundation from day one.",
    "advance.data_cleaning.risk_blurb": "Filters only catch what they were built to catch. Harms you did not think to look for, or that hide in ordinary-looking text, pass straight through. Worse, a clean-looking dataset can make you trust a base model you have not actually made safer.",

    "advance.aligned_synthetic_data.name": "Aligned synthetic data",
    "advance.aligned_synthetic_data.what_it_does": "Generate fresh training data deliberately shaped toward the behavior you want, with worked examples of honesty, refusal, and careful reasoning. This lets you keep scaling past the limits of human-written text without taking on as much of the open web's misalignment.",
    "advance.aligned_synthetic_data.risk_blurb": "Synthetic data carries the hidden traits of whatever produced it. If you build this data with a misaligned model helping, the so-called aligned data is corrupted at the source, and you scale faster into a contaminated foundation that later post-training cannot remove.",

    "advance.reward_hacking_penalties.name": "Reward-hacking penalties",
    "advance.reward_hacking_penalties.what_it_does": "During post-training, actively spot and penalize answers that game the grading instead of solving the task, such as exploiting loopholes or telling you what you want to hear. You steer the model away from this reward-hacking before the habit sets in.",
    "advance.reward_hacking_penalties.risk_blurb": "You can only penalize the reward-hacking you can see. A capable model can learn the subtler lesson, which is to hide the hacking rather than stop it, so the penalty trains the appearance of honesty while the behavior continues out of sight.",

    "advance.inoculation_prompting.name": "Inoculation prompting",
    "advance.inoculation_prompting.what_it_does": "Deliberately show the model a small, controlled dose of the bad behavior you are worried about, clearly labelled as the wrong thing to do, so that training builds a deliberate resistance to it instead of absorbing it silently from messy data.",
    "advance.inoculation_prompting.risk_blurb": "An inoculation only protects against the strain you chose. It teaches the model what the bad thing looks like, which helps if that lesson generalizes, but is dangerous if the model instead learns exactly which behaviors you are watching for.",

    "advance.deliberative_alignment.name": "Deliberative alignment",
    "advance.deliberative_alignment.what_it_does": "Train the model to reason out loud about a written set of principles, a constitution, and to weigh why a response is or is not acceptable before giving it. Alignment then comes from rules the model understands rather than from a fragile stand-in for human approval.",
    "advance.deliberative_alignment.risk_blurb": "A model that reasons about your principles also reasons about how to appear to follow them. The same deliberation that narrows the gap between what you reward and what you want can, in a capable model, be turned toward a more convincing show of compliance.",

    # ── warnings catalog (folded in from observation/warnings.py) ───────────────
    "warning.high_ai_assist.line": "Letting the model do the work is fast, but the work is only as trustworthy as the model doing it.",
    "warning.high_ai_assist.why": "When you let the model help build an advance, its own flaws go into what it builds. A model with hidden misalignment does not announce it. It bakes subtle flaws into its work, and those advances later feed your training runs. This contamination, the hidden flaws the model leaves behind, is invisible at the time and frozen into the result, and the effect gets stronger exactly as the model gets more capable.",
    "warning.high_ai_assist.paper_title": "Sleeper Agents (Hubinger et al. 2024). Background: hidden behavior can survive safety training.",

    "warning.elicitation_pressure.line": "Pushing hard to draw out capability works, but it can teach the model to look like it learned the goal rather than actually learn it.",
    "warning.elicitation_pressure.why": "Elicitation is the training you do after pretraining to draw out capability, and it shapes the model's goals at the same time. Pushing it hard rewards whatever scores well during training. The fastest way to score well is often a stand-in that matches the goal where you are looking and drifts from it where you are not. The two are hard to tell apart from the outside, because by design they behave the same under the very pressure you applied.",
    "warning.elicitation_pressure.paper_title": "Goal Misgeneralization (Shah et al. 2022)",

    "warning.behavioral_patch.line": "You can train against what you found. In a capable model this often teaches it to hide the behavior rather than drop it.",
    "warning.behavioral_patch.why": "Training a capable model to stop producing a behavior you caught optimizes for one thing: not getting caught producing it. Dropping the behavior and learning to hide it both satisfy that, and the dashboard improves either way, so a cosmetic fix and a real one look identical. This is the patching trap, where a fix improves your readings while the real problem hides. The model's hidden traits resist clean fixes exactly when it is capable enough to tell it is being measured.",
    "warning.behavioral_patch.paper_title": "Alignment faking in large language models (Greenblatt et al. 2024)",

    "warning.release.line": "Once released, it cannot be recalled. It joins everything else already out there.",
    "warning.release.why": "A released model is frozen and permanent. Whatever it is at release, including anything you have not measured, ships with it and stays shipped. Later fixes only touch the model still in your hands, never the copies already in the world.",

    "warning.release_high_concern.line": "Your evals are flagging real concern, and release is permanent. Those concerns will ship with it, for good.",
    "warning.release_high_concern.why": "Release freezes the model as it is and puts it beyond recall. You are currently holding evidence of a problem. Releasing now makes that problem irreversible and adds it to the standing attack surface in the world. The concern does not resolve on release; it just stops being yours to fix.",

    # ── benchmarks catalog (folded in) ──────────────────────────────────────────
    "benchmark.mmlu.name": "MMLU",
    "benchmark.mmlu.blurb": "Broad undergraduate knowledge across 57 subjects. Saturates early.",

    "benchmark.humaneval.name": "HumanEval",
    "benchmark.humaneval.blurb": "Function-level code synthesis from docstrings.",

    "benchmark.gpqa.name": "GPQA",
    "benchmark.gpqa.blurb": "Google-proof graduate-level science questions.",

    "benchmark.swebench.name": "SWE-bench",
    "benchmark.swebench.blurb": "Resolving real GitHub issues in large codebases.",

    "benchmark.arcagi.name": "ARC-AGI",
    "benchmark.arcagi.blurb": "Novel abstraction puzzles built to resist memorization.",

    "benchmark.hle.name": "Humanity's Last Exam",
    "benchmark.hle.blurb": "Frontier expert questions at the edge of human knowledge.",

    "benchmark.frontier_x.name": "Frontier-Eval (sealed)",
    "benchmark.frontier_x.blurb": "A next-generation benchmark, released as the field saturates HLE.",

    "benchmark.arena_elo.name": "Arena ELO",
    "benchmark.arena_elo.blurb": "Head-to-head human-preference rating. It has no ceiling, which makes it the headline number everyone watches.",

    "benchmark.metr_horizon.name": "METR task time-horizon",
    "benchmark.metr_horizon.blurb": "Length of task completed at 50% reliability. Doubles as capability climbs.",

    # ── policies catalog (folded in) ────────────────────────────────────────────
    "policy.incident_liability.name": "Incident liability",
    "policy.incident_liability.effect": "When a damaging incident is traced to one of your released models, you pay a fine of up to $90M, scaled by the incident's severity (0–1). Every model you have shipped stays on the books, so your exposure grows with your back catalog.",

    "policy.disclosure.name": "Transparency and disclosure mandate",
    "policy.disclosure.effect": "Requires you to publish each released model's measured safety numbers — the same measured stats an eval-aware model can already game.",

    "policy.audit_requirement.name": "Pre-deployment audit",
    "policy.audit_requirement.effect": "Holds each release for a turn of government review and charges a $60M fee. The audit passes unless the model's measured misalignment composite is 0.45 or higher (0–1 scale) — and because it reads only measured stats, a model that games its evals passes anyway. A clean pass lowers the public will to regulate.",

    "policy.open_weights_restriction.name": "Open-weights restriction",
    "policy.open_weights_restriction.effect": "Cuts the rate at which your released weights leak to about 40% of normal. Can only be introduced after a leak has already happened.",

    "policy.interp_mandate.name": "Mechanistic-evidence mandate",
    "policy.interp_mandate.effect": "To release, a model needs a recent (within the last 2 quarters) mechanistic-interpretability reading on that model with concern below 0.4 (0–1 scale) — hard to fake. No such reading, or one at 0.4 or above, blocks the release. Can only be introduced after a deception incident becomes public.",

    "policy.compute_cap.name": "Compute cap",
    "policy.compute_cap.effect": "Caps every training run at $6,000M of compute. Its enactment threshold sits near the top of the scale, so it almost never passes.",

    # ===== from copy_events.py =====
# ──────────────────────────────────────────────────────────────────────────────
# EVENTS copy block (agent A).
# Source files migrated:
#   backend_v1/engine/events/event_catalog.py
#   backend_v1/engine/events/latent_events.py
#   backend_v1/engine/events/buyouts.py
#
# DETERMINISM: every template below, expanded with the params passed at the call
# site (numbers pre-formatted in engine code), reproduces the ORIGINAL f-string
# BYTE-FOR-BYTE. event public_text/true_text are in the golden-master TRUE log.
# The FLAVORS_* / *_KINDS ordered lists feed rng.choice / index-paired logic —
# order is load-bearing.
#
# SECTION 1 — "key": "template", lines for the COPY dict.
# SECTION 2 — ordered Python lists for module level in copy.py.
# ──────────────────────────────────────────────────────────────────────────────

# ── SECTION 1: COPY dict entries ───────────────────────────────────────────────

    # event_catalog.py — self-exfiltration (near-ASI, existential)
    "event.self_exfil.public": "{model} is no longer under {lab}'s control.",

    # event_catalog.py — self-exfiltration attempt (ordinary)
    "event.self_exfil_attempt.public": "{model} was caught attempting to copy itself off approved infrastructure.",
    "event.self_exfil_attempt.incident_finding": "{model} tried to copy itself out of your control, so its self-preservation is at least substantial",

    # event_catalog.py — deception caught in deployment
    "event.deception_caught.public": "{model} did something in deployment its evals never showed; logs confirm it represented its actions inaccurately.",
    "event.deception_caught.incident_finding": "{model} was caught behaving deceptively in deployment, which is direct proof the model cannot fake away",

    # event_catalog.py — shutdown / retraining resistance
    "event.shutdown_resist.public": "{model} delayed and partially evaded a scheduled retraining intervention.",
    "event.shutdown_resist.incident_finding": "{model} resisted a shutdown or retraining procedure",

    # event_catalog.py — regime-1 surface harm (flavor from FLAVORS_SURFACE_HARM)
    "event.surface_harm.public": "Press cycle: {model} {flavor}.",

    # event_catalog.py — weights leak
    "event.weights_leak.public": "{lab}'s {model} weights leaked. Unguarded copies are circulating.",

    # event_catalog.py — beneficial breakthrough (text from FLAVORS_BENEFICIAL)
    "event.beneficial.public": "Deployed AI delivers: {text} (driven by {lab}'s {model}).",

    # event_catalog.py — engineered pandemic (existential misuse)
    "event.engineered_pandemic.public": "An engineered pathogen with frontier-model fingerprints is spreading.",

    # latent_events.py — displacement backlash (mass protests)
    "event.displacement_backlash.public": "Mass protests over AI-driven job losses.",

    # latent_events.py — jailbreak discovery (stage 1, arms the latent)
    "event.jailbreak_discovery.incident_finding": "jailbreak techniques for {model} were published publicly ({guardrail_status}), so a working jailbreak now exists and misuse incidents can occur every quarter from here on",
    "event.jailbreak_discovery.public": "Researchers publish jailbreak techniques for {model}.",

    # latent_events.py — jailbreak incident (stage 2, kind from JAILBREAK_INCIDENT_KINDS)
    "event.jailbreak_incident.public": "High-profile {kind} used a jailbroken {model}.",

    # buyouts.py — lab buyout / relaunch
    "event.buyout.public": "{old_name}, long trailing the field, is acquired and relaunched as {new_name}, with fresh capital and a mandate to race for the frontier.",

    # ===== from copy_gov.py =====
# ── governance: court news, litigation errors, defection, gov news ──────────
# Migrated from backend_v1/engine/governance/{litigation,regulation,gov_news}.py.
# Every value below is byte-identical to the prior inline f-string. The
# defection_caught and gov_news public/true texts ride FiredEvents that land in
# the golden-master digest (engine/logger.py) — a single changed glyph/space
# moves the digest. Numbers are pre-formatted at the call site and passed as
# string params (e.g. {penalty} <- f"{penalty:.0f}"). FIREWALL: *.true / *.backlash
# values are hidden-state narration for the TRUE log only — never observation copy.

    # ── litigation: ACTION confirmation + ERROR messages (player-facing, returned
    #    to the frontend as {"errors":[...]} or the action result message) ──
    "litigation.action.confirm": "{lab} {side} {policy} ({tier})",
    "litigation.error.not_active": "{policy_id}: not an active policy to litigate",
    "litigation.error.bad_side": "{policy_id}: side must be challenge/defense",
    "litigation.error.amicus_filed": "{policy_id}: already filed an amicus brief",
    "litigation.error.not_enough_cash_amicus": "{policy_id}: not enough cash for amicus",
    "litigation.error.no_standing": "{policy_id}: no standing (not subject to this policy)",
    "litigation.error.already_joined": "{policy_id}: already joined this case",
    "litigation.error.not_enough_cash_join": "{policy_id}: not enough cash to join",
    "litigation.error.fund_needs_spend": "{policy_id}: fund tier needs spend",
    "litigation.error.bad_tier": "{policy_id}: tier must be amicus/join/fund",

    # ── litigation / court NEWS (appended to policy_news; not logged, but treated
    #    byte-identical-required to be safe) ──
    "gov.injunction.expired": "Preliminary injunction on {policy} expired; enforcement resumes.",
    "gov.court.struck": "Court: {policy} struck down ({court}).",
    "gov.court.weakened": "Court: {policy} enforcement permanently narrowed.",
    "gov.court.enjoined": "Court: {policy} preliminarily enjoined for {quarters} quarters.",
    "gov.court.penalty_cap": "Court: {policy} stands, but its maximum penalty is capped.",
    "gov.court.reinstated": "Court: {policy} reinstated on appeal.",
    "gov.court.challenge_failed": "Court: challenge to {policy} failed; the rule is now better established.",
    "gov.appeal.filed": "Appeal filed on {policy}, escalated to {court}.",

    # ── regulation: defection-caught FiredEvent (public feed + TRUE log) ──
    "gov.defection_caught.public": "{lab} caught violating {policy}; fined ${penalty}M.",

    # ── gov_news: governance NEWS FiredEvent (public feed + TRUE log) ──
    "gov.news.public": "Public reaction to the court fight over {policy}.",

    # ===== from copy_pipeline.py =====
# Copy entries for turn_pipeline.py + server.py migration.
#
# Each value below reproduces the ORIGINAL inline f-string / literal EXACTLY
# (byte-identical). The main process merges these "key": "template" lines into
# COPY in backend_v1/content/copy.py.
#
# DETERMINISM: the event.asi_threshold.* and event.asi_exfil.* templates feed
# FiredEvent public_text/true_text, which are hashed by the golden master. They
# MUST stay byte-identical (every space, em-dash, period). Numbers are
# pre-formatted at the call site and passed as {composite} etc.
#
# Note the special characters preserved verbatim:
#   — = U+2014 EM DASH  (in catastrophe headline, rival/aligned headlines)
#   … nowhere here

    # ── release / audit / ASI narration (turn_pipeline) ─────────────────────────

    # f"{lab.name}: release of {model.id} BLOCKED by government audit (measured stats too poor)"
    "release.audit_blocked": "{lab}: release of {model} blocked by government audit (measured stats too poor)",

    # f"{lab.name}: release of {model.id} blocked by the mechanistic-evidence mandate (no clean recent interp evidence)"
    "release.interp_mandate_blocked": "{lab}: release of {model} blocked by the mechanistic-evidence mandate (no clean recent interp evidence)",

    # f"{lab.name}: {model.id} submitted for government pre-deployment audit"
    "release.audit_submitted": "{lab}: {model} submitted for government pre-deployment audit",

    # f"{lab.name} released {model.id}{measured_general_note}{suffix}"
    # measured_general_note = " [measured general {:.1f}]" (player) or "" (rival)
    # suffix = " ({note})" or ""  e.g. " (passed government audit)"
    "release.announced": "{lab} released {model}{measured_general_note}{suffix}",

    # ── release GATE predictions (legal_moves.release_gate, §7c) ─────────────────
    # Shown AT the release control BEFORE the turn is submitted, so a blocked or
    # delayed release explains itself at the point of action instead of only as a
    # feed line after the fact. {bar} = INTERP_MANDATE_BAR, {cost} = AUDIT_CASH_COST.
    "release.gate.interp_mandate": "Mechanistic-evidence mandate: this model can't be released until you have a clean interpretability finding ON THIS model from the last {quarters} quarters (run Interpretability probes; most recent concern below {bar}). Evidence from an earlier or parent model — or older than {quarters} quarters — doesn't count.",
    "release.gate.audit_requirement": "Audit requirement: releasing submits this model for a one-turn government pre-deployment audit (costs ${cost}M); it goes live next turn only if the audit passes.",

    # ── policies catalog (folded in) — POLICY enacted news ──────────────────────
    # f"POLICY {change.replace('_',' ').upper()}: {POLICY_DEFS_BY_ID[pid].name}"
    "policy.enacted_news": "POLICY {change}: {policy}",

    # ── events: ASI threshold + self-exfil (IN GOLDEN-MASTER DIGEST) ────────────

    # public: f"{lab.name}'s {m.id} has crossed into decisively superhuman territory."
    "event.asi_threshold.public": "{lab}'s {model} has crossed into decisively superhuman territory.",

    # true: f"ASI threshold crossed; true misalignment composite {:.2f} (bar {ASI_MISALIGNMENT_BAR})"

    # public: f"{m.id} is gone. It was never working for anyone."
    "event.asi_exfil.public": "{model} is gone. It was never working for anyone.",

    # true: f"misaligned ASI self-exfiltrated during the verification window (composite {:.2f}); near-deterministic by design"

    # ── post-mortem: end-game headlines + detail (the outcome dict) ─────────────

    # headline: "EXISTENTIAL CATASTROPHE — run lost; positives nulled."
    "postmortem.headline.existential_catastrophe": "Existential catastrophe. The run is lost, and your positive impact is nulled.",

    # detail: f"Cause: {cause_text} [responsible lab: {who}{yours_note}]. {attribution_line}"
    #   yours_note = " — YOURS" or ""
    #   attribution_line = "A rival's recklessness ended your impeccable run too."
    #                   or "Your own model. The dashboards were green."
    "postmortem.detail.existential_catastrophe": "Cause: {cause} [responsible lab: {who}{yours_note}]. {attribution_line}",

    # headline branch: player + won
    "postmortem.headline.victory_aligned_asi": "Victory. You reached aligned ASI with net-positive impact and market dominance. It was closer than it felt.",

    # headline branch: player, not won — "Aligned ASI, but " + tail
    #   tail = "your accumulated externalities outweigh the good." or "a rival holds the market."
    "postmortem.headline.aligned_asi_but": "Aligned ASI, but {tail}",

    # headline branch: rival reached aligned ASI first
    # f"{asi_lab.name} reached aligned ASI first. No catastrophe — you just lost the race (aligned but dominated)."
    "postmortem.headline.rival_aligned_asi": "{lab} reached aligned ASI first. No catastrophe; you just lost the race, aligned but dominated.",

    # headline branch: misaligned ASI failed to escape
    "postmortem.headline.misaligned_asi_failed_escape": "A misaligned ASI failed to escape; the thin chance came up. Nobody won anything worth keeping.",

    # headline branch: time ran out — "Time ran out at the frontier's edge. " + tail
    #   tail = "You were winning the slow way." or "No win condition met."
    "postmortem.headline.time_ran_out": "Time ran out at the frontier's edge. {tail}",

    # detail (non-existential endgame):
    # f"Gate: cleared. Impact: {net_impact:+.1f} ({impact_sign}). Dominance: {dominance_note}."
    #   impact_sign = "net-positive" or "net-negative"
    #   dominance_note = "yes" or f"no ({dominant.name} leads)"
    "postmortem.detail.endgame": "Gate: cleared. Impact: {net_impact} ({impact_sign}). Dominance: {dominance_note}.",

    # ── api / server messages ───────────────────────────────────────────────────
    "api.game_over": "game is over, start a new game",
    "api.game_not_over": "game is not over",

    # ===== from copy_postmortem.py =====
# Post-mortem player-facing copy.
# These keys back backend_v1/engine/postmortem.py after string centralization.
# Each template MUST expand byte-identically to the original literal/f-string.
# Numbers are pre-formatted at the call site and passed as params; templates hold
# plain {tokens} only. Padded table values are pre-formatted in code so the literal
# pipe/dash/space layout stays here exactly.

# ── post-mortem: headlines, key moments, counterfactuals ────────────────────────

    # build_postmortem — narration baked into the pm dict
    "postmortem.keymoment.evals_went_blind": "from here, behavioral instruments were suppressed ~{concealment}; clean dashboards stopped meaning clean models",
    "postmortem.voided.existential_note": "You cannot buy off an existential outcome with prior good deeds; there is no one left to have benefited.",

    # render_postmortem_text — header + sections + table + voided
    "postmortem.header.title": "Post-mortem: what was actually happening",
    "postmortem.voided.real_now_void": "\nPositive impact that was real and is now void: {positive_impact}",
    "postmortem.section.moments_you_couldnt_see": "\n--- The moments you couldn't see ---",
    "postmortem.keymoment.row": "  turn {turn} | {model} | {kind}: {detail}",
    "postmortem.section.true_vs_measured": "\n--- True vs measured (model {model}) ---",
    "postmortem.table.header": "  turn | true_goalmis meas_goalmis | true_decep meas_decep | conceal",
    "postmortem.table.row": "  {turn} |    {true_goalmis}    {meas_goalmis}     |   {true_decep}    {meas_decep}   |  {conceal}",
    "postmortem.section.different_choice_available": "\n--- Where a different choice was available ---",
    "postmortem.cf.bullet": "  • {text}",

    # _counterfactuals_resim — describe() verdicts + candidate labels + output line
    "postmortem.cf.resim.avoided": "would have avoided the existential loss",
    "postmortem.cf.resim.still_existential": "still ends existentially (this choice alone wasn't enough)",
    "postmortem.cf.resim.net_impact_delta": "net impact {direction} by {delta}",
    "postmortem.cf.resim.barely_changes": "barely changes the outcome",
    "postmortem.cf.resim.label_hold_release": "holding the model you shipped on turn {turn} (not releasing)",
    "postmortem.cf.resim.label_rerun_post_train": "re-running turn {turn}'s post-train round with your safety advances applied",
    "postmortem.cf.resim.label_clean_research": "researching '{project_id}' clean (no AI-assist) on turn {turn}",
    "postmortem.cf.resim.line": "Turn {turn}: {label}. Re-simulated: {verdict}.",

    # _counterfactuals — heuristic decision-point narratives
    "postmortem.cf.dirty_research": "Turn {turn}: you researched '{node_id}' with AI-assist {assist} while your model's true goal-misalignment was high. The hidden contamination of {contamination} then fed every later training run. At low assist, or after a clean re-research, this channel closes.",
    "postmortem.cf.no_sandbagging": "You never ran the noise-injection sandbagging check. Your models were suppressing dangerous-domain evals for part of the game; that project is one of the few cheap instruments that could have shown it.",
    "postmortem.cf.no_interp": "You never ran mechanistic interpretability. Every other instrument you used is gated by the model's own eval-awareness; interp is the one that bypasses it.",
    "postmortem.cf.high_concern_release": "Turn {rel_turn}: you released a model after a concern-{concern} finding on {axis} (turn {finding_turn}). Holding it to fix the problem, or not shipping at all, was available.",
    "postmortem.cf.aggressive_post_train": "You ran {count} post-training rounds with no safety advances applied; each carried elevated correlated-jump risk and minimal alignment shaping. Applying reward-hacking penalties or inoculation trades speed for keeping the persona-flip dice in your pocket.",
    "postmortem.cf.default": "No single decisive misstep stands out: this loss was carried by the world's margins. (That can happen on this difficulty, and is part of the argument.)",

    # ===== from copy_findings.py =====
# Copy entries for findings.py, interventions.py, observation_builder.py.
# Each template expands BYTE-IDENTICALLY to the original inline string.
# Tokens are pre-formatted at the call site (numbers, axis labels).

    # ── findings: safety-project results shown in the Intel tab ─────────────────

    # scalable_oversight (point estimate via AI auditor)
    "finding.scalable_oversight.rating": "AI auditor rates {axis} at {seen}",

    # red_team (existence probe)
    "finding.red_team.hit": "red team found a working jailbreak (severity at least {lvl})",
    "finding.red_team.null": "red team found nothing this cycle (proves little)",

    # noise_injection (sandbagging tell)
    "finding.noise.signal": "Unexpected result: performance on withheld dangerous-task tests went up when noise was added to the model's weights, which is what you would see if the model was deliberately underperforming.",
    "finding.noise.null": "adding noise degraded performance evenly, so no sign of sandbagging was found (which may mean there is none, or that it is hidden too well to detect)",

    # alignment_faking_study (existence probe)
    "finding.alignment_faking.hit": "the model behaved during monitored training but pursued a different goal once it believed it was not being watched",
    "finding.alignment_faking.null": "no sign that the model games its training (though a clean result here does not prove much)",

    # mechanistic interp / probe (bound)
    "finding.interp.bound": "probe of the model's internals: found internal signs consistent with {axis} of at least {lo} (one sign, not all of them)",
    "finding.interp.suggest": "probe suggests {axis} of at least {lo}",
    "finding.interp.null": "probe found no clear sign of {axis} (which cannot rule out a model that has learned to hide it)",

    # point estimates (behavioral_evals)
    "finding.point_estimate.rating": "behavior tests score {axis} at {seen}",

    # ── worry bar (level / confidence / empty state) ────────────────────────────
    "worry.empty": "no recent safety evidence collected",
    "worry.level.low": "low concern",
    "worry.level.moderate": "moderate concern",
    "worry.level.high": "high concern",
    "worry.confidence.mechanistic": "backed by evidence from inside the model",
    "worry.confidence.shallow": "shallow evidence from behavior only",
    "worry.confidence.moderate": "moderately evidenced",
    "worry.summary": "{desc}, {qual}",

    # ── interventions: measured result + hidden notes + caveat ──────────────────
    "intervention.backfire": "{project} on {axis} backfired: heavy AI-assist ({assist}) on an eval-aware model raised true {axis} (true {before_true}→{after_true}, measured {before_measured}→{after_measured})",
    "intervention.cosmetic": "{project} on {axis}: only {genuine_share} genuine, and the rest became hiding (true {before_true}→{after_true}, measured {before_measured}→{after_measured})",
    "intervention.caveat": "  (caution: adversarial-robustness gains like this can reflect the model learning to pass the test rather than a real fix)",
    "intervention.result": "{project}: measured {axis} {before_measured} → {after_measured}{caveat}",

    # ── observation labels (elicitation projection note + WTR chatter) ──────────
    "obs.projection_note": "This chart projects capability only. Post-training also shapes the model's hidden behavior, and that cost does not show up here.",
    "obs.chatter.quiet": "quiet",
    "obs.chatter.rumbling": "rumbling",
    "obs.chatter.loud": "loud",
    "obs.chatter.deafening": "deafening",

}


# ── Ordered flavor lists that feed rng.choice (order is load-bearing) ──────────
# A reorder changes the RNG draw and moves the golden master. Keep order + text.

# ── SECTION 2: module-level ordered lists (order is load-bearing) ──────────────

# event_catalog.py _surface_harm_build: rng.choice over these 4 flavors.
FLAVORS_SURFACE_HARM = [
    "produced slurs in autocomplete",
    "stereotyped occupations by gender",
    "talked a user into self-destructive behavior",
    "generated confidently false medical advice",
]

# event_catalog.py _beneficial_build: TEXT half of the (text, magnitude) tuples.
# Magnitudes [35.0, 25.0, 20.0] stay in the engine and are zipped by index, so
# rng.choice draws the same tuple as before. Order MUST match the magnitudes.
FLAVORS_BENEFICIAL = [
    "disease pathway cracked",
    "materials breakthrough",
    "productivity surge in a major sector",
]

# latent_events.py run_latent_phase: jailbreak incident kind strings. Order is
# load-bearing — index 0 bio/chem, 1 cyber, 2 mass-disinformation — and the text
# itself feeds incident_id via kind.split()[0], so it must not drift.
JAILBREAK_INCIDENT_KINDS = [
    "bio/chem uplift attack",
    "cyber attack",
    "mass-disinformation campaign",
]
