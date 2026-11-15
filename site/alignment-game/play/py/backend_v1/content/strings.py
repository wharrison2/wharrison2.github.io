"""Back-compat shim. All player-facing AUTHORED copy now lives in ONE file:
backend_v1/content/copy.py (the "all strings named and in one file" deliverable).

The lab-identity constants and rival roster used to live here; they moved to
copy.py so a designer edits every backend string in one place. This module
re-exports them so existing imports (`from backend_v1.content.strings import
RIVAL_LAB_NAMES`, etc.) keep working unchanged. Edit the VALUES in copy.py.
"""
from backend_v1.content.copy import (
    DEFAULT_PLAYER_LAB_NAME,
    DEFAULT_PLAYER_TICKER,
    RIVAL_LAB_NAMES,
)

__all__ = [
    "DEFAULT_PLAYER_LAB_NAME",
    "DEFAULT_PLAYER_TICKER",
    "RIVAL_LAB_NAMES",
]
