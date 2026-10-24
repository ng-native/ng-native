<#
.SYNOPSIS
  Sets up an ng-native workspace on a Windows machine: Git, Node, pnpm, the clone and its install.

.DESCRIPTION
  Checks for each tool CONTRIBUTING.md asks for and installs what is missing, then clones the
  repository (or uses the checkout the script sits in) and runs `pnpm install`.

  - Git, installed with winget when it is missing.
  - Node, at least the `engines.node` floor in package.json (>=22.18); the version in .nvmrc is the
    one installed. An nvm-windows or fnm install is used when there is one, winget otherwise.
  - pnpm, through corepack at the version `packageManager` pins. A Node without a bundled corepack
    gets it from npm.

  Runs under Windows PowerShell 5.1 and PowerShell 7, and is safe to run again: a step that is
  already done is skipped.

.PARAMETER Path
  Where to clone the repository. Defaults to $HOME\ng-native. Ignored when the script is run from
  inside a checkout, which is set up in place.

.PARAMETER Repo
  The repository to clone.

.PARAMETER Browser
  Also install the Chromium the browser test suite runs in (`pnpm coverage` needs it).

.PARAMETER Verify
  Also run `pnpm typecheck` once the install is done.

.EXAMPLE
  # Straight from GitHub, in a PowerShell prompt (Warp's default shell on Windows):
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/ng-native/ng-native/main/scripts/setup-windows.ps1)))

.EXAMPLE
  # From a checkout, with the browser suite and a typecheck:
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -Browser -Verify
#>
[CmdletBinding()]
param(
  [string]$Path = (Join-Path $HOME 'ng-native'),
  [string]$Repo = 'https://github.com/ng-native/ng-native.git',
  [switch]$Browser,
  [switch]$Verify
)

$ErrorActionPreference = 'Stop'

# The floor `engines.node` sets in package.json, and the major .nvmrc asks for when there is no
# checkout yet to read it from.
$NodeFloor = [version]'22.18.0'
$DefaultNodeMajor = 24

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "    $Message" -ForegroundColor Green }
function Write-Note([string]$Message) { Write-Host "    $Message" -ForegroundColor Yellow }

function Test-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# winget and the Node installers write PATH to the registry, not to this session.
function Update-SessionPath {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Invoke-Native([string]$What, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE." }
}

function Install-WithWinget([string]$Id, [string]$Name) {
  if (-not (Test-Command 'winget')) {
    throw "$Name is missing and winget is not available to install it. Install $Name yourself, or install App Installer from the Microsoft Store to get winget, then run this script again."
  }
  Write-Note "Installing $Name with winget ($Id)..."
  Invoke-Native "Installing $Name" {
    winget install --id $Id --exact --source winget --accept-package-agreements --accept-source-agreements --silent
  }
  Update-SessionPath
}

function Get-NodeVersion {
  if (-not (Test-Command 'node')) { return $null }
  $raw = & node --version
  if (-not $raw) { return $null }
  return [version]($raw.Trim().TrimStart('v'))
}

function Get-RepoRoot {
  # Run from scripts\ inside a checkout: set that checkout up instead of cloning a second one.
  if ($PSScriptRoot) {
    $candidate = Split-Path $PSScriptRoot -Parent
    $manifest = Join-Path $candidate 'package.json'
    if ((Test-Path $manifest) -and ((Get-Content $manifest -Raw) -match '"name":\s*"angular-native"')) {
      return $candidate
    }
  }
  return $null
}

if ($env:OS -ne 'Windows_NT') {
  throw 'This script sets up Windows. On macOS or Linux follow CONTRIBUTING.md.'
}

$checkout = Get-RepoRoot

# --- Git ----------------------------------------------------------------------------------------

Write-Step 'Git'
if (-not (Test-Command 'git')) {
  Install-WithWinget 'Git.Git' 'Git'
  if (-not (Test-Command 'git')) { throw 'Git was installed but is not on PATH yet. Open a new terminal and run this script again.' }
}
Write-Ok (& git --version)

# pnpm's store nests deep enough to pass Windows' 260-character limit.
$longPaths = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -ErrorAction SilentlyContinue).LongPathsEnabled
if ($longPaths -ne 1) {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($isAdmin) {
    Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -Value 1
    Write-Ok 'Enabled long paths in Windows.'
  } else {
    Write-Note 'Long paths are off in Windows. If the install fails on a long path, run this once in an admin PowerShell and try again:'
    Write-Note "  Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -Value 1"
  }
}

# --- Clone --------------------------------------------------------------------------------------

Write-Step 'Repository'
if ($checkout) {
  $root = $checkout
  Write-Ok "Using the checkout at $root"
} elseif (Test-Path (Join-Path $Path '.git')) {
  $root = (Resolve-Path $Path).Path
  Write-Ok "Already cloned at $root"
} elseif ((Test-Path $Path) -and (Get-ChildItem $Path -Force | Select-Object -First 1)) {
  throw "$Path exists and is not empty. Pass -Path to clone somewhere else."
} else {
  Invoke-Native 'git clone' { git clone -c core.longpaths=true $Repo $Path }
  $root = (Resolve-Path $Path).Path
  Write-Ok "Cloned into $root"
}
Invoke-Native 'git config' { git -C $root config core.longpaths true }

