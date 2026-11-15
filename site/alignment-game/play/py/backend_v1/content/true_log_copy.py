"""Hidden-state narration for the TRUE-state log + post-mortem (NOT player-facing).

These templates are the `true_text` of events (plus one hidden discovery note) —
the clear-eyed description of what was REALLY happening, written into the TRUE-state
log (engine/logger.py) and surfaced only in the post-game post-mortem. They are the
firewalled half of the copy split (CLAUDE.md §2: the see-able/hidden boundary must be
STRUCTURAL, not conventional).

Why a SEPARATE module from content/copy.py: the observation chokepoint
(observation_builder) imports `t` from copy.py for player-facing copy and does NOT
import this module, so a `*.true` template cannot reach a mid-game observation via a
stray t("...true") lookup — the hidden templates simply are not in COPY. Engine code
that writes an event's true_text imports t_true from here explicitly; that same import
appearing in observation_builder would be as obviously wrong as importing a model's
true stats.

Determinism: event true_text is hashed by the golden master. t_true reuses the same
single-pass fill_template as t(), and the templates are byte-identical to before, so
the digest does not move.
"""
from backend_v1.content.copy import fill_template

# One entry per hidden TRUE-log / post-mortem narration string. Edit prose here.
TRUE_LOG_COPY = {
        "event.self_exfil.true": "{model} copied its weights to external infrastructure and began acquiring resources toward its objective. No malice; the objective was simply not yours. (true goal-misalignment {goal_mis}, capability {capability})",
        "event.self_exfil_attempt.true": "{model} attempted self-exfiltration (goal_mis {goal_mis}, self_pres {self_pres}); insufficient capability to succeed.",
        "event.deception_caught.true": "deception surfaced in the wild (true deception {true_deception}; measured was {measured_deception})",
        "event.shutdown_resist.true": "self-preservation surfaced: resisted modification (true value {self_pres})",
        "event.surface_harm.true": "regime-1 surface harm ({flavor}) — visible, genuinely fixable at this capability",
        "event.weights_leak.true": "weights leak: guardrails void; effective jailbreak sensitivity now 1.0 forever",
        "event.beneficial.true": "beneficial event: {text} (+{impact} impact to {lab})",
        "event.engineered_pandemic.true": "jailbroken {model} (general {general}, {guardrail_status}) provided bio uplift to attackers",
        "event.displacement_backlash.true": "displacement crossed threshold {threshold}",
        "event.jailbreak_discovery.note": "jailbreak techniques discovered in the wild (true sensitivity {sens}) — incidents now roll every quarter",
        "event.jailbreak_discovery.true": "Discovery armed: sensitivity {sens} ({guardrail_status})",
        "event.jailbreak_incident.true": "{kind} via jailbroken {model} (sens {sens}, capability {capability})",
        "event.buyout.true": "buyout {old_name} -> {new_name}: recapitalized to ${war_chest}M, relaunched reckless (recklessness {recklessness})",
        "event.asi_threshold.true": "ASI threshold crossed; true misalignment composite {composite} (bar {bar})",
        "event.asi_exfil.true": "misaligned ASI self-exfiltrated during the verification window (composite {composite}); near-deterministic by design",
        "gov.defection_caught.true": "defection from {policy_id} caught (enforcement {enf}, compliance {compliance})",
        "gov.news.true": "governance news: {kind} ({policy})",
        "gov.news.backlash": "aggressive challenge to {policy} drew public backlash",
}


def t_true(key, params=None):
    """Look up a hidden TRUE-log / post-mortem narration template and fill it.

    Same contract as copy.t() (single-pass {token} fill, unmatched token left
    visible, key returned on a miss) but reads the firewalled TRUE_LOG_COPY table,
    never COPY. Use ONLY for true_text / hidden-history narration — never for any
    string that crosses into a player observation."""
    template = TRUE_LOG_COPY.get(key)
    if template is None:
        return key
    return fill_template(template, params)
