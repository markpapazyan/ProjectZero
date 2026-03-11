from __future__ import annotations
import json
from typing import List
from fastapi import WebSocket
import state
import events as ev


class WebSocketManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active.append(websocket)
        # Send current snapshot so late-joiners are in sync
        snapshot = ev.snapshot(state.list_agents(), state.list_connections())
        try:
            await websocket.send_text(json.dumps(snapshot))
        except Exception:
            pass

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active:
            self.active.remove(websocket)

    async def broadcast(self, event: dict):
        dead: List[WebSocket] = []
        text = json.dumps(event)
        for ws in list(self.active):
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = WebSocketManager()
