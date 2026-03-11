from __future__ import annotations
import asyncio
import sys
import uuid
from fastapi import APIRouter, HTTPException, BackgroundTasks

sys.path.insert(0, "..")
import state
import events as ev
from models import AgentConfig, AgentRegistrationResponse, RunRequest, RunResponse
from ws_manager import manager

router = APIRouter(prefix="/api/agents", tags=["agents"])

# Lazy import to avoid circular at module load time
def _get_runner(agent_type: str):
    from agents.calculator_agent import CalculatorRunner
    from agents.research_agent import ResearchRunner
    AGENT_TYPE_MAP = {
        "calculator": CalculatorRunner,
        "research": ResearchRunner,
    }
    cls = AGENT_TYPE_MAP.get(agent_type)
    if cls is None:
        raise HTTPException(status_code=400, detail=f"Unknown agent_type: {agent_type}")
    return cls()


@router.get("")
async def list_agents():
    return {"agents": [a.model_dump() for a in state.list_agents()]}


@router.post("/register", response_model=AgentRegistrationResponse)
async def register_agent(config: AgentConfig):
    if config.agent_id in state.agents:
        return AgentRegistrationResponse(
            agent_id=config.agent_id,
            status="already_exists",
            message=f"Agent '{config.agent_id}' is already registered.",
        )
    record = state.register_agent(config)
    await manager.broadcast(ev.agent_registered(record))
    return AgentRegistrationResponse(
        agent_id=record.agent_id,
        status="registered",
        message=f"Agent '{record.agent_id}' registered successfully.",
    )


@router.delete("/{agent_id}")
async def unregister_agent(agent_id: str):
    removed = state.unregister_agent(agent_id)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")
    await manager.broadcast(ev.agent_unregistered(agent_id))
    return {"status": "ok", "agent_id": agent_id}


@router.post("/run", response_model=RunResponse)
async def run_agent(req: RunRequest):
    if req.agent_id not in state.agents:
        raise HTTPException(status_code=404, detail=f"Agent '{req.agent_id}' not found.")
    run_id = req.run_id or str(uuid.uuid4())
    runner = _get_runner(state.agents[req.agent_id].agent_type)

    async def _execute():
        state.set_agent_running(req.agent_id, True)
        await manager.broadcast(ev.run_started(run_id, req.agent_id, req.input))
        try:
            result = await runner.run(run_id, req.agent_id, req.input, manager.broadcast)
            await manager.broadcast(ev.run_completed(run_id, req.agent_id, result))
        except Exception as exc:
            await manager.broadcast(ev.run_error(run_id, req.agent_id, str(exc)))
        finally:
            state.set_agent_running(req.agent_id, False)

    asyncio.create_task(_execute())
    return RunResponse(
        run_id=run_id,
        agent_id=req.agent_id,
        status="started",
        message=f"Run {run_id} started for agent '{req.agent_id}'.",
    )