$nvmrc = Join-Path $root '.nvmrc'
$nodeMajor = $DefaultNodeMajor
if (Test-Path $nvmrc) { $nodeMajor = [int]((Get-Content $nvmrc -Raw).Trim().TrimStart('v').Split('.')[0]) }

# --- Node ---------------------------------------------------------------------------------------

Write-Step "Node (needs >= $NodeFloor, .nvmrc asks for $nodeMajor)"
$node = Get-NodeVersion
if (-not $node -or $node -lt $NodeFloor) {
  if ($node) { Write-Note "Node $node is older than $NodeFloor." }
  if (Test-Command 'nvm') {
    Write-Note "Installing Node $nodeMajor with nvm-windows..."
    Invoke-Native 'nvm install' { nvm install $nodeMajor }
    Invoke-Native 'nvm use' { nvm use $nodeMajor }
    Update-SessionPath
  } elseif (Test-Command 'fnm') {
    Write-Note "Installing Node $nodeMajor with fnm..."
    Invoke-Native 'fnm install' { fnm install $nodeMajor }
    Invoke-Native 'fnm default' { fnm default $nodeMajor }
    fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
  } elseif ($node) {
    if (-not (Test-Command 'winget')) { throw "Node $node is older than $NodeFloor. Upgrade it to Node $nodeMajor, then run this script again." }
    Write-Note 'Upgrading Node.js with winget...'
    winget upgrade --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements --silent
    if ($LASTEXITCODE -ne 0) {
      throw "winget could not upgrade Node $node (it may not have installed it). Uninstall it or upgrade it to Node $nodeMajor yourself, then run this script again."
    }
    Update-SessionPath
  } else {
    Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js LTS'
  }
  $node = Get-NodeVersion
  if (-not $node) { throw 'Node was installed but is not on PATH yet. Open a new terminal and run this script again.' }
  if ($node -lt $NodeFloor) { throw "Node $node is still first on PATH, and the workspace needs $NodeFloor or newer. Remove or upgrade it, then run this script again." }
}
Write-Ok "Node $node"
if ($node.Major -ne $nodeMajor) {
  Write-Note "The workspace runs on Node $nodeMajor (.nvmrc); $node is above the floor, so it will work, but CI uses $nodeMajor."
}

# --- pnpm ---------------------------------------------------------------------------------------

Write-Step 'pnpm (through corepack)'
# Node 25 and later no longer bundle corepack.
if (-not (Test-Command 'corepack')) {
  Write-Note 'corepack is not bundled with this Node; installing it from npm...'
  Invoke-Native 'npm install -g corepack' { npm install --global corepack }
  Update-SessionPath
}
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
# `corepack enable` writes its shims beside node.exe, which Program Files keeps read-only to a
# non-admin user. npm's global folder is on PATH and writable, so the shims go there instead.
# Windows PowerShell 5.1 turns a native command's stderr into a terminating error under 'Stop'.
$ErrorActionPreference = 'Continue'
& corepack enable 2>&1 | Out-Null
$enabled = $LASTEXITCODE -eq 0
$ErrorActionPreference = 'Stop'
if (-not $enabled) {
  $shims = Join-Path $env:APPDATA 'npm'
  New-Item -ItemType Directory -Force -Path $shims | Out-Null
  Invoke-Native 'corepack enable' { corepack enable --install-directory $shims }
  if (-not (($env:Path -split ';') -contains $shims)) { $env:Path = "$shims;$env:Path" }
}
Push-Location $root
try {
  # The first run downloads pnpm and may print about it before the version.
  $pnpm = & corepack pnpm --version | Select-Object -Last 1
  if ($LASTEXITCODE -ne 0 -or -not $pnpm) { throw 'corepack could not fetch pnpm.' }
  $pnpm = "$pnpm".Trim()
  Write-Ok "pnpm $pnpm"

  # --- Install ----------------------------------------------------------------------------------

  Write-Step 'pnpm install'
  Invoke-Native 'pnpm install' { corepack pnpm install }

  if ($Browser) {
    Write-Step 'Chromium for the browser test suite'
    Invoke-Native 'playwright install' { corepack pnpm --filter '@ng-native/web' exec playwright install chromium }
  }

  if ($Verify) {
    Write-Step 'pnpm typecheck'
    Invoke-Native 'pnpm typecheck' { corepack pnpm typecheck }
  }
} finally {
  Pop-Location
}

Write-Step 'Done'
Write-Ok "The workspace is ready at $root"
Write-Host @"

    cd $root
    pnpm test                       # the full seam against a fake Fabric
    pnpm verify                     # every check CI makes, before opening a pull request
    pnpm --filter canary start      # the canary app, in Expo Go on an Android phone or emulator

    Open a new terminal first if pnpm is not found: the PATH changes only reach new ones.
"@
