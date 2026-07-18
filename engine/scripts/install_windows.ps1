param(
    [string]$Root,
    [switch]$AssumeYes,
    [switch]$SkipOllama,
    [switch]$SkipNpmInstall,
    [switch]$SkipRuntimePrepare
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:StepIndex = 0
$script:TotalSteps = 8
$script:LogFile = $null

function Resolve-Root {
    param([string]$Candidate)

    if ([string]::IsNullOrWhiteSpace($Candidate)) {
        return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    }

    return (Resolve-Path $Candidate).Path
}

function Initialize-Log {
    param([string]$ProjectRoot)

    $logDir = Join-Path $ProjectRoot 'workspace\logs'
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $script:LogFile = Join-Path $logDir "install-$timestamp.log"
    "Fablekin setup log - $(Get-Date -Format 'u')" | Out-File -FilePath $script:LogFile -Encoding UTF8
}

function Write-Log {
    param([string]$Message)

    if ($script:LogFile) {
        $line = "[$(Get-Date -Format 'HH:mm:ss')] $Message"
        Add-Content -Path $script:LogFile -Value $line -Encoding UTF8
    }
}

function Write-Info {
    param([string]$Message)

    Write-Host "  $Message"
    Write-Log $Message
}

function Write-Warn {
    param([string]$Message)

    Write-Host "  Warning: $Message" -ForegroundColor Yellow
    Write-Log "Warning: $Message"
}

function Write-Fail {
    param([string]$Message)

    Write-Host "  Error: $Message" -ForegroundColor Red
    Write-Log "Error: $Message"
}

function Start-Step {
    param([string]$Title)

    $script:StepIndex += 1
    Write-Host ''
    Write-Host "[Fablekin Setup] Step $($script:StepIndex)/$($script:TotalSteps): $Title" -ForegroundColor Cyan
    Write-Log "Step $($script:StepIndex)/$($script:TotalSteps): $Title"
}

function Confirm-Action {
    param(
        [string]$Title,
        [string[]]$ReasonLines
    )

    Write-Host ''
    Write-Host $Title -ForegroundColor Yellow
    foreach ($line in $ReasonLines) {
        Write-Host "  $line"
    }

    if ($AssumeYes) {
        Write-Info 'Auto-approval enabled with -AssumeYes.'
        return $true
    }

    while ($true) {
        $answer = Read-Host 'Continue? [Y/N]'
        switch -Regex ($answer) {
            '^(y|yes)$' { return $true }
            '^(n|no)$' { return $false }
            default { Write-Host 'Please enter Y or N.' }
        }
    }
}

function Get-CommandPath {
    param([string]$Name)

    if (Test-IsWindows -and ($Name -notmatch '\.(exe|cmd|bat|ps1)$')) {
        foreach ($candidate in @("$Name.cmd", "$Name.exe", "$Name.bat")) {
            $windowsCommand = Get-Command $candidate -ErrorAction SilentlyContinue
            if ($windowsCommand) { return $windowsCommand.Source }
        }
    }

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return $null
}

function Update-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = @($machinePath, $userPath) -join ';'
}

function Invoke-LoggedCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [switch]$AllowFailure
    )

    $argumentText = ($Arguments | ForEach-Object {
        if ($_ -match '\s') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    }) -join ' '

    Write-Info "Running: $FilePath $argumentText"
    Write-Info "Working folder: $WorkingDirectory"
    Write-Log "Working directory: $WorkingDirectory"

    Push-Location $WorkingDirectory
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
            $script:PreviousPSNativeCommandUseErrorActionPreference = $PSNativeCommandUseErrorActionPreference
            $global:PSNativeCommandUseErrorActionPreference = $false
        }
        $commandOutput = & $FilePath @Arguments 2>&1
        $exitCode = $LASTEXITCODE
        $commandOutput | ForEach-Object {
            $line = [string]$_
            Write-Host "    $line"
            Write-Log $line
        }
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        if (Get-Variable -Name PreviousPSNativeCommandUseErrorActionPreference -Scope Script -ErrorAction SilentlyContinue) {
            $global:PSNativeCommandUseErrorActionPreference = $script:PreviousPSNativeCommandUseErrorActionPreference
            Remove-Variable -Name PreviousPSNativeCommandUseErrorActionPreference -Scope Script -ErrorAction SilentlyContinue
        }
        Pop-Location
    }

    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "Command failed with exit code ${exitCode}: $FilePath $argumentText"
    }

    return $exitCode
}

