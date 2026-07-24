# Installer for the gdrive single binary (Windows, decision 0003)
# Usage: irm https://raw.githubusercontent.com/ncukondo/gdrive-cli/main/install.ps1 | iex
#
# Environment:
#   GDRIVE_CLI_VERSION      pin a release tag (e.g. v0.2.0); default: latest
#   GDRIVE_CLI_INSTALL_DIR  install location; default: %LOCALAPPDATA%\gdrive-cli

$ErrorActionPreference = "Stop"

$Repo = "ncukondo/gdrive-cli"
$InstallDir = if ($env:GDRIVE_CLI_INSTALL_DIR) { $env:GDRIVE_CLI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "gdrive-cli" }
$BinaryName = "gdrive.exe"

function Write-Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host $msg -ForegroundColor Green }
function Write-Err($msg) {
    Write-Host "error: $msg" -ForegroundColor Red
    exit 1
}

function Get-LatestVersion {
    $url = "https://api.github.com/repos/$Repo/releases/latest"
    try {
        $release = Invoke-RestMethod -Uri $url -Headers @{ "User-Agent" = "gdrive-cli-installer" }
        return $release.tag_name
    } catch {
        Write-Err "Could not fetch latest version from GitHub."
    }
}

function Verify-Checksum($version, $filename, $dest) {
    $url = "https://github.com/$Repo/releases/download/$version/SHA256SUMS"
    try {
        $ProgressPreference = "SilentlyContinue"
        $sums = (Invoke-WebRequest -Uri $url -UseBasicParsing).Content
    } catch {
        Write-Info "Skipping checksum verification (SHA256SUMS not found in release)."
        return
    }
    $line = $sums -split "`n" | Where-Object { $_ -match [regex]::Escape($filename) } | Select-Object -First 1
    if (-not $line) {
        Write-Info "Skipping checksum verification (no entry for $filename)."
        return
    }
    $expected = ($line -split "\s+")[0].ToLower()
    $actual = (Get-FileHash -Path $dest -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) {
        Remove-Item -Path $dest -Force
        Write-Err "Checksum mismatch for $filename (expected $expected, got $actual)."
    }
    Write-Info "Checksum verified."
}

function Download-Binary($version, $dest) {
    $filename = "gdrive-windows-x64.exe"
    $url = "https://github.com/$Repo/releases/download/$version/$filename"
    Write-Info "Downloading $filename ($version)..."
    try {
        $ProgressPreference = "SilentlyContinue"
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
    } catch {
        Write-Err "Download failed. Check that release $version exists with binary $filename."
    }
    Verify-Checksum $version $filename $dest
}

function Configure-Path($dir) {
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -split ";" | Where-Object { $_ -eq $dir }) {
        return
    }
    Write-Info "Adding $dir to user PATH..."
    $newPath = "$currentPath;$dir"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$dir;$env:Path"
    Write-Info "  PATH updated (takes effect in new terminals)"
}

function Main {
    $version = if ($env:GDRIVE_CLI_VERSION) { $env:GDRIVE_CLI_VERSION } else { Get-LatestVersion }
    if (-not $version) {
        Write-Err "Could not determine latest version. Set `$env:GDRIVE_CLI_VERSION='v0.x.x' to install a specific version."
    }
    Write-Info "Detected platform: windows-x64"
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    $dest = Join-Path $InstallDir $BinaryName
    Download-Binary $version $dest
    Configure-Path $InstallDir
    try {
        $ver = & $dest --version 2>&1
        Write-Success "Installed gdrive $ver to $dest"
    } catch {
        Write-Err "Installation completed but binary verification failed"
    }
    if (-not (Get-Command gdrive -ErrorAction SilentlyContinue)) {
        Write-Host ""
        Write-Info "Restart your terminal to use the 'gdrive' command."
    }
}

Main
