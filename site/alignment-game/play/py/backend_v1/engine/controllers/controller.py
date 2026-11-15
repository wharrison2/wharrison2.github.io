"""LabController interface (§11): decide(observation, disposition) -> Action.

Lab = state; controller = policy. Rivals decide from THEIR observations, not
truth — no godmode rivals.
"""


class LabController:
    def decide(self, observation, disposition):
        raise NotImplementedError