function Get-CommandOutput {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    try {
        $output = & $FilePath @Arguments 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        return (($output | Out-String).Trim())
    } catch {
        return $null
    }
}

function Parse-Version {
    param([string]$VersionText)

    if ($VersionText -match '(\d+)\.(\d+)\.(\d+)') {
        return [version]("{0}.{1}.{2}" -f $Matches[1], $Matches[2], $Matches[3])
    }
    if ($VersionText -match 'v?(\d+)\.(\d+)') {
        return [version]("{0}.{1}.0" -f $Matches[1], $Matches[2])
    }
    return $null
}

function Test-IsWindows {
    return [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
}

function Test-HttpReachable {
    param(
        [string]$Url,
        [int]$TimeoutSec = 3
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -Method Head -TimeoutSec $TimeoutSec -UseBasicParsing
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
    } catch {
        $status = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $status = $_.Exception.Response.StatusCode.value__
        }
        if ($status -and $status -lt 500) { return $true }
        return $false
    }
}

function Get-OllamaSettings {
    param([string]$ProjectRoot)

    $settingsPath = Join-Path $ProjectRoot 'workspace\settings.json'
    $result = @{
        BaseUrl = 'http://127.0.0.1:11434'
        Model = 'nomic-embed-text'
        Source = 'defaults'
    }

    if (-not (Test-Path $settingsPath)) {
        return $result
    }

    try {
        $settings = Get-Content -Raw $settingsPath | ConvertFrom-Json
        $ollama = $settings.infrastructure.providers.ollama
        if ($ollama.base_url) { $result.BaseUrl = [string]$ollama.base_url }
        if ($ollama.model) { $result.Model = [string]$ollama.model }
        $result.Source = $settingsPath
    } catch {
        Write-Warn "Could not read Ollama settings from workspace\settings.json. Using defaults."
        Write-Log $_.Exception.Message
    }

    return $result
}

function Install-WithWinget {
    param(
        [string]$PackageId,
        [string]$DisplayName
    )

    $winget = Get-CommandPath 'winget'
    if (-not $winget) {
        throw "winget is not available. Please install $DisplayName manually, then rerun install.bat."
    }

    Invoke-LoggedCommand -FilePath $winget -Arguments @(
        'install',
        '--id', $PackageId,
        '--exact',
        '--accept-package-agreements',
        '--accept-source-agreements'
    ) -WorkingDirectory $ProjectRoot

    Update-ProcessPath
}

function Get-EngineNodeModulesIssues {
    param([string]$EngineDir)

    $nodeModules = Join-Path $EngineDir 'node_modules'
    if (-not (Test-Path $nodeModules)) {
        return @()
    }

    $issues = @()
    $electronExe = Join-Path $nodeModules 'electron\dist\electron.exe'
    if (-not (Test-Path $electronExe)) {
        $issues += 'Electron is missing from engine\node_modules, so run.bat cannot prepare the runtime.'
    }

    $progressIndex = Join-Path $nodeModules 'progress\index.js'
    $progressLib = Join-Path $nodeModules 'progress\lib\node-progress.js'
    if ((Test-Path $progressIndex) -and -not (Test-Path $progressLib)) {
        $issues += 'The progress package is incomplete; this is the dependency ffmpeg-static failed to load.'
    }

    return $issues
}

