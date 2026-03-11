"""Vercel serverless entry point — imports the FastAPI app from backend/."""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from main import app  # noqa: F401  — Vercel picks up `app` automatically
