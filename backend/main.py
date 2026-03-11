"""Agent Orchestration Platform — FastAPI entry point.

Local dev:
    cd backend && uvicorn main:app --reload --port 8000
    Then open http://localhost:8000

Vercel: served via api/index.py — static frontend is in public/
"""
from __future__ import annotations
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

import state
import events_store
from models import AgentConfig
from routers.agents import router as agents_router
from routers.workflows import router as workflows_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    _seed_sample_agents()
    yield


def _seed_sample_agents():
    samples = [
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
    for cfg in samples:
        if cfg.agent_id not in state.agents:
            state.register_agent(cfg)


app = FastAPI(
    title="Agent Orchestration Platform",
    description="Visualise and orchestrate LangChain agents in real time.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routers
app.include_router(agents_router)
app.include_router(workflows_router)


# ── Polling endpoint (replaces WebSocket for Vercel compatibility) ──────────
@app.get("/api/events")
async def get_events(after: int = 0):
    """Return all events with seq > after.  Frontend polls this every 500 ms."""
    return {
        "events": events_store.get_after(after),
        "current_seq": events_store.current_seq(),
    }


# ── Local-dev static file serving (Vercel serves public/ directly) ──────────
_public_dir = os.path.join(os.path.dirname(__file__), "..", "public")
if os.path.isdir(_public_dir):
    app.mount("/assets", StaticFiles(directory=_public_dir), name="assets")

    @app.get("/")
    async def serve_index():
        return FileResponse(os.path.join(_public_dir, "index.html"))

    @app.get("/{path:path}")
    async def serve_static(path: str):
        fp = os.path.join(_public_dir, path)
        if os.path.isfile(fp):
            return FileResponse(fp)
        return FileResponse(os.path.join(_public_dir, "index.html"))