function Move-EngineNodeModulesAside {
    param([string]$EngineDir)

    $nodeModules = Join-Path $EngineDir 'node_modules'
    if (-not (Test-Path $nodeModules)) {
        return
    }

    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupNodeModules = Join-Path $EngineDir "node_modules.broken-$timestamp"
    Write-Info "Moving engine\node_modules to $backupNodeModules"
    try {
        Move-Item -LiteralPath $nodeModules -Destination $backupNodeModules -ErrorAction Stop
    } catch {
        throw "Could not move engine\node_modules. Close any programs using this repo, then rerun install.bat. Details: $($_.Exception.Message)"
    }
}

function RepairNodeModules {
    param(
        [string]$EngineDir,
        [string[]]$ExtraReasonLines
    )

    if ($ExtraReasonLines) {
        foreach ($line in $ExtraReasonLines) {
            Write-Info $line
        }
    }

    Write-Info 'Repairing engine\node_modules automatically. Project files, settings, lore, assets, and story databases are not touched.'
    Move-EngineNodeModulesAside -EngineDir $EngineDir
}

function Ensure-Node {
    param([version]$MinimumVersion)

    $nodePath = Get-CommandPath 'node'
    $nodeVersionText = if ($nodePath) { Get-CommandOutput -FilePath $nodePath -Arguments @('-v') -WorkingDirectory $ProjectRoot } else { $null }
    $nodeVersion = if ($nodeVersionText) { Parse-Version $nodeVersionText } else { $null }

    if ($nodePath -and $nodeVersion -and $nodeVersion -ge $MinimumVersion) {
        Write-Info "Found Node.js $nodeVersionText at $nodePath."
        return
    }

    $why = @(
        'Fablekin is an Electron app, and Electron dependencies are installed through Node.js.',
        "Required version: Node.js $MinimumVersion or newer.",
        'The installer will use winget to install OpenJS.NodeJS.LTS.'
    )
    if ($nodeVersionText) {
        $why = @("Found Node.js $nodeVersionText, but Fablekin needs $MinimumVersion or newer.") + $why
    }

    if (-not (Confirm-Action -Title 'Node.js needs to be installed or updated.' -ReasonLines $why)) {
        throw 'Node.js is required. Setup stopped at user request.'
    }

    Install-WithWinget -PackageId 'OpenJS.NodeJS.LTS' -DisplayName 'Node.js LTS'

    $nodePath = Get-CommandPath 'node'
    $nodeVersionText = if ($nodePath) { Get-CommandOutput -FilePath $nodePath -Arguments @('-v') -WorkingDirectory $ProjectRoot } else { $null }
    $nodeVersion = if ($nodeVersionText) { Parse-Version $nodeVersionText } else { $null }
    if (-not $nodePath -or -not $nodeVersion -or $nodeVersion -lt $MinimumVersion) {
        throw 'Node.js was installed, but this shell still cannot find a usable node command. Reopen the terminal and rerun install.bat.'
    }

    Write-Info "Node.js is ready: $nodeVersionText."
}

function Ensure-Npm {
    $npmPath = Get-CommandPath 'npm'
    $npmVersion = if ($npmPath) { Get-CommandOutput -FilePath $npmPath -Arguments @('-v') -WorkingDirectory $ProjectRoot } else { $null }

    if ($npmPath -and $npmVersion) {
        Write-Info "Found npm $npmVersion at $npmPath."
        return
    }

    Update-ProcessPath
    $npmPath = Get-CommandPath 'npm'
    $npmVersion = if ($npmPath) { Get-CommandOutput -FilePath $npmPath -Arguments @('-v') -WorkingDirectory $ProjectRoot } else { $null }
    if ($npmPath -and $npmVersion) {
        Write-Info "Found npm $npmVersion after refreshing PATH."
        return
    }

    throw 'npm was not found. It normally installs with Node.js LTS; please repair/reinstall Node.js, then rerun install.bat.'
}

