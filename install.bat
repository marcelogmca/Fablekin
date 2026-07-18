@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" if not "%ROOT:~-2,1%"==":" set "ROOT=%ROOT:~0,-1%"
set "INSTALL_SCRIPT=%ROOT%\engine\scripts\install_windows.ps1"

cd /d "%ROOT%"

if not exist "%INSTALL_SCRIPT%" (
    echo Could not find "%INSTALL_SCRIPT%".
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%INSTALL_SCRIPT%" -Root "%ROOT%" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo Fablekin setup did not complete successfully.
    pause
)

exit /b %EXIT_CODE%
