@echo off
setlocal

cd /d "%~dp0"
title Depth Slicer

if not exist ".venv\Scripts\python.exe" (
    echo.
    echo [Depth Slicer] Virtual environment not found.
    echo Expected: %CD%\.venv\Scripts\python.exe
    echo.
    echo Create it and install the dependencies first:
    echo   py -3.12 -m venv .venv
    echo   .venv\Scripts\python.exe -m pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

call ".venv\Scripts\activate.bat"
python "depth_slicer.py"

if errorlevel 1 (
    echo.
    echo [Depth Slicer] The application exited with an error.
    echo.
    pause
    exit /b 1
)

endlocal
