$ErrorActionPreference = "Continue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$reportsDir = Join-Path $scriptDir "reports"
New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null

if (-not $env:npm_config_cache) {
    $env:npm_config_cache = Join-Path (Split-Path -Parent $projectRoot) ".npm-cache"
}

pushd $projectRoot

function Try-ReadJsonFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    try {
        return (Get-Content $Path -Raw | ConvertFrom-Json)
    } catch {
        Write-Warning "Invalid JSON in $Path. Skipping post-filtering for this file."
        return $null
    }
}

function Count-ObjectProperties {
    param($Value)
    if ($null -eq $Value) { return 0 }
    return @($Value.PSObject.Properties).Count
}

Write-Host "Running ESLint..."
npx eslint . --ext .js,.cjs,.mjs --config "$scriptDir/eslint.config.js" -f json -o "$reportsDir/eslint.json"
$eslintExit = $LASTEXITCODE

Write-Host "Running Knip..."
npx knip --config "$scriptDir/knip.json" --reporter json | Set-Content -Encoding utf8 "$reportsDir/knip.json"
$knipExit = $LASTEXITCODE

Write-Host "Running Depcheck..."
npx depcheck --json | Set-Content -Encoding utf8 "$reportsDir/depcheck.json"
$depcheckExit = $LASTEXITCODE

Write-Host "Applying ignore filters (plugins/disabled/*, graphology-utils)..."
$depcheckIgnoredDependencies = @(
    "@xterm/xterm",
    "@xterm/addon-fit"
)

# Filter ESLint report: ignore files under plugins/disabled
$eslint = Try-ReadJsonFile "$reportsDir/eslint.json"
if ($null -ne $eslint) {
    $eslintFiltered = @($eslint | Where-Object { $_.filePath -notmatch "[\\/]plugins[\\/]disabled[\\/]" })
    $eslintFiltered | ConvertTo-Json -Depth 100 | Set-Content "$reportsDir/eslint.json"
}

# Filter Knip report: ignore issue entries under plugins/disabled
$knip = Try-ReadJsonFile "$reportsDir/knip.json"
if ($null -ne $knip -and $knip.PSObject.Properties.Name -contains "issues") {
    $knip.issues = @($knip.issues | Where-Object { $_.file -notmatch "^[\\/]?plugins[\\/]disabled[\\/]" })
}
if ($null -ne $knip) {
    $knip | ConvertTo-Json -Depth 100 | Set-Content "$reportsDir/knip.json"
}

# Filter Depcheck report:
# - ignore invalid files under plugins/disabled
# - ignore missing dependency "graphology-utils"
$depcheck = Try-ReadJsonFile "$reportsDir/depcheck.json"
if ($null -ne $depcheck) {

        if ($depcheck.invalidFiles) {
            $filteredInvalidFiles = @{}
            foreach ($prop in $depcheck.invalidFiles.PSObject.Properties) {
                if ($prop.Name -notmatch "[\\/]plugins[\\/]disabled[\\/]") {
                    $filteredInvalidFiles[$prop.Name] = $prop.Value
                }
            }
            $depcheck.invalidFiles = $filteredInvalidFiles
        }

    if ($depcheck.missing) {
        $filteredMissing = @{}
        foreach ($prop in $depcheck.missing.PSObject.Properties) {
            if ($prop.Name -ne "graphology-utils") {
                $filteredMissing[$prop.Name] = $prop.Value
                }
            }
        $depcheck.missing = $filteredMissing
    }

    if ($depcheck.dependencies) {
        $depcheck.dependencies = @($depcheck.dependencies | Where-Object { $_ -notin $depcheckIgnoredDependencies })
    }

    $depcheck | ConvertTo-Json -Depth 100 | Set-Content "$reportsDir/depcheck.json"
}

$eslintFindings = 0
$eslint = Try-ReadJsonFile "$reportsDir/eslint.json"
if ($null -ne $eslint) {
    foreach ($fileReport in @($eslint)) {
        $eslintFindings += [int]($fileReport.errorCount + $fileReport.warningCount)
    }
}

$knipFindings = 0
$knip = Try-ReadJsonFile "$reportsDir/knip.json"
if ($null -ne $knip -and $knip.PSObject.Properties.Name -contains "issues") {
    $knipFindings = @($knip.issues).Count
}

$depcheckFindings = 0
$depcheck = Try-ReadJsonFile "$reportsDir/depcheck.json"
if ($null -ne $depcheck) {
    $depcheckFindings += @($depcheck.dependencies).Count
    $depcheckFindings += @($depcheck.devDependencies).Count
    $depcheckFindings += Count-ObjectProperties $depcheck.missing
    $depcheckFindings += Count-ObjectProperties $depcheck.invalidFiles
    $depcheckFindings += Count-ObjectProperties $depcheck.invalidDirs
}

Write-Host ""
Write-Host "Reports generated:"
Write-Host " - $reportsDir/eslint.json"
Write-Host " - $reportsDir/knip.json"
Write-Host " - $reportsDir/depcheck.json"
Write-Host ""
Write-Host "Findings after filters:"
Write-Host " - ESLint:   $eslintFindings"
Write-Host " - Knip:     $knipFindings"
Write-Host " - Depcheck: $depcheckFindings"
Write-Host ""
Write-Host "Raw tool exit codes:"
Write-Host " - ESLint:   $eslintExit"
Write-Host " - Knip:     $knipExit"
Write-Host " - Depcheck: $depcheckExit"
popd
