"""Player controller: wraps externally-supplied input (human CLI / agent JSON /
scripted policy) as an Action. The harness sets `pending` each turn."""
from backend_v1.engine.actions import Action
from backend_v1.engine.controllers.controller import LabController


class PlayerController(LabController):
    def __init__(self):
        self.pending: Action | None = None

    def decide(self, observation, disposition):
        action = self.pending or Action()
        self.pending = None
        return action
