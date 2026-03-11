"""In-memory event log with sequence numbers.

All broadcast() calls write here; the frontend polls GET /api/events?after=<seq>
instead of using a WebSocket.  Works on any stateless serverless platform.
"""
from __future__ import annotations
from collections import deque
from threading import Lock
from typing import List

_lock = Lock()
_events: deque = deque(maxlen=500)
_seq: int = 0


def append(event: dict) -> dict:
    global _seq
    with _lock:
        _seq += 1
        event = {**event, "seq": _seq}
        _events.append(event)
    return event


def get_after(seq: int) -> List[dict]:
    with _lock:
        return [e for e in _events if e.get("seq", 0) > seq]


def current_seq() -> int:
    return _seq
