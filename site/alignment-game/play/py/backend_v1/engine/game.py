"""GameState (DATA) + GameEngine (stateless step) — §11 decision.

GameState is the complete TRUE world; the engine orchestrates the turn
pipeline and builds per-actor observations. step() mutates the passed state in
place and returns (state, observations) — replayability comes from seed +
action log, not structural immutability (see NOTES.md).
"""
from dataclasses import dataclass, field

from backend_v1.config.difficulty import build_constants
from backend_v1.content.strings import (
    DEFAULT_PLAYER_LAB_NAME,
    DEFAULT_PLAYER_TICKER,
    RIVAL_LAB_NAMES,
)
from backend_v1.engine.rng import Rng
from backend_v1.engine.lab import Lab, Disposition
from backend_v1.engine.world import World
from backend_v1.engine.turn_pipeline import run_turn
from backend_v1.engine.logger import GameLogger
from backend_v1.engine.observation.observation_builder import build_observation
from backend_v1.engine.observation.guidance import collect_tips


# ── Player-supplied lab identity: validation/sanitization (SECURITY) ──────────
# The lab name and ticker are the only player-authored strings that enter the
# engine, and they flow on to the frontend (legend, panels) and into observations.
# They are PUBLIC/legible (no firewall-secrecy concern), but they ARE untrusted
# input, so every value is clamped here before a Lab is constructed. The frontend
# escapes them again at render time (defence in depth); this layer guarantees the
# stored value is bounded and free of control characters regardless of the caller
# (server, CLI, or a test), so client-side checks are never the only line.
# DEFAULT_PLAYER_LAB_NAME / DEFAULT_PLAYER_TICKER are the player-facing default
# identity strings; they live in the centralized content table
# (backend_v1.content.strings) and are imported above. Re-exported here so the
# existing `from backend_v1.engine.game import DEFAULT_PLAYER_*` call sites keep
# working — the values are unchanged, only their authored SOURCE moved.
MAX_LAB_NAME_CHARS = 40
MAX_TICKER_CHARS = 6


def _strip_control_characters(raw_text: str) -> str:
    """Drop ASCII/Unicode control characters (anything below space, plus DEL),
    keeping ordinary printable text. Newlines and tabs count as control here —
    a lab name is a single short label, not multi-line text.

    Curly braces are also stripped: a lab name/ticker is the one player-authored
    string that flows into the content-table templating layer as a {token} value
    (backend_v1.content.copy.fill_template). The formatter is single-pass and so
    already immune to injected tokens, but braces are meaningless in a label and
    would render as a stray "{...}" — drop them at the source (defence in depth)."""
    return "".join(
        ch for ch in raw_text
        if ch >= " " and ch != "\x7f" and ch not in "{}"
    )


def sanitize_lab_name(raw_name) -> str:
    """Clamp an untrusted lab name to a safe, bounded, single-line string.

    Coerces non-strings, strips control characters, trims surrounding
    whitespace, caps length, and falls back to the default if the result is
    empty. Never raises — bad input becomes the default, not an error."""
    text = raw_name if isinstance(raw_name, str) else ""
    cleaned = _strip_control_characters(text).strip()
    bounded = cleaned[:MAX_LAB_NAME_CHARS].strip()
    return bounded if bounded else DEFAULT_PLAYER_LAB_NAME


def derive_ticker_from_name(lab_name: str) -> str:
    """Default ticker = first 3 letters/digits of the name, uppercased (mirrors
    the frontend's live auto-derive). Skips spaces/punctuation so "Open Brain"
    yields "OPE", not "OP ". Falls back to the default if nothing usable remains."""
    alphanumeric = [ch for ch in lab_name if ch.isalnum()]
    first_three = "".join(alphanumeric[:3]).upper()
    return first_three if first_three else DEFAULT_PLAYER_TICKER


def sanitize_ticker(raw_ticker, fallback_name: str) -> str:
    """Clamp an untrusted ticker to a safe, bounded, uppercased string. Empty or
    all-control input falls back to a ticker derived from the (already-sanitized)
    lab name, so a lab always has a usable ticker. Never raises."""
    text = raw_ticker if isinstance(raw_ticker, str) else ""
    cleaned = _strip_control_characters(text).strip()
    bounded = cleaned[:MAX_TICKER_CHARS].strip().upper()
    return bounded if bounded else derive_ticker_from_name(fallback_name)


@dataclass
class GameState:
    consts: object
    rng: Rng
    dt: float
    max_turns: int | None       # None = uncapped (play to ASI or catastrophe)
    labs: list
    world: World
    guidance: str = "standard"
    turn: int = 0
    game_over: bool = False
    outcome: dict | None = None
    # per-human outcomes (multiplayer race, MULTIPLAYER_DESIGN §4.6). Filled by
    # _finish; solo it holds the single player's dict (same object as outcome).
    outcome_by_lab: dict = field(default_factory=dict)
    is_multiplayer: bool = False
    # public record shared by all observers this turn
    last_events: list = field(default_factory=list)


