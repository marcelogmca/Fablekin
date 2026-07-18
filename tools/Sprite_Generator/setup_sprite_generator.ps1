[CmdletBinding()]
param([switch]$Force)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$VenvDirectory = Join-Path $PSScriptRoot ".venv"
$VenvPython = Join-Path $VenvDirectory "Scripts\python.exe"
$MarkerFile = Join-Path $VenvDirectory ".fablekin-requirements"
$HealthMarkerFile = Join-Path $VenvDirectory ".fablekin-health"
$env:HF_HOME = Join-Path $PSScriptRoot "weights\huggingface"
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
$env:U2NET_HOME = Join-Path $PSScriptRoot "weights\rembg"
$CondaBase = $null

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "[Sprite Generator] $Message" -ForegroundColor Cyan
}

function Stop-Setup([string]$Message) {
    Write-Host ""
    Write-Host "[Sprite Generator] Setup could not continue." -ForegroundColor Red
    Write-Host $Message -ForegroundColor Yellow
    exit 1
}

function Test-Python312([string]$Executable, [string[]]$PrefixArguments) {
    try {
        $probe = & $Executable @PrefixArguments -c "import struct,sys; print(f'{sys.version_info.major}.{sys.version_info.minor}|{struct.calcsize(chr(80))*8}')" 2>$null
        return $LASTEXITCODE -eq 0 -and $probe -eq "3.12|64"
    }
    catch {
        return $false
    }
}

function Find-Python312 {
    $launcher = Get-Command "py" -ErrorAction SilentlyContinue
    if ($launcher -and (Test-Python312 $launcher.Source @("-3.12"))) {
        return [pscustomobject]@{ Executable = $launcher.Source; Arguments = @("-3.12") }
    }

    foreach ($commandName in @("python3.12", "python")) {
        $command = Get-Command $commandName -ErrorAction SilentlyContinue
        if ($command -and (Test-Python312 $command.Source @())) {
            return [pscustomobject]@{ Executable = $command.Source; Arguments = @() }
        }
    }
    return $null
}

function Enable-CondaRuntime {
    $configPath = Join-Path $VenvDirectory "pyvenv.cfg"
    if (-not (Test-Path -LiteralPath $configPath)) { return }

    $homeLine = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^home\s*=' } | Select-Object -First 1
    if (-not $homeLine) { return }

    $pythonBase = ($homeLine -split '=', 2)[1].Trim()
    if (-not (Test-Path -LiteralPath (Join-Path $pythonBase "conda-meta"))) { return }

    $script:CondaBase = $pythonBase
    $env:CONDA_PREFIX = $pythonBase
    $env:CONDA_DEFAULT_ENV = Split-Path -Leaf $pythonBase
    $env:CONDA_SHLVL = "1"
    $runtimePaths = @(
        $pythonBase,
        (Join-Path $pythonBase "Library\mingw-w64\bin"),
        (Join-Path $pythonBase "Library\usr\bin"),
        (Join-Path $pythonBase "Library\bin"),
        (Join-Path $pythonBase "Scripts"),
        (Join-Path $pythonBase "bin")
    )
    $env:PATH = ($runtimePaths -join ';') + ';' + $env:PATH
}

Write-Host "Fablekin Sprite Generator - startup check" -ForegroundColor White

if (-not (Test-Path -LiteralPath $VenvPython)) {
    if (Test-Path -LiteralPath $VenvDirectory) {
        Stop-Setup "The .venv folder exists but is incomplete. Remove that folder, then run the launcher again. No project images or settings are stored there."
    }

    Write-Step "Looking for 64-bit Python 3.12"
    $sourcePython = Find-Python312
    if (-not $sourcePython) {
        Stop-Setup @"
64-bit Python 3.12 was not found. Python is never installed automatically.

Install Python 3.12 from:
  https://www.python.org/downloads/windows/

During installation, enable "Add python.exe to PATH", then run this launcher again.
"@
    }

    Write-Step "Creating the isolated .venv environment"
    & $sourcePython.Executable @($sourcePython.Arguments) -m venv $VenvDirectory
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $VenvPython)) {
        Stop-Setup "Python was found, but it could not create .venv. Check the error above and confirm that the Python venv component is installed."
    }
}

$venvProbe = & $VenvPython -c "import struct,sys; print(f'{sys.version_info.major}.{sys.version_info.minor}|{struct.calcsize(chr(80))*8}')" 2>$null
if ($LASTEXITCODE -ne 0 -or $venvProbe -ne "3.12|64") {
    Stop-Setup "The existing .venv is not 64-bit Python 3.12. Remove .venv and run the launcher again to rebuild it with the supported Python version."
}
Write-Host "  [OK] 64-bit Python 3.12 and .venv" -ForegroundColor Green

Enable-CondaRuntime