function Ensure-NpmPackages {
    if ($SkipNpmInstall) {
        Write-Info 'Skipping npm install because -SkipNpmInstall was provided.'
        return
    }

    $engineDir = Join-Path $ProjectRoot 'engine'
    $packageJson = Join-Path $engineDir 'package.json'

    if (-not (Test-Path $packageJson)) {
        throw 'Could not find engine\package.json.'
    }

    $npm = Get-CommandPath 'npm'

    $why = @(
        'This downloads the JavaScript parts Fablekin needs to run.',
        'The package list lives at engine\package.json.',
        'The downloaded packages are placed in engine\node_modules.',
        'The command will run from the engine folder as: npm install',
        'It may take several minutes on the first run.'
    )
    if (-not (Confirm-Action -Title 'Install Fablekin engine packages into engine\node_modules?' -ReasonLines $why)) {
        throw 'Engine package installation is required. Setup stopped at user request.'
    }

    # PowerShell unwraps an empty pipeline result to $null. Keep the result as an
    # array so a clean install (where node_modules does not exist yet) has Count 0.
    $existingIssues = @(Get-EngineNodeModulesIssues -EngineDir $engineDir)
    if ($existingIssues.Count -gt 0) {
        RepairNodeModules -EngineDir $engineDir -ExtraReasonLines @(
            'Fablekin found an existing engine\node_modules folder, but it looks incomplete.',
            'This usually happens after an interrupted install, a locked Windows folder, or a previous npm failure.',
            'The installer will move it aside and create a fresh dependency folder.'
        ) + $existingIssues
    }

    $exitCode = Invoke-LoggedCommand -FilePath $npm -Arguments @('install') -WorkingDirectory $engineDir -AllowFailure
    if ($exitCode -eq 0) {
        return
    }

    $nodeModules = Join-Path $engineDir 'node_modules'
    if (-not (Test-Path $nodeModules)) {
        throw "npm install failed with exit code $exitCode. See the install log for details."
    }

    RepairNodeModules -EngineDir $engineDir -ExtraReasonLines @(
        "npm install failed with exit code $exitCode.",
        'A common Windows cause is a half-installed or locked engine\node_modules folder.',
        'The installer will move engine\node_modules aside and retry with a fresh dependency folder.'
    )

    Invoke-LoggedCommand -FilePath $npm -Arguments @('install') -WorkingDirectory $engineDir
}

function Prepare-Runtime {
    if ($SkipRuntimePrepare) {
        Write-Info 'Skipping Electron runtime preparation because -SkipRuntimePrepare was provided.'
        return
    }

    $runBat = Join-Path $ProjectRoot 'run.bat'
    if (-not (Test-Path $runBat)) {
        throw 'Could not find run.bat.'
    }

    Write-Info 'Preparing the branded Fablekin Electron runtime.'
    Invoke-LoggedCommand -FilePath $runBat -Arguments @('--prepare-only') -WorkingDirectory $ProjectRoot
}

