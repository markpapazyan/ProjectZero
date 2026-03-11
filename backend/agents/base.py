from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Callable, Awaitable


class AgentRunner(ABC):
    """Base class for all agent runners."""

    @abstractmethod
    async def run(
        self,
        run_id: str,
        agent_id: str,
        input: str,
        broadcast: Callable[[dict], Awaitable[None]],
    ) -> str:
        """Execute the agent and return the final result string.

        Use `broadcast(event_dict)` to emit real-time events to all WS clients.
        """
        ...
