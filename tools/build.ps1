# =============================================================================
#  castButtonRemover - build
#
#  Produces, in build/:
#    castButtonRemover_v<version>.zip   the extension folder, zipped for Load unpacked
#    castButtonRemover_v<version>.crx   the same files, signed with key.pem
#
#  The zip's root is a folder named castButtonRemover, so unzipping it leaves a
#  folder to point Load unpacked at instead of loose files. Entry names use
#  forward slashes; CreateFromDirectory would write backslashes on Windows.
#
#  The two inlined copies of the hide rules (CSS_TEXT in main-world.js, KNOWN in
#  dom-guard.js) are regenerated from content/hide.css first, so the packaged
#  scripts cannot drift from the stylesheet.
#
#  The signing key is created on first build and then reused. It fixes the
#  extension ID: keep key.pem out of the repository and back it up elsewhere.
#
#  Usage:
#    powershell -ExecutionPolicy Bypass -File tools\build.ps1
#    powershell -ExecutionPolicy Bypass -File tools\build.ps1 -SkipCrx
# =============================================================================

[CmdletBinding()]
param(
    [switch] $SkipCrx
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectName     = 'castButtonRemover'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot     = Split-Path -Parent $scriptDirectory
$extensionDir    = Join-Path $projectRoot 'extension'
$buildDir        = Join-Path $projectRoot 'build'
$keyPath         = Join-Path $projectRoot 'key.pem'

function Remove-ToRecycleBin {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Add-Type -AssemblyName Microsoft.VisualBasic
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
        $Path, 'OnlyErrorDialogs', 'SendToRecycleBin')
}

# --- the hide rules inside the scripts ---------------------------------------
& node (Join-Path $scriptDirectory 'hide-rules.js')
if ($LASTEXITCODE -ne 0) { throw 'tools\hide-rules.js failed' }

$manifest = Get-Content (Join-Path $extensionDir 'manifest.json') -Raw | ConvertFrom-Json
$version  = $manifest.version
if (-not $version) { throw 'extension\manifest.json has no version' }
if ($manifest.name -ne $projectName) { throw "manifest name is '$($manifest.name)', expected '$projectName'" }

New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
$zipPath = Join-Path $buildDir "${projectName}_v$version.zip"
$crxPath = Join-Path $buildDir "${projectName}_v$version.crx"

# Chrome writes extension/_metadata when the folder has been loaded unpacked;
# it is browser state, not part of the extension.
$files = Get-ChildItem -LiteralPath $extensionDir -Recurse -File |
    Where-Object { $_.FullName -notmatch '[\\/]_metadata[\\/]' } |
    Sort-Object FullName

# --- the zip -----------------------------------------------------------------
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

Remove-ToRecycleBin $zipPath
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($extensionDir.Length + 1).Replace('\', '/')
        $entry = $zip.CreateEntry("$projectName/$relative", [System.IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = $file.LastWriteTime
        $stream = $entry.Open()
        try {
            $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally {
            $stream.Dispose()
        }
    }
} finally {
    $zip.Dispose()
}

$zipCheck = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $names = $zipCheck.Entries | ForEach-Object { $_.FullName }
} finally {
    $zipCheck.Dispose()
}
if ($names | Where-Object { $_ -match '\\' }) {
    throw 'zip contains backslash entry names'
}
if ($names.Count -ne $files.Count) {
    throw "zip holds $($names.Count) files, extension has $($files.Count)"
}

# --- the crx -----------------------------------------------------------------
if (-not $SkipCrx) {
    if (-not (Test-Path -LiteralPath $keyPath)) {
        & node (Join-Path $scriptDirectory 'make-key.js') $keyPath
    }
    $crx3 = Get-Command 'crx3.cmd' -ErrorAction SilentlyContinue
    if (-not $crx3) {
        Write-Warning 'crx3 is not installed (npm install -g crx3); skipping the .crx'
    } else {
        Remove-ToRecycleBin $crxPath
        & $crx3.Source -p $keyPath -o $crxPath $extensionDir
        if (-not (Test-Path -LiteralPath $crxPath)) { throw 'crx3 did not write the .crx' }
        $magic = [System.Text.Encoding]::ASCII.GetString(
            [System.IO.File]::ReadAllBytes($crxPath), 0, 4)
        if ($magic -ne 'Cr24') { throw "the .crx does not start with Cr24 (got '$magic')" }
    }
}

# --- report ------------------------------------------------------------------
$zipSize = (Get-Item -LiteralPath $zipPath).Length
Write-Host ("Zip  {0}  ({1:N0} bytes, {2} files)" -f $zipPath, $zipSize, $names.Count)
if (Test-Path -LiteralPath $crxPath) {
    $crxSize = (Get-Item -LiteralPath $crxPath).Length
    Write-Host ("Crx  {0}  ({1:N0} bytes)" -f $crxPath, $crxSize)
}
