"""Appeals + the court hierarchy (§10c). Margin of victory drives everything:
a knife-edge ruling is ripe for reversal; a blowout is near-unappealable.

  • P(appeal succeeds) ∝ (−original_margin) — close rulings get appealed.
  • P(gov appeals a loss) ∝ WTR — struck-while-WTR-decayed just dies; struck-while-
    WTR-high → the government appeals. Challenge TIMING matters.
  • Court hierarchy trial → circuit → SCOTUS. SCOTUS gated TWICE: a low P(cert) AND
    a higher win bar once heard (COURT_WIN_BAR in litigation resolution).
  • Stay pending appeal: fast freeze of the status quo while litigation continues.
  • Precedent updates constitutionality ∝ court level (SCOTUS near-permanent).
"""


def appeal_strength(margin, consts):
    """How ripe a ruling is for reversal: ∝ how CLOSE it was (small |margin|)."""
    return consts.APPEAL_MARGIN_K / (1.0 + abs(margin))


def maybe_appeal(sb, st, case, outcome, margin) -> bool:
    """The losing side may appeal a DECISIVE ruling (struck / fail). Escalates the
    court level (cert-gated at SCOTUS) and may freeze the status quo with a stay.
    Returns True if an appeal was taken (case stays open at a higher court)."""
    consts, world, rng = sb.consts, sb.world, sb.rng

    if case.court_level == "scotus":
        return False                      # terminal — SCOTUS settles it

    strength = appeal_strength(margin, consts)

    if outcome == "struck":
        loser = "defense"                 # the policy's side lost; gov may appeal ∝ WTR
        raw_p = consts.GOV_APPEAL_WTR_K * world.wtr + strength
        appeal_p = min(0.95, raw_p)
    elif outcome == "fail":
        loser = "challenge"               # challengers lost a close one
        appeal_p = strength
    else:
        return False                      # interlocutory outcomes aren't full appeals

    if not rng.roll(min(0.95, appeal_p)):
        return False

    next_court = "circuit" if case.court_level == "trial" else "scotus"
    if next_court == "scotus" and not rng.roll(consts.SCOTUS_CERT_P):
        return False                      # cert denied — the lower ruling stands

    case.court_level = next_court
    case.status = "appealed"
    case.appeal_by = loser

    # stay pending appeal: arrives fast, freezes the current state while it proceeds
    stay_p = min(0.9, consts.STAY_GRANT_MARGIN_K * strength * 4.0)
    if rng.roll(stay_p):
        case.stay_active = True
        # a stay on a struck policy freezes it BACK to active while the appeal runs
        if outcome == "struck" and st.stage == "struck":
            st.stage = "active"

    return True


def apply_precedent(st, case, outcome, consts):
    """On final (un-appealed) resolution, precedent updates constitutionality ∝
    court level: a SCOTUS-upheld policy is nearly unchallengeable; a struck TYPE is
    nearly un-passable (handled as the policy staying struck)."""
    court_weight = consts.COURT_PRECEDENT_MULT[case.court_level]
    if outcome == "fail":                 # upheld — entrench further by court weight
        st.constitutionality = min(1.0, st.constitutionality
                                   + consts.LIT_ENTRENCH_GAIN * court_weight)
    case.stay_active = False
