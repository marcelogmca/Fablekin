#!/bin/bash
# IndexTTS2 API Launcher

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- Activate venv ---
if [ -f ".venv/bin/activate" ]; then
    source ".venv/bin/activate"
elif [ -f ".venv/Scripts/activate" ]; then
    source ".venv/Scripts/activate"
else
    echo "Error: .venv not found."
    exit 1
fi

# --- Run API ---
python tts_api.py --port 8000 --parallel 1