function Ensure-Ollama {
    param([hashtable]$OllamaSettings)

    if ($SkipOllama) {
        Write-Info 'Skipping Ollama setup because -SkipOllama was provided.'
        return
    }

    $ollama = Get-CommandPath 'ollama'
    $ollamaVersion = if ($ollama) { Get-CommandOutput -FilePath $ollama -Arguments @('--version') -WorkingDirectory $ProjectRoot } else { $null }

    if ($ollama -and $ollamaVersion) {
        Write-Info "Found $ollamaVersion at $ollama."
    } else {
        $why = @(
            'Fablekin uses Ollama to run a local embedding model for searchable lore and story memory.',
            'The installer will use winget to install Ollama.Ollama.',
            'Ollama may start a local service on http://127.0.0.1:11434.'
        )
        if (-not (Confirm-Action -Title 'Ollama is not installed.' -ReasonLines $why)) {
            throw 'Ollama is required for local embeddings. Setup stopped at user request.'
        }

        Install-WithWinget -PackageId 'Ollama.Ollama' -DisplayName 'Ollama'
        $ollama = Get-CommandPath 'ollama'
        $ollamaVersion = if ($ollama) { Get-CommandOutput -FilePath $ollama -Arguments @('--version') -WorkingDirectory $ProjectRoot } else { $null }
        if (-not $ollama) {
            throw 'Ollama was installed, but this shell still cannot find the ollama command. Reopen the terminal and rerun install.bat.'
        }
        Write-Info "Ollama is ready: $ollamaVersion."
    }

    if (-not (Test-HttpReachable -Url $OllamaSettings.BaseUrl -TimeoutSec 3)) {
        Write-Info "Ollama is not responding at $($OllamaSettings.BaseUrl). Trying to start it..."
        try {
            Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
        } catch {
            Write-Warn "Could not start Ollama automatically: $($_.Exception.Message)"
        }

        $reachable = $false
        for ($i = 1; $i -le 10; $i++) {
            Start-Sleep -Seconds 1
            if (Test-HttpReachable -Url $OllamaSettings.BaseUrl -TimeoutSec 3) {
                $reachable = $true
                break
            }
            Write-Info "Waiting for Ollama service... ($i/10)"
        }

        if (-not $reachable) {
            throw "Ollama is installed, but the service is not reachable at $($OllamaSettings.BaseUrl). Start Ollama, then rerun install.bat."
        }
    }

    Write-Info "Ollama health check passed at $($OllamaSettings.BaseUrl)."
}

function Ensure-OllamaModel {
    param([hashtable]$OllamaSettings)

    if ($SkipOllama) {
        Write-Info 'Skipping embedding model check because -SkipOllama was provided.'
        return
    }

    $ollama = Get-CommandPath 'ollama'
    $model = $OllamaSettings.Model
    Write-Info "Embedding model from $($OllamaSettings.Source): $model"

    $listOutput = Get-CommandOutput -FilePath $ollama -Arguments @('list') -WorkingDirectory $ProjectRoot
    if ($listOutput -and ($listOutput -match "(?m)^$([regex]::Escape($model))(\s|:|$)")) {
        Write-Info "Found Ollama model $model."
        return
    }

    $why = @(
        "Fablekin is configured to use '$model' for embeddings.",
        'This model is downloaded by Ollama and used for vector search/RAG.',
        'The download size depends on the model and may take a while.'
    )
    if (-not (Confirm-Action -Title "Download Ollama embedding model '$model'?" -ReasonLines $why)) {
        throw "Embedding model '$model' is required for local memory search. Setup stopped at user request."
    }

    Invoke-LoggedCommand -FilePath $ollama -Arguments @('pull', $model) -WorkingDirectory $ProjectRoot

    $listOutput = Get-CommandOutput -FilePath $ollama -Arguments @('list') -WorkingDirectory $ProjectRoot
    if (-not $listOutput -or -not ($listOutput -match "(?m)^$([regex]::Escape($model))(\s|:|$)")) {
        throw "Ollama model '$model' was pulled, but it did not appear in ollama list."
    }

    Write-Info "Ollama model $model is ready."
}

function Test-EmbeddingRequest {
    param([hashtable]$OllamaSettings)

    if ($SkipOllama) {
        return $true
    }

    try {
        $body = @{
            model = $OllamaSettings.Model
            prompt = 'Fablekin setup health check'
        } | ConvertTo-Json -Compress
        $url = ($OllamaSettings.BaseUrl.TrimEnd('/')) + '/api/embeddings'
        $response = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 30
        return ($response.embedding -and $response.embedding.Count -gt 0)
    } catch {
        Write-Warn "Embedding request failed: $($_.Exception.Message)"
        return $false
    }
}

