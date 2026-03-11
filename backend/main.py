"""Agent Orchestration Platform — FastAPI entry point.

Start with:
    cd backend
    uvicorn main:app --reload --port 8000

Then open http://localhost:8000
"""
from __future__ import annotations
import sys
import os

# Ensure backend/ is on the path so absolute imports work
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager

import state
from models import AgentConfig
from ws_manager import manager
from routers.agents import router as agents_router
from routers.workflows import router as workflows_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-register sample agents so the demo graph is populated on startup
    _seed_sample_agents()
    yield


def _seed_sample_agents():
    sample_agents = [
        AgentConfig(
            agent_id="calculator_agent",
            display_name="Calculator",
            agent_type="calculator",
            description="Solves arithmetic word problems using add, subtract, multiply, divide tools.",
            color="#4A90D9",
            x=280,
            y=260,
        ),
        AgentConfig(
            agent_id="research_agent",
            display_name="Research Agent",
            agent_type="research",
            description="Multi-step research: searches topics, extracts entities, summarises, and delegates to other agents.",
            color="#7B68EE",
            x=620,
            y=260,
        ),
    ]
    for cfg in sample_agents:
        if cfg.agent_id not in state.agents:
            state.register_agent(cfg)


app = FastAPI(
    title="Agent Orchestration Platform",
    description="Visualise and orchestrate LangChain agents in real time.",
    version="1.0.0",
    lifespan=lifespan,
)

# API routers
app.include_router(agents_router)
app.include_router(workflows_router)


# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive; client sends pings as plain text
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


# Serve frontend static files
_frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(_frontend_dir):
    app.mount("/static", StaticFiles(directory=_frontend_dir), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(os.path.join(_frontend_dir, "index.html"))

    @app.get("/{path:path}")
    async def serve_frontend(path: str):
        file_path = os.path.join(_frontend_dir, path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(_frontend_dir, "index.html"))
