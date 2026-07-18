"""Persistence helpers for loading/saving Sprite Generator state."""

import copy
import json
import os
from typing import Any


def load_env_key(base_dir: str, key_name: str = "API_KEY") -> str | None:
    """Load API key from .env in the provided directory."""
    env_path = os.path.join(base_dir, ".env")
    if not os.path.exists(env_path):
        return None

    try:
        with open(env_path, "r", encoding="utf-8") as env_file:
            for line in env_file:
                line = line.strip()
                if line.startswith(f"{key_name}="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        return None
    return None


def save_state_file(state_file: str, state: dict[str, Any]) -> None:
    """Persist state to JSON while stripping sensitive API keys."""
    save_data = copy.deepcopy(state)
    if "config" in save_data and "api_key" in save_data["config"]:
        del save_data["config"]["api_key"]

    with open(state_file, "w", encoding="utf-8") as state_out:
        json.dump(save_data, state_out, indent=4)


def load_state_file(state_file: str) -> dict[str, Any]:
    """Read state JSON from disk. Returns an empty dict when missing."""
    if not os.path.exists(state_file):
        return {}

    with open(state_file, "r", encoding="utf-8") as state_in:
        return json.load(state_in)
