"""Litigation / regulation NEWS — the dual-ledger political-blowback loop (§10c).

Every litigation move has a legal outcome (did the policy survive) AND a political
consequence (approval / WTR shift). News rides the §9 event/narration channel:
a reckless leader funding a big challenge to strike a *popular safety* policy wins
in court but can lose in the polls — approval drops, WTR rises, the government
defends harder next time. Aggressive litigation can backfire politically.
"""
from backend_v1.engine.events.event import FiredEvent
from backend_v1.engine.events.effects import apply_effects
from backend_v1.content.copy import t
from backend_v1.content.true_log_copy import t_true


def news_event(sb, kind, policy_name, approval=0.0, wtr=0.0, lab_id=None, detail=""):
    """Emit a governance NEWS event that moves approval/WTR, applied immediately."""
    effects = []
    if approval:
        effects.append(("modify_approval", {"amount": approval}))
    if wtr:
        effects.append(("modify_wtr", {"amount": wtr}))
    public_text = t("gov.news.public", {"policy": policy_name})
    true_text = detail or t_true("gov.news.true", {"kind": kind, "policy": policy_name})
    ev = FiredEvent(kind, "societal", "ordinary", sb.turn, lab_id, None, 0.3, 0.0,
                    public_text,
                    true_text, effects=effects)
    apply_effects(sb, ev)
    return ev


def challenge_backlash(sb, policy_name, challenge_effort, lab_id):
    """The ACT of aggressively challenging a popular safety policy draws protest —
    approval falls / WTR rises in proportion to how hard the challenge pushed."""
    consts = sb.consts
    magnitude = min(1.0, challenge_effort / 60.0)
    if magnitude < 0.15:
        return None
    backlash_detail = t_true("gov.news.backlash", {"policy": policy_name})
    return news_event(sb, "litigation_backlash", policy_name,
                      approval=-consts.LIT_NEWS_APPROVAL_SWING * magnitude,
                      wtr=+consts.LIT_NEWS_WTR_SWING * magnitude, lab_id=lab_id,
                      detail=backlash_detail)
