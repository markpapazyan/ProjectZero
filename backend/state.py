from __future__ import annotations
import uuid
from typing import Dict, List
from models import AgentConfig, AgentRecord, ConnectionCreate, Connection

# In-memory stores
agents: Dict[str, AgentRecord] = {}
connections: Dict[str, Connection] = {}

# Spread agents out on the canvas
_INITIAL_POSITIONS = [(300, 250), (650, 250), (475, 450), (120, 450)]
_pos_index = 0


def _next_position():
    global _pos_index
    positions = _INITIAL_POSITIONS
    pos = positions[_pos_index % len(positions)]
    _pos_index += 1
    return pos


def register_agent(config: AgentConfig) -> AgentRecord:
    x = config.x if config.x is not None else _next_position()[0]
    y = config.y if config.y is not None else _next_position()[1]
    if config.x is None and config.y is None:
        x, y = _next_position()
        # undo the double-advance from above
        global _pos_index
        _pos_index -= 1

    record = AgentRecord(
        agent_id=config.agent_id,
        display_name=config.display_name,
        agent_type=config.agent_type,
        description=config.description,
        color=config.color,
        x=x,
        y=y,
    )
    agents[config.agent_id] = record
    return record


def unregister_agent(agent_id: str) -> bool:
    if agent_id not in agents:
        return False
    del agents[agent_id]
    # Remove any connections involving this agent
    to_remove = [
        cid for cid, c in connections.items()
        if c.from_agent_id == agent_id or c.to_agent_id == agent_id
    ]
    for cid in to_remove:
        del connections[cid]
    return True


def list_agents() -> List[AgentRecord]:
    return list(agents.values())


def add_connection(req: ConnectionCreate) -> Connection:
    conn = Connection(
        connection_id=str(uuid.uuid4()),
        from_agent_id=req.from_agent_id,
        to_agent_id=req.to_agent_id,
        label=req.label,
    )
    connections[conn.connection_id] = conn
    return conn


def remove_connection(connection_id: str) -> bool:
    if connection_id not in connections:
        return False
    del connections[connection_id]
    return True


def list_connections() -> List[Connection]:
    return list(connections.values())


def set_agent_running(agent_id: str, running: bool):
    if agent_id in agents:
        agents[agent_id].is_running = running
