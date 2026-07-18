@echo off
title IndexTTS2 API Launcher
cd /d "%~dp0"

REM --- Activate venv ---
if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
) else (
    echo Error: .venv not found.
    pause
    exit /b
)

REM --- Run API ---
python tts_api.py --port 8000 --parallel 1

pause
