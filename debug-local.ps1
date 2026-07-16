param(
  [ValidateSet("web", "tauri")]
  [string]$Mode = "web",

  [switch]$Install,

  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Invoke-Step {
  param(
    [string]$Label,
    [scriptblock]$Action
  )

  Write-Host "==> $Label" -ForegroundColor Cyan
  & $Action
}

Require-Command node
Require-Command npm

$packageJsonPath = Join-Path $PSScriptRoot "package.json"
if (-not (Test-Path -LiteralPath $packageJsonPath)) {
  throw "package.json not found. Run this script from the supermd project root."
}

$nodeModulesPath = Join-Path $PSScriptRoot "node_modules"
if ($Install -or -not (Test-Path -LiteralPath $nodeModulesPath)) {
  Invoke-Step "Installing dependencies" {
    npm install
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed with exit code $LASTEXITCODE"
    }
  }
}

switch ($Mode) {
  "web" {
    $command = "npm run dev"
  }
  "tauri" {
    $tauriConfigPath = Join-Path $PSScriptRoot "src-tauri\tauri.conf.json"
    if (-not (Test-Path -LiteralPath $tauriConfigPath)) {
      throw "src-tauri is incomplete or missing. Restore src-tauri before using -Mode tauri."
    }
    $command = "npm run tauri:dev"
  }
  default {
    throw "Unsupported mode: $Mode"
  }
}

if ($NoStart) {
  Write-Host "Validation passed. Ready to run: $command" -ForegroundColor Green
  exit 0
}

Invoke-Step "Starting $Mode debug server" {
  if ($Mode -eq "web") {
    npm run dev
  } else {
    npm run tauri:dev
  }

  if ($LASTEXITCODE -ne 0) {
    throw "$command failed with exit code $LASTEXITCODE"
  }
}
