@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" if not "%ROOT:~-2,1%"==":" set "ROOT=%ROOT:~0,-1%"
set "ENGINE_DIR=%ROOT%\engine"
set "RUNTIME_ROOT=%ENGINE_DIR%\.runtime"
set "APP_DIR=%RUNTIME_ROOT%\fablekin-electron"
set "RCEDIT_DIR=%RUNTIME_ROOT%\rcedit"
set "ICON_PNG=%ENGINE_DIR%\icon.png"
set "ICON_ICO=%RUNTIME_ROOT%\fablekin.ico"
set "SOURCE_ELECTRON=%ENGINE_DIR%\node_modules\electron\dist"
set "FABLEKIN_EXE=%APP_DIR%\Fablekin.exe"
set "VERSION_MARKER=%APP_DIR%\.electron-version"
set "PREPARE_ONLY="

if /i "%~1"=="--prepare-only" set "PREPARE_ONLY=1"
if /i "%~1"=="/prepare-only" set "PREPARE_ONLY=1"

cd /d "%ROOT%"

if not exist "%ENGINE_DIR%\package.json" (
    echo Could not find engine\package.json.
    pause
    exit /b 1
)

for /f "usebackq delims=" %%v in (`node -p "require('./engine/package-lock.json').packages['node_modules/electron'].version" 2^>nul`) do set "ELECTRON_VERSION=%%v"
if not defined ELECTRON_VERSION set "ELECTRON_VERSION=unknown"

if not exist "%SOURCE_ELECTRON%\electron.exe" (
    echo Electron runtime missing.
    echo.
    echo Fablekin has not been set up yet, or engine\node_modules is incomplete.
    echo Please use the guided installer so Windows installs, downloads, and repairs
    echo are explained before they happen.
    echo.
    if defined PREPARE_ONLY (
        echo Setup is required before runtime preparation can continue.
        echo Run install.bat from this folder, then try run.bat again.
        exit /b 1
    )
    if not exist "%ROOT%\install.bat" (
        echo Could not find install.bat.
        pause
        exit /b 1
    )
    set /p RUN_INSTALL="Run guided setup now? [Y/N]: "
    if /i not "!RUN_INSTALL!"=="Y" if /i not "!RUN_INSTALL!"=="YES" (
        echo Setup skipped. Run install.bat when you are ready.
        pause
        exit /b 1
    )
    call "%ROOT%\install.bat"
    if errorlevel 1 (
        echo Guided setup did not complete successfully.
        pause
        exit /b 1
    )
)

if not exist "%SOURCE_ELECTRON%\electron.exe" (
    echo Could not find "%SOURCE_ELECTRON%\electron.exe".
    pause
    exit /b 1
)

set "CACHED_VERSION="
if exist "%VERSION_MARKER%" set /p CACHED_VERSION=<"%VERSION_MARKER%"
if not exist "%FABLEKIN_EXE%" set "CACHED_VERSION="
if /i not "%CACHED_VERSION%"=="%ELECTRON_VERSION%" (
    echo Preparing branded Electron runtime...
    if exist "%APP_DIR%" rmdir /s /q "%APP_DIR%"
    mkdir "%APP_DIR%" >nul 2>nul
    robocopy "%SOURCE_ELECTRON%" "%APP_DIR%" /E /NFL /NDL /NJH /NJS /NC /NS >nul
    if errorlevel 8 (
        echo Failed to copy Electron runtime.
        pause
        exit /b 1
    )
    ren "%APP_DIR%\electron.exe" "Fablekin.exe"
    >"%VERSION_MARKER%" echo %ELECTRON_VERSION%
)

if not exist "%ICON_PNG%" (
    echo Could not find "%ICON_PNG%".
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "& '%ENGINE_DIR%\scripts\create_fablekin_ico.ps1' -SourcePng '%ICON_PNG%' -OutputIco '%ICON_ICO%'" >nul 2>nul
if errorlevel 1 (
    echo Failed to create icon resource.
    pause
    exit /b 1
)

if not exist "%RCEDIT_DIR%\node_modules\rcedit\bin\rcedit-x64.exe" (
    echo Installing rcedit helper...
    mkdir "%RCEDIT_DIR%" >nul 2>nul
    pushd "%RCEDIT_DIR%"
    if not exist "package.json" call npm init -y >nul
    call npm install --no-audit --no-fund rcedit@5.0.2
    if errorlevel 1 (
        popd
        echo Failed to install rcedit.
        pause
        exit /b 1
    )
    popd
)

set "RCEDIT_EXE=%RCEDIT_DIR%\node_modules\rcedit\bin\rcedit-x64.exe"
if not exist "%RCEDIT_EXE%" (
    echo Could not find rcedit executable.
    pause
    exit /b 1
)

"%RCEDIT_EXE%" "%FABLEKIN_EXE%" ^
    --set-icon "%ICON_ICO%" ^
    --set-version-string "FileDescription" "Fablekin" ^
    --set-version-string "ProductName" "Fablekin" ^
    --set-version-string "InternalName" "Fablekin" ^
    --set-version-string "OriginalFilename" "Fablekin.exe" ^
    --set-version-string "CompanyName" "Fablekin" >nul 2>nul
if errorlevel 1 (
    echo Warning: could not refresh Fablekin.exe resources right now.
)

if defined PREPARE_ONLY (
    echo Prepared "%FABLEKIN_EXE%".
    exit /b 0
)

echo.
echo   FFFFF   AAA   BBBB   L      EEEEE  K   K  III  N   N
echo   F      A   A  B   B  L      E      K  K    I   NN  N
echo   FFF    AAAAA  BBBB   L      EEE    KKK     I   N N N
echo   F      A   A  B   B  L      E      K  K    I   N  NN
echo   F      A   A  BBBB   LLLLL  EEEEE  K   K  III  N   N
echo.
node "%ENGINE_DIR%\scripts\launch_fablekin.js" --cwd "%ROOT%" --exe "%FABLEKIN_EXE%" --main "%ENGINE_DIR%\main.js" %*
if errorlevel 1 (
    echo.
    echo There was a problem launching Fablekin.
    pause
    exit /b 1
)

exit 0
