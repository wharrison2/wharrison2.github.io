"""The game's solo server routes, for the browser: one game per tab, no HTTP.

worker.js calls handle(path, body_json) for each api() call the front end makes and gets back the JSON the
server would have sent. Mirrors backend_v1/server/server.py (Session, the solo routes, and production mode's
empty /api/truth); multiplayer is left out.
"""
import json

from backend_v1.engine.game import new_game, GameEngine
from backend_v1.engine.actions import Action, ActionError, validate_action
from backend_v1.engine.controllers.rival_controller import RivalController
from backend_v1.engine.observation.observation_builder import build_observation
from backend_v1.engine.postmortem import build_postmortem
from backend_v1.engine.rng import Rng
from backend_v1.server.payloads import base_state_payload
from backend_v1.content.copy import t

MAX_GAME_TURNS = 500


def clamp_max_turns(raw_value):
    if raw_value is None:
        return MAX_GAME_TURNS
    try:
        requested_turns = int(raw_value)
    except (TypeError, ValueError):
        return MAX_GAME_TURNS
    if requested_turns < 1:
        return MAX_GAME_TURNS
    return min(requested_turns, MAX_GAME_TURNS)


class Session:
    def __init__(self, seed=0, difficulty="realistic", guidance="standard", rivals=None, max_turns=None,
                 player_lab_name=None, player_ticker=None):
        self.state = new_game(seed=seed, difficulty=difficulty, guidance=guidance, rival_count=rivals,
                              max_turns=max_turns, player_lab_name=player_lab_name, player_ticker=player_ticker)
        self.engine = GameEngine()
        self.rival_ctrl = RivalController(Rng(seed + 1))
        self.observations = None
        self.player = next(l for l in self.state.labs if l.is_player)
        self._postmortem_cache = None

    def player_observation(self):
        if self.observations is not None:
            return self.observations[self.player.id]
        return build_observation(self.state, self.player, [], [], [], [])

    def submit(self, action_dict):
        if self.state.game_over:
            return {"errors": [t("api.game_over")]}
        try:
            action = Action.from_dict(action_dict)
        except (ActionError, TypeError, ValueError) as e:
            return {"errors": [str(e)]}
        problems = validate_action(action, self.player, self.state.world, self.state.consts, self.state.dt)
        if problems:
            return {"errors": problems}
        is_first_turn = self.observations is None
        actions = {self.player.id: action}
        for lab in self.state.labs:
            if lab.is_player:
                continue
            if is_first_turn:
                actions[lab.id] = Action()
            else:
                actions[lab.id] = self.rival_ctrl.decide(self.observations[lab.id], lab.disposition)
        self.state, self.observations = self.engine.step(self.state, actions)
        return self.state_payload()

    def state_payload(self):
        return base_state_payload(self.player_observation(), self.engine, self.state)

    def postmortem(self):
        if not self.state.game_over:
            return {"errors": [t("api.game_not_over")]}
        if self._postmortem_cache is None:
            self._postmortem_cache = build_postmortem(self.engine.logger, self.state, self.player.id, resim=True)
        return self._postmortem_cache


_session = None
NO_GAME = {"errors": ["no active game — start a new game"]}


def _route(path, body):
    global _session
    if path == "/api/new":
        try:
            fresh = Session(seed=int(body.get("seed", 0)), difficulty=body.get("difficulty", "realistic"),
                            guidance=body.get("guidance", "standard"), rivals=body.get("rivals"),
                            max_turns=clamp_max_turns(body.get("max_turns")),
                            player_lab_name=body.get("lab_name"), player_ticker=body.get("ticker"))
        except ValueError as e:
            return {"errors": [str(e)]}
        _session = fresh
        return _session.state_payload()
    if path == "/api/truth":
        return {"turns": []}  # the god-view debug tab, closed as in production
    if _session is None:
        return NO_GAME
    if path == "/api/state":
        return _session.state_payload()
    if path == "/api/action":
        return _session.submit(body.get("action", {}))
    if path == "/api/postmortem":
        return _session.postmortem()
    return {"errors": ["not found"]}


def handle(path, body_json):
    body = json.loads(body_json) if body_json else {}
    if not isinstance(body, dict):
        return json.dumps({"errors": ["bad JSON"]})
    return json.dumps(_route(path, body))
