#!/bin/bash
# Spark-TTS API Launcher

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- Activate Conda ---
CONDA_BASE=$(conda info --base 2>/dev/null)
if [ $? -eq 0 ] && [ -f "$CONDA_BASE/etc/profile.d/conda.sh" ]; then
    source "$CONDA_BASE/etc/profile.d/conda.sh"
    conda activate sparktts
else
    # Fallback
    conda activate sparktts 2>/dev/null || echo "Warning: Could not auto-detect conda."
fi

# --- Run API ---
python tts_api.py --port 8000 --parallel 1
