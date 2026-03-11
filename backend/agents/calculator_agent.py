"""Simple Calculator Agent — solves arithmetic word problems using four tools.

Uses LangChain's ZERO_SHOT_REACT_DESCRIPTION agent with SimulatedLLM so it
works out-of-the-box without any LLM API key.
"""
from __future__ import annotations
import asyncio
import json
import re
import sys
import os
from typing import Callable, Awaitable

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from agents.base import AgentRunner
import events as ev


def _parse_args(raw: str) -> dict:
    """Parse Action Input — handles JSON or bare values."""
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        nums = re.findall(r"-?\d+(?:\.\d+)?", raw)
        if len(nums) >= 2:
            return {"a": float(nums[0]), "b": float(nums[1])}
        return {"a": 0, "b": 0}


def _do_add(a: float, b: float) -> float:
    return a + b

def _do_subtract(a: float, b: float) -> float:
    return a - b

def _do_multiply(a: float, b: float) -> float:
    return a * b

def _do_divide(a: float, b: float) -> float:
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b


TOOLS = {
    "add": _do_add,
    "subtract": _do_subtract,
    "multiply": _do_multiply,
    "divide": _do_divide,
}


class CalculatorRunner(AgentRunner):
    async def run(
        self,
        run_id: str,
        agent_id: str,
        input: str,
        broadcast: Callable[[dict], Awaitable[None]],
    ) -> str:
        from agents.simulated_llm import CalculatorSimulatedLLM

        llm = CalculatorSimulatedLLM()

        # Build a minimal ReAct-style prompt loop (max 5 iterations)
        prompt = (
            "You are a calculator agent. Use tools to answer math questions.\n"
            f"Question: {input}\n"
        )

        for _ in range(5):
            await asyncio.sleep(0.3)  # slight delay so UI events are visible
            response = llm._call(prompt)

            # Parse Thought
            thought_match = re.search(r"Thought:\s*(.+?)(?:\n|$)", response)
            if thought_match:
                thought = thought_match.group(1).strip()
                await broadcast(ev.llm_thought(run_id, agent_id, thought))
                await asyncio.sleep(0.2)

            # Check for Final Answer
            final_match = re.search(r"Final Answer:\s*(.+)", response, re.DOTALL)
            if final_match:
                return final_match.group(1).strip()

            # Parse Action / Action Input
            action_match = re.search(r"Action:\s*(\w+)", response)
            action_input_match = re.search(r"Action Input:\s*(.+?)(?:\n|$)", response)

            if not action_match:
                return response.strip()

            tool_name = action_match.group(1).strip().lower()
            raw_input = action_input_match.group(1).strip() if action_input_match else "{}"
            args = _parse_args(raw_input)

            await broadcast(ev.tool_called(run_id, agent_id, tool_name, args))
            await asyncio.sleep(0.4)

            fn = TOOLS.get(tool_name)
            if fn is None:
                observation = f"Unknown tool: {tool_name}"
            else:
                try:
                    a = float(args.get("a", 0))
                    b = float(args.get("b", 0))
                    result = fn(a, b)
                    # Format nicely: drop .0 for whole numbers
                    observation = str(int(result) if result == int(result) else result)
                except Exception as exc:
                    observation = f"Error: {exc}"

            await broadcast(ev.tool_result(run_id, agent_id, tool_name, observation))
            await asyncio.sleep(0.2)

            # Append observation to prompt for next turn
            prompt += f"{response}\nObservation: {observation}\n"

        return "Could not determine a final answer."
