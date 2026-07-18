@echo off
setlocal EnableExtensions

cd /d "%~dp0"
title Fablekin Sprite Generator

set "PYTHON=%CD%\.venv\Scripts\python.exe"
set "ENTRYPOINT=%CD%\gui_api.py"
set "SETUP_SCRIPT=%CD%\setup_sprite_generator.ps1"
set "HF_HOME=%CD%\weights\huggingface"
set "HF_HUB_DISABLE_SYMLINKS_WARNING=1"
set "U2NET_HOME=%CD%\weights\rembg"

if not exist "%ENTRYPOINT%" (
    echo.
    echo [Sprite Generator] Could not find:
    echo   %ENTRYPOINT%
    echo.
    echo Keep this launcher in the tools\Sprite_Generator folder.
    pause
    exit /b 1
)

if not exist "%SETUP_SCRIPT%" (
    echo.
    echo [Sprite Generator] Could not find setup_sprite_generator.ps1.
    echo Keep the complete Sprite_Generator folder together.
    pause
    exit /b 1
)

where powershell.exe >nul 2>nul
if errorlevel 1 (
    echo.
    echo [Sprite Generator] Windows PowerShell was not found.
    echo Install or repair Windows PowerShell, then run this launcher again.
    pause
    exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SETUP_SCRIPT%"
if errorlevel 1 (
    echo.
    echo [Sprite Generator] Startup checks did not complete.
    echo Follow the instructions above, then run this launcher again.
    pause
    exit /b 1
)

rem Setup verified the local Hugging Face models; normal runtime stays offline.
set "HF_HUB_OFFLINE=1"
if /i "%~1"=="--setup-only" exit /b 0

rem A venv created from Conda needs its base runtime paths to locate Tcl/Tk.
rem Standard python.org virtual environments skip this block.
set "PYTHON_BASE="
for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"home = " "%CD%\.venv\pyvenv.cfg"') do set "PYTHON_BASE=%%B"
for /f "tokens=*" %%I in ("%PYTHON_BASE%") do set "PYTHON_BASE=%%I"
if exist "%PYTHON_BASE%\conda-meta" (
    set "CONDA_PREFIX=%PYTHON_BASE%"
    for %%I in ("%PYTHON_BASE%") do set "CONDA_DEFAULT_ENV=%%~nxI"
    set "CONDA_SHLVL=1"
    set "PATH=%PYTHON_BASE%;%PYTHON_BASE%\Library\mingw-w64\bin;%PYTHON_BASE%\Library\usr\bin;%PYTHON_BASE%\Library\bin;%PYTHON_BASE%\Scripts;%PYTHON_BASE%\bin;%PATH%"
)

"%PYTHON%" "%ENTRYPOINT%"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [Sprite Generator] The application exited with error code %EXIT_CODE%.
    echo Review the message above and the troubleshooting section in README.md.
    pause
)

exit /b %EXIT_CODE%
