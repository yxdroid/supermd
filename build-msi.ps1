param(
  [switch]$Install,
  [switch]$NoBuild,
  [switch]$OpenOutput,
  [switch]$ForceWixRefresh
)

$ErrorActionPreference = "Stop"
$WixVersion = "3.14.1"
$WixNugetUrl = "https://www.nuget.org/api/v2/package/wix/$WixVersion"
$WixCacheDir = Join-Path $env:LOCALAPPDATA "tauri\WixTools314"
$WixDownloadDir = Join-Path $env:LOCALAPPDATA "supermd\downloads"
$WixPackagePath = Join-Path $WixDownloadDir "wix.$WixVersion.nupkg"
$WixExtractDir = Join-Path $WixDownloadDir "wix.$WixVersion"

Set-Location -LiteralPath $PSScriptRoot

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Get-VsDevCmdPath {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path -LiteralPath $vswhere)) {
    throw "vswhere.exe not found. Install Visual Studio Build Tools first."
  }

  $installationPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if (-not $installationPath) {
    throw "No Visual Studio Build Tools installation with C++ tools was found."
  }

  $vsDevCmd = Join-Path $installationPath "Common7\Tools\VsDevCmd.bat"
  if (-not (Test-Path -LiteralPath $vsDevCmd)) {
    throw "VsDevCmd.bat not found at: $vsDevCmd"
  }

  return $vsDevCmd
}

function Invoke-CmdChain {
  param([string]$CommandLine)

  & cmd.exe /c $CommandLine
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE"
  }
}

function Test-WixTools {
  param([string]$Directory)

  (Test-Path -LiteralPath (Join-Path $Directory "candle.exe")) -and
  (Test-Path -LiteralPath (Join-Path $Directory "light.exe"))
}

function Install-WixTools {
  if ((Test-WixTools $WixCacheDir) -and (-not $ForceWixRefresh)) {
    return $WixCacheDir
  }

  Write-Host "==> Preparing WiX Toolset $WixVersion" -ForegroundColor Cyan

  Add-Type -AssemblyName System.IO.Compression.FileSystem

  if ($ForceWixRefresh) {
    Remove-Item -LiteralPath $WixCacheDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $WixExtractDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $WixPackagePath -Force -ErrorAction SilentlyContinue
  }

  New-Item -ItemType Directory -Path $WixDownloadDir -Force | Out-Null

  if (-not (Test-Path -LiteralPath $WixPackagePath)) {
    Write-Host "Downloading WiX from NuGet: $WixNugetUrl" -ForegroundColor DarkCyan
    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest -Uri $WixNugetUrl -OutFile $WixPackagePath -TimeoutSec 1800
  }

  if (Test-Path -LiteralPath $WixExtractDir) {
    Remove-Item -LiteralPath $WixExtractDir -Recurse -Force
  }
  if (Test-Path -LiteralPath $WixCacheDir) {
    Remove-Item -LiteralPath $WixCacheDir -Recurse -Force
  }

  New-Item -ItemType Directory -Path $WixExtractDir -Force | Out-Null
  New-Item -ItemType Directory -Path $WixCacheDir -Force | Out-Null

  [System.IO.Compression.ZipFile]::ExtractToDirectory($WixPackagePath, $WixExtractDir)
  Copy-Item -Path (Join-Path $WixExtractDir "tools\*") -Destination $WixCacheDir -Recurse -Force

  if (-not (Test-WixTools $WixCacheDir)) {
    throw "WiX extraction failed. Expected candle.exe and light.exe in: $WixCacheDir"
  }

  return $WixCacheDir
}

Require-Command node
Require-Command npm

if ($Install -or -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules"))) {
  Write-Host "==> Installing npm dependencies" -ForegroundColor Cyan
  npm install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with exit code $LASTEXITCODE"
  }
}

$vsDevCmd = Get-VsDevCmdPath
$wixDir = Install-WixTools
$bundleOutput = Join-Path $PSScriptRoot "src-tauri\target\release\bundle\msi"

if ($NoBuild) {
  Write-Host "Validation passed." -ForegroundColor Green
  Write-Host "VsDevCmd: $vsDevCmd"
  Write-Host "WiX tools: $wixDir"
  Write-Host "MSI output: $bundleOutput"
  exit 0
}

Write-Host "==> Building MSI package" -ForegroundColor Cyan
Invoke-CmdChain "`"$vsDevCmd`" && cd /d `"$PSScriptRoot`" && npm run tauri:build -- --bundles msi"

if (-not (Test-Path -LiteralPath $bundleOutput)) {
  throw "Build finished but MSI output folder was not found: $bundleOutput"
}

$msiFiles = Get-ChildItem -LiteralPath $bundleOutput -Filter *.msi -File -ErrorAction SilentlyContinue
if (-not $msiFiles) {
  throw "Build finished but no .msi file was found in: $bundleOutput"
}

Write-Host "==> MSI created" -ForegroundColor Green
$msiFiles | ForEach-Object { Write-Host $_.FullName }

if ($OpenOutput) {
  Start-Process explorer.exe $bundleOutput
}
