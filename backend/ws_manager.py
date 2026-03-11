"""Event manager — writes to the in-memory event store.

Vercel serverless does not support WebSockets; the frontend polls
GET /api/events?after=<seq> instead.  This module keeps the same
broadcast() interface so all other code is unchanged.
"""
from __future__ import annotations
import events_store


class EventManager:
    async def broadcast(self, event: dict):
        events_store.append(event)

    async def connect(self, websocket):  # no-op
        pass

    def disconnect(self, websocket):  # no-op
        pass


manager = EventManager()