$nvidiaCommand = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
$hasNvidia = $false
if ($nvidiaCommand) {
    & $nvidiaCommand.Source -L 2>$null | Out-Null
    $hasNvidia = $LASTEXITCODE -eq 0
}
if ($hasNvidia) {
    $RequirementsFile = Join-Path $PSScriptRoot "requirements.txt"
    $HardwareMode = "NVIDIA CUDA 12.8"
}
else {
    $RequirementsFile = Join-Path $PSScriptRoot "requirements-cpu.txt"
    $HardwareMode = "CPU-only (slower)"
}
Write-Host "  [OK] Runtime mode: $HardwareMode" -ForegroundColor Green

if (-not (Test-Path -LiteralPath $RequirementsFile)) {
    Stop-Setup "Missing dependency file: $RequirementsFile"
}

$requirementsName = Split-Path -Leaf $RequirementsFile
$requirementsHash = (Get-FileHash -LiteralPath $RequirementsFile -Algorithm SHA256).Hash
$expectedMarker = "$requirementsName`:$requirementsHash"
$installedMarker = if (Test-Path -LiteralPath $MarkerFile) {
    (Get-Content -LiteralPath $MarkerFile -Raw).Trim()
} else { "" }

$dependencyCheck = "import importlib.util,sys; modules=('cv2','numpy','scipy','requests','rembg','onnxruntime','spandrel','torch','torchvision','anime_face_detector','PIL'); missing=[m for m in modules if importlib.util.find_spec(m) is None]; print('Missing modules: '+', '.join(missing)) if missing else None; sys.exit(bool(missing))"
$dependenciesReady = $false
$environmentChanged = $false
if (-not $Force -and $installedMarker -eq $expectedMarker) {
    & $VenvPython -c $dependencyCheck 2>$null
    $importsPassed = $LASTEXITCODE -eq 0
    if ($importsPassed) {
        & $VenvPython -m pip check | Out-Host
        $dependenciesReady = $LASTEXITCODE -eq 0
    }
}

if (-not $dependenciesReady) {
    Write-Step "Installing or repairing Python dependencies"
    & $VenvPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) {
        Stop-Setup "pip could not be updated. Check the network or proxy error above."
    }
    & $VenvPython -m pip install -r $RequirementsFile
    if ($LASTEXITCODE -ne 0) {
        Stop-Setup "Required packages could not be installed. Check the pip error above, your internet connection, and available disk space."
    }
    & $VenvPython -c $dependencyCheck
    if ($LASTEXITCODE -ne 0) {
        Stop-Setup "Packages were installed, but one or more required imports still fail."
    }
    & $VenvPython -m pip check
    if ($LASTEXITCODE -ne 0) {
        Stop-Setup "pip reports conflicting or broken dependencies."
    }
    Set-Content -LiteralPath $MarkerFile -Value $expectedMarker -Encoding Ascii
    $environmentChanged = $true
} else {
    Write-Host "  [OK] Python dependencies" -ForegroundColor Green
}

Write-Step "Checking processing models"
$modelsChanged = $false
& $VenvPython (Join-Path $PSScriptRoot "prepare_models.py") --check
if ($LASTEXITCODE -ne 0) {
    Write-Host "Missing models will now be downloaded. This can require roughly 1.3 GB." -ForegroundColor Yellow
    & $VenvPython (Join-Path $PSScriptRoot "prepare_models.py")
    if ($LASTEXITCODE -ne 0) {
        Stop-Setup "One or more processing models could not be downloaded or verified. Check the network error above."
    }
    $modelsChanged = $true
}

$verifyScript = Join-Path $PSScriptRoot "verify_runtime.py"
$verifyHash = (Get-FileHash -LiteralPath $verifyScript -Algorithm SHA256).Hash
$driverSignature = if ($hasNvidia) {
    ((& nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>$null) -join '|').Trim()
} else {
    "CPU"
}
$expectedHealthMarker = "$expectedMarker|$verifyHash|$HardwareMode|$driverSignature"
$installedHealthMarker = if (Test-Path -LiteralPath $HealthMarkerFile) {
    (Get-Content -LiteralPath $HealthMarkerFile -Raw).Trim()
} else { "" }

if (-not $Force -and -not $environmentChanged -and -not $modelsChanged -and $installedHealthMarker -eq $expectedHealthMarker) {
    Write-Host "  [OK] Runtime health check (cached)" -ForegroundColor Green
} else {
    Write-Step "Running final health check"
    Enable-CondaRuntime
    $healthArguments = @($verifyScript)
    if ($hasNvidia) { $healthArguments += "--expect-cuda" }
    & $VenvPython @healthArguments
    if ($LASTEXITCODE -ne 0) {
        Stop-Setup "The final runtime health check failed. Review the traceback above."
    }
    Set-Content -LiteralPath $HealthMarkerFile -Value $expectedHealthMarker -Encoding Ascii
}

Write-Host ""
Write-Host "[Sprite Generator] Everything is ready." -ForegroundColor Green
exit 0
