from __future__ import annotations
import sys
from fastapi import APIRouter, HTTPException

sys.path.insert(0, "..")
import state
import events as ev
from models import ConnectionCreate
from ws_manager import manager

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


@router.get("/connections")
async def list_connections():
    return {"connections": [c.model_dump() for c in state.list_connections()]}


@router.post("/connections")
async def add_connection(req: ConnectionCreate):
    if req.from_agent_id not in state.agents:
        raise HTTPException(status_code=404, detail=f"Agent '{req.from_agent_id}' not found.")
    if req.to_agent_id not in state.agents:
        raise HTTPException(status_code=404, detail=f"Agent '{req.to_agent_id}' not found.")
    conn = state.add_connection(req)
    await manager.broadcast(ev.connection_added(conn))
    return conn.model_dump()


@router.delete("/connections/{connection_id}")
async def remove_connection(connection_id: str):
    removed = state.remove_connection(connection_id)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Connection '{connection_id}' not found.")
    await manager.broadcast(ev.connection_removed(connection_id))
    return {"status": "ok", "connection_id": connection_id}