def new_game(seed=0, difficulty="realistic", guidance="standard",
             rival_count=None, max_turns=None,
             player_lab_name=None, player_ticker=None) -> GameState:
    consts = build_constants(difficulty)
    rng = Rng(seed)
    num_rivals = rival_count if rival_count is not None else consts.RIVAL_COUNT

    # Untrusted player-authored identity: sanitize before it touches any state.
    safe_player_name = sanitize_lab_name(player_lab_name)
    safe_player_ticker = sanitize_ticker(player_ticker, safe_player_name)

    player_lab = Lab(
        id="player", name=safe_player_name, ticker=safe_player_ticker, is_player=True,
        cash=consts.STARTING_CASH,
        work_budget_per_year=consts.WORK_BUDGET_PER_YEAR,
        # §9b early investment: seed the base flow so it is present from turn 1, before
        # the score-divvied pie exists. It holds while the lab is active, decays if idle.
        base_investment_rate=consts.BASE_INVESTMENT_PER_YEAR,
    )
    labs = [player_lab] + _build_rival_labs(consts, rng, num_rivals)

    world = World(public_approval=consts.APPROVAL_START, wtr=consts.WTR_START)
    return GameState(consts=consts, rng=rng, dt=consts.DT_YEARS,
                     max_turns=max_turns, labs=labs, world=world,
                     guidance=guidance)


def _build_rival_labs(consts, rng, num_rivals) -> list:
    """The AI rival roster, shared by solo and multiplayer construction. Draws
    one rng.uniform per rival (starting-cash jitter) — keep the draw order
    stable, it's part of the seeded sequence (CLAUDE.md §0.4)."""
    rival_labs = []
    for i in range(num_rivals):
        reck, cost, ow = consts.RIVAL_DISPOSITIONS[i % len(consts.RIVAL_DISPOSITIONS)]
        rival_name = RIVAL_LAB_NAMES[i % len(RIVAL_LAB_NAMES)]
        # Rivals get tickers too (first 3 chars, uppercased) so the graph legend can
        # show every lab's ticker consistently — same derivation as the player default.
        rival_ticker = derive_ticker_from_name(rival_name)
        # governance weights derive from recklessness (ideologues hate regulation more)
        reg_stance = min(0.95, 0.3 + 0.6 * reck + (0.2 if ow else 0.0))
        safety_pri = max(0.05, 0.5 * (1.0 - reck))
        rival_cash = consts.STARTING_CASH * rng.uniform(0.8, 1.2)
        rival_labs.append(Lab(
            id=f"rival{i+1}", name=rival_name, ticker=rival_ticker,
            cash=rival_cash,
            work_budget_per_year=consts.WORK_BUDGET_PER_YEAR,
            base_investment_rate=consts.BASE_INVESTMENT_PER_YEAR,
            disposition=Disposition(
                recklessness=reck, cost_advantage=cost,
                open_weights_ideology=ow,
                regulation_stance=reg_stance,
                safety_priority=safety_pri,
            ),
        ))
    return rival_labs


def new_multiplayer_game(seed=0, difficulty="realistic", guidance="standard",
                         human_identities=None, rival_count=None,
                         max_turns=None) -> GameState:
    """N-human shared world (MULTIPLAYER_DESIGN §4.2).

    human_identities is a list of (raw_name, raw_ticker) pairs, one per seat,
    each sanitized here exactly like the solo player's. Human labs are
    player1..playerN at the front of state.labs — all is_player=True with the
    same starting constants and default Disposition as the solo player. AI
    rivals fill in after. Solo play keeps new_game untouched (golden master,
    CLAUDE.md §8)."""
    consts = build_constants(difficulty)
    rng = Rng(seed)
    num_rivals = rival_count if rival_count is not None else consts.RIVAL_COUNT

    labs = []
    for i, (raw_name, raw_ticker) in enumerate(human_identities):
        safe_name = sanitize_lab_name(raw_name)
        safe_ticker = sanitize_ticker(raw_ticker, safe_name)
        labs.append(Lab(
            id=f"player{i+1}", name=safe_name, ticker=safe_ticker,
            is_player=True,
            cash=consts.STARTING_CASH,
            work_budget_per_year=consts.WORK_BUDGET_PER_YEAR,
            base_investment_rate=consts.BASE_INVESTMENT_PER_YEAR,
        ))
    labs += _build_rival_labs(consts, rng, num_rivals)

    world = World(public_approval=consts.APPROVAL_START, wtr=consts.WTR_START)
    return GameState(consts=consts, rng=rng, dt=consts.DT_YEARS,
                     max_turns=max_turns, labs=labs, world=world,
                     guidance=guidance, is_multiplayer=True)


class GameEngine:
    def __init__(self):
        self.logger = GameLogger()

    def step(self, state: GameState, actions: dict):
        """actions: {lab_id: Action}. Returns (state, {lab_id: Observation})."""
        if state.game_over:
            raise RuntimeError("game is over")
        state.turn += 1
        result = run_turn(state, actions)
        state.last_events = result["events"]
        self.logger.record(state, actions, result["events"])

        # Tips for every HUMAN lab are collected BEFORE any observation is
        # built: collect_tips and build_observation both consume the seeded
        # RNG, and this ordering (all tips first, then observations, each in
        # state.labs order) is exactly the solo draw sequence — do not
        # interleave them (determinism, CLAUDE.md §0.4).
        tips_by_lab = {}
        for lab in state.labs:
            if lab.is_player:
                tips_by_lab[lab.id] = collect_tips(state, lab)   # public; guidance level applies
        observations = {}
        for lab in state.labs:
            observations[lab.id] = build_observation(
                state, lab, tips_by_lab.get(lab.id, []),
                result["policy_news_by_lab"][lab.id], result["events"],
                result["new_findings"][lab.id])
        return state, observations
