from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field


class AgentConfig(BaseModel):
    agent_id: str
    display_name: str
    agent_type: Literal["calculator", "research"]
    description: str = ""
    color: str = "#4A90D9"
    x: Optional[float] = None
    y: Optional[float] = None


class AgentRecord(BaseModel):
    agent_id: str
    display_name: str
    agent_type: str
    description: str
    color: str
    x: float
    y: float
    is_running: bool = False


class AgentRegistrationResponse(BaseModel):
    agent_id: str
    status: Literal["registered", "already_exists"]
    message: str


class ConnectionCreate(BaseModel):
    from_agent_id: str
    to_agent_id: str
    label: str = ""


class Connection(ConnectionCreate):
    connection_id: str


class RunRequest(BaseModel):
    agent_id: str
    input: str
    run_id: Optional[str] = None


class RunResponse(BaseModel):
    run_id: str
    agent_id: str
    status: Literal["started"]
    message: str
