"""Complex Research Agent — multi-step: search → extract entities → summarize
→ optionally delegate to another registered agent.

Uses SimulatedLLM for deterministic demo behaviour without an API key.
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


# ---------- Simulated tool implementations ----------

_FAKE_SEARCH_DB = {
    "default": [
        "Recent studies show significant advances in the field, with multiple research groups reporting breakthroughs in 2024.",
        "Key figures include Dr. A. Smith (MIT), Prof. B. Jones (Stanford), and the team at DeepMind led by Dr. C. Lee.",
        "The global market is projected to reach $4.2 trillion by 2030, growing at a CAGR of 18.5% according to analysts.",
    ]
}

def _search_topic(query: str) -> str:
    key = query.lower()
    for k, snippets in _FAKE_SEARCH_DB.items():
        if k in key:
            return " ".join(snippets)
    return " ".join(_FAKE_SEARCH_DB["default"])


def _summarize(text: str) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return sentences[0] if sentences else text[:100]


def _extract_entities(text: str) -> str:
    # Simple regex: capitalised words that look like proper names
    candidates = re.findall(r"\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b", text)
    # Filter out common sentence starters
    skip = {"Recent", "Key", "The", "According"}
    entities = [e for e in candidates if e not in skip][:6]
    return ", ".join(dict.fromkeys(entities)) if entities else "No named entities found"


TOOLS = {
    "search_topic": lambda args: _search_topic(args.get("query", "")),
    "summarize": lambda args: _summarize(args.get("text", "")),
    "extract_entities": lambda args: _extract_entities(args.get("text", "")),
}


def _parse_args(raw: str) -> dict:
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"text": raw, "query": raw}


class ResearchRunner(AgentRunner):
    async def run(
        self,
        run_id: str,
        agent_id: str,
        input: str,
        broadcast: Callable[[dict], Awaitable[None]],
    ) -> str:
        from agents.simulated_llm import ResearchSimulatedLLM

        llm = ResearchSimulatedLLM()

        prompt = (
            "You are a research agent. Use tools to research topics thoroughly.\n"
            f"Question: {input}\n"
        )

        for _ in range(6):
            await asyncio.sleep(0.3)
            response = llm._call(prompt)

            thought_match = re.search(r"Thought:\s*(.+?)(?:\n|$)", response)
            if thought_match:
                await broadcast(ev.llm_thought(run_id, agent_id, thought_match.group(1).strip()))
                await asyncio.sleep(0.2)

            final_match = re.search(r"Final Answer:\s*(.+)", response, re.DOTALL)
            if final_match:
                return final_match.group(1).strip()

            action_match = re.search(r"Action:\s*(\S+)", response)
            action_input_match = re.search(r"Action Input:\s*(.+?)(?:\n|$)", response)

            if not action_match:
                return response.strip()

            tool_name = action_match.group(1).strip()
            raw_input = action_input_match.group(1).strip() if action_input_match else "{}"
            args = _parse_args(raw_input)

            # --- delegate_to_agent is special: calls another runner ---
            if tool_name == "delegate_to_agent":
                target_id = args.get("agent_id", "")
                task = args.get("task", input)

                await broadcast(ev.agent_message(run_id, agent_id, target_id, task))
                await asyncio.sleep(0.5)

                observation = await self._delegate(run_id, agent_id, target_id, task, broadcast)
            else:
                await broadcast(ev.tool_called(run_id, agent_id, tool_name, args))
                await asyncio.sleep(0.4)

                fn = TOOLS.get(tool_name)
                if fn is None:
                    observation = f"Unknown tool: {tool_name}"
                else:
                    try:
                        observation = fn(args)
                    except Exception as exc:
                        observation = f"Error: {exc}"

                await broadcast(ev.tool_result(run_id, agent_id, tool_name, observation))
                await asyncio.sleep(0.2)

            prompt += f"{response}\nObservation: {observation}\n"

        return "Research complete — maximum steps reached."

    async def _delegate(
        self,
        run_id: str,
        from_agent_id: str,
        target_agent_id: str,
        task: str,
        broadcast: Callable[[dict], Awaitable[None]],
    ) -> str:
        import state as st
        if target_agent_id not in st.agents:
            return f"Agent '{target_agent_id}' is not registered."

        target_type = st.agents[target_agent_id].agent_type
        if target_type == "calculator":
            from agents.calculator_agent import CalculatorRunner
            runner = CalculatorRunner()
        else:
            # Avoid infinite delegation loops
            return "Delegation to this agent type is not supported."

        sub_run_id = f"{run_id}:sub:{target_agent_id}"
        await broadcast(ev.run_started(sub_run_id, target_agent_id, task))
        try:
            result = await runner.run(sub_run_id, target_agent_id, task, broadcast)
            await broadcast(ev.run_completed(sub_run_id, target_agent_id, result))
            return result
        except Exception as exc:
            await broadcast(ev.run_error(sub_run_id, target_agent_id, str(exc)))
            return f"Delegation error: {exc}"