function Final-HealthCheck {
    param([hashtable]$OllamaSettings)

    $engineNodeModules = Join-Path $ProjectRoot 'engine\node_modules'
    $electronExe = Join-Path $ProjectRoot 'engine\node_modules\electron\dist\electron.exe'
    $fablekinExe = Join-Path $ProjectRoot 'engine\.runtime\fablekin-electron\Fablekin.exe'

    $checks = @()
    $checks += @{ Name = 'Node.js'; Ok = [bool](Get-CommandPath 'node') }
    $checks += @{ Name = 'npm'; Ok = [bool](Get-CommandPath 'npm') }

    if (-not $SkipNpmInstall) {
        $checks += @{ Name = 'engine node_modules'; Ok = (Test-Path $engineNodeModules) }
        $checks += @{ Name = 'Electron package'; Ok = (Test-Path $electronExe) }
    }

    if (-not $SkipRuntimePrepare) {
        $checks += @{ Name = 'Fablekin.exe runtime'; Ok = (Test-Path $fablekinExe) }
    }

    if (-not $SkipOllama) {
        $checks += @{ Name = 'Ollama service'; Ok = (Test-HttpReachable -Url $OllamaSettings.BaseUrl -TimeoutSec 3) }
        $checks += @{ Name = 'Embedding API'; Ok = (Test-EmbeddingRequest -OllamaSettings $OllamaSettings) }
    }

    Write-Host ''
    Write-Host 'Setup summary' -ForegroundColor Cyan
    $failed = @()
    foreach ($check in $checks) {
        if ($check.Ok) {
            Write-Host "  [OK]   $($check.Name)" -ForegroundColor Green
            Write-Log "[OK] $($check.Name)"
        } else {
            Write-Host "  [FAIL] $($check.Name)" -ForegroundColor Red
            Write-Log "[FAIL] $($check.Name)"
            $failed += $check.Name
        }
    }

    if ($failed.Count -gt 0) {
        throw "Setup finished with failed checks: $($failed -join ', ')"
    }
}

$ProjectRoot = Resolve-Root $Root
Initialize-Log $ProjectRoot

try {
    Write-Host ''
    Write-Host 'Fablekin Windows Setup' -ForegroundColor Cyan
    Write-Host 'This guided installer checks local tools, asks before major installs/downloads, and prepares Fablekin for launch.'
    Write-Host "Log file: $script:LogFile"
    Write-Log "Project root: $ProjectRoot"

    Start-Step 'Preflight checks'
    if (-not (Test-IsWindows)) {
        throw 'This installer currently supports Windows only.'
    }
    if (-not (Test-Path (Join-Path $ProjectRoot 'engine\package.json'))) {
        throw 'Could not find engine\package.json. Please run install.bat from the Fablekin repo root.'
    }
    Write-Info "Project root: $ProjectRoot"
    Write-Info 'Preflight checks passed.'

    $ollamaSettings = Get-OllamaSettings -ProjectRoot $ProjectRoot

    Start-Step 'Checking Node.js'
    Ensure-Node -MinimumVersion ([version]'18.0.0')

    Start-Step 'Checking npm'
    Ensure-Npm

    Start-Step 'Installing Fablekin packages'
    Ensure-NpmPackages

    Start-Step 'Preparing Fablekin runtime'
    Prepare-Runtime

    Start-Step 'Checking Ollama'
    Ensure-Ollama -OllamaSettings $ollamaSettings

    Start-Step 'Checking embedding model'
    Ensure-OllamaModel -OllamaSettings $ollamaSettings

    Start-Step 'Final health check'
    Final-HealthCheck -OllamaSettings $ollamaSettings

    Write-Host ''
    Write-Host 'Fablekin setup is complete.' -ForegroundColor Green
    Write-Host 'Launch the app with run.bat.'
    Write-Host "Install log: $script:LogFile"
    exit 0
} catch {
    Write-Host ''
    Write-Fail $_.Exception.Message
    Write-Host "Install log: $script:LogFile"
    exit 1
}
