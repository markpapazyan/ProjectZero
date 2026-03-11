"""SimulatedLLM — a deterministic LangChain LLM that produces ReAct-style
traces without needing any API key.  It works by scanning the conversation
prompt for the original human question and deciding which tool to call next
based on simple keyword / state detection."""
from __future__ import annotations
import re
from typing import Any, List, Optional, Mapping
from langchain.llms.base import LLM
from langchain.callbacks.manager import CallbackManagerForLLMRun


class CalculatorSimulatedLLM(LLM):
    """Simulates a ReAct agent that solves arithmetic word problems."""

    @property
    def _llm_type(self) -> str:
        return "calculator_simulated"

    @property
    def _identifying_params(self) -> Mapping[str, Any]:
        return {}

    def _call(
        self,
        prompt: str,
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> str:
        # If we already have an Observation in the prompt, return Final Answer
        if "Observation:" in prompt:
            obs_match = re.findall(r"Observation:\s*(.+)", prompt)
            last_obs = obs_match[-1].strip() if obs_match else "unknown"
            return f"Thought: I now have the result.\nFinal Answer: {last_obs}"

        # Extract the human question from the prompt
        question = self._extract_question(prompt)

        # Detect operation keywords
        q_lower = question.lower()
        numbers = re.findall(r"-?\d+(?:\.\d+)?", question)
        a = numbers[0] if len(numbers) > 0 else "0"
        b = numbers[1] if len(numbers) > 1 else "0"

        if any(w in q_lower for w in ["add", "plus", "sum", "total", "+"]):
            tool, args = "add", f'{{"a": {a}, "b": {b}}}'
            thought = f"I need to add {a} and {b}."
        elif any(w in q_lower for w in ["subtract", "minus", "difference", "-"]):
            tool, args = "subtract", f'{{"a": {a}, "b": {b}}}'
            thought = f"I need to subtract {b} from {a}."
        elif any(w in q_lower for w in ["multiply", "times", "product", "×", "*"]):
            tool, args = "multiply", f'{{"a": {a}, "b": {b}}}'
            thought = f"I need to multiply {a} by {b}."
        elif any(w in q_lower for w in ["divide", "divided", "quotient", "/"]):
            tool, args = "divide", f'{{"a": {a}, "b": {b}}}'
            thought = f"I need to divide {a} by {b}."
        else:
            # Default: try to add whatever numbers are present
            tool, args = "add", f'{{"a": {a}, "b": {b}}}'
            thought = f"I'll perform a calculation with {a} and {b}."

        return f"Thought: {thought}\nAction: {tool}\nAction Input: {args}"

    def _extract_question(self, prompt: str) -> str:
        # The human input sits between "Human:" / "Question:" markers
        for pattern in [r"Question:\s*(.+?)(?:\n|$)", r"Human:\s*(.+?)(?:\n|$)"]:
            m = re.search(pattern, prompt, re.DOTALL)
            if m:
                return m.group(1).strip()
        return prompt[-300:]  # fallback: last chunk


class ResearchSimulatedLLM(LLM):
    """Simulates a multi-step ReAct research agent."""

    # Track call count per run so we advance through the script
    _call_count: int = 0

    class Config:
        arbitrary_types_allowed = True

    @property
    def _llm_type(self) -> str:
        return "research_simulated"

    @property
    def _identifying_params(self) -> Mapping[str, Any]:
        return {}

    def _call(
        self,
        prompt: str,
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> str:
        observation_count = prompt.count("Observation:")
        question = self._extract_question(prompt)
        q_lower = question.lower()

        # Step 0 → search
        if observation_count == 0:
            query = question[:60].replace('"', '')
            return (
                f"Thought: I should search for information about this topic.\n"
                f"Action: search_topic\n"
                f'Action Input: {{"query": "{query}"}}'
            )

        # Step 1 → extract entities
        if observation_count == 1:
            last_obs = self._last_observation(prompt)
            return (
                f"Thought: I have search results. Let me extract the key entities.\n"
                f"Action: extract_entities\n"
                f'Action Input: {{"text": "{last_obs[:120]}"}}'
            )

        # Step 2 → summarize
        if observation_count == 2:
            last_obs = self._last_observation(prompt)
            # Grab the search result from the first observation
            obs_list = re.findall(r"Observation:\s*(.+?)(?=\nThought:|\nAction:|\Z)", prompt, re.DOTALL)
            search_text = obs_list[0].strip()[:200] if obs_list else last_obs
            return (
                f"Thought: Now I'll summarize the findings.\n"
                f"Action: summarize\n"
                f'Action Input: {{"text": "{search_text[:150]}"}}'
            )

        # Step 3 → delegate to calculator if numbers found, else final answer
        if observation_count == 3:
            numbers = re.findall(r"\d+", question)
            if numbers and "calculator_agent" in self._get_registered_agents():
                a, b = numbers[0], numbers[1] if len(numbers) > 1 else "1"
                return (
                    f"Thought: There are numbers in the query — I'll delegate to the calculator agent.\n"
                    f"Action: delegate_to_agent\n"
                    f'Action Input: {{"agent_id": "calculator_agent", "task": "What is {a} plus {b}?"}}'
                )
            last_obs = self._last_observation(prompt)
            return f"Thought: I have enough information to answer.\nFinal Answer: {last_obs}"

        # Final answer after delegation or enough steps
        obs_list = re.findall(r"Observation:\s*(.+?)(?=\nThought:|\nAction:|\Z)", prompt, re.DOTALL)
        summary = obs_list[-1].strip() if obs_list else "Research complete."
        return f"Thought: I now have a complete answer.\nFinal Answer: {summary}"

    def _last_observation(self, prompt: str) -> str:
        obs = re.findall(r"Observation:\s*(.+?)(?=\nThought:|\nAction:|\Z)", prompt, re.DOTALL)
        return obs[-1].strip().replace('"', "'").replace('\n', ' ')[:120] if obs else "no data"

    def _extract_question(self, prompt: str) -> str:
        for pattern in [r"Question:\s*(.+?)(?:\n|$)", r"Human:\s*(.+?)(?:\n|$)"]:
            m = re.search(pattern, prompt, re.DOTALL)
            if m:
                return m.group(1).strip()
        return prompt[-300:]

    def _get_registered_agents(self) -> list:
        try:
            import sys, os
            sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
            import state
            return list(state.agents.keys())
        except Exception:
            return []
