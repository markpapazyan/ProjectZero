from __future__ import annotations
import time
from models import AgentRecord, Connection


def _ts() -> int:
    return int(time.time() * 1000)


def snapshot(agents: list, connections: list) -> dict:
    return {
        "type": "snapshot",
        "ts": _ts(),
        "agents": [a.model_dump() for a in agents],
        "connections": [c.model_dump() for c in connections],
    }


def agent_registered(agent: AgentRecord) -> dict:
    return {"type": "agent_registered", "ts": _ts(), "agent": agent.model_dump()}


def agent_unregistered(agent_id: str) -> dict:
    return {"type": "agent_unregistered", "ts": _ts(), "agent_id": agent_id}


def connection_added(connection: Connection) -> dict:
    return {"type": "connection_added", "ts": _ts(), "connection": connection.model_dump()}


def connection_removed(connection_id: str) -> dict:
    return {"type": "connection_removed", "ts": _ts(), "connection_id": connection_id}


def run_started(run_id: str, agent_id: str, input: str) -> dict:
    return {"type": "run_started", "ts": _ts(), "run_id": run_id, "agent_id": agent_id, "input": input}


def llm_thought(run_id: str, agent_id: str, thought: str) -> dict:
    return {"type": "llm_thought", "ts": _ts(), "run_id": run_id, "agent_id": agent_id, "thought": thought}


def tool_called(run_id: str, agent_id: str, tool: str, input: dict) -> dict:
    return {"type": "tool_called", "ts": _ts(), "run_id": run_id, "agent_id": agent_id, "tool": tool, "input": input}


def tool_result(run_id: str, agent_id: str, tool: str, output: str) -> dict:
    return {"type": "tool_result", "ts": _ts(), "run_id": run_id, "agent_id": agent_id, "tool": tool, "output": output}


def agent_message(run_id: str, from_agent_id: str, to_agent_id: str, content: str) -> dict:
    return {
        "type": "agent_message", "ts": _ts(),
        "run_id": run_id,
        "from_agent_id": from_agent_id,
        "to_agent_id": to_agent_id,
        "content": content,
    }


def run_completed(run_id: str, agent_id: str, result: str) -> dict:
    return {"type": "run_completed", "ts": _ts(), "run_id": run_id, "agent_id": agent_id, "result": result}


def run_error(run_id: str, agent_id: str, error: str) -> dict:
    return {"type": "run_error", "ts": _ts(), "run_id": run_id, "agent_id": agent_id, "error": error}
