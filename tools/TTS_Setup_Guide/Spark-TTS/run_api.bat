@echo off
title Spark-TTS API Launcher
cd /d "%~dp0"

REM --- Activate Conda ---
echo Activating conda environment 'sparktts'...
call conda activate sparktts

if errorlevel 1 (
    echo Error: Failed to activate conda environment 'sparktts'.
    pause
    exit /b
)

REM --- Run API ---
python tts_api.py --port 8000 --parallel 1

pause
