# Write the project version (package.json "version", the single source of truth)
# into the fnOS package manifest (student-management-system/manifest).
# Usage: powershell -ExecutionPolicy Bypass -File sync-version.ps1 `
#          -From ..\package.json -Manifest .\student-management-system\manifest
# NOTE: keep this file ASCII-only (Windows PowerShell 5.1 reads .ps1 as ANSI
#       when there is no BOM, so non-ASCII literals would be garbled).
param(
  [Parameter(Mandatory = $true)][string]$From,
  [Parameter(Mandatory = $true)][string]$Manifest
)

$fromPath = (Resolve-Path -LiteralPath $From).Path
$manifestPath = (Resolve-Path -LiteralPath $Manifest).Path

$version = (Get-Content -LiteralPath $fromPath -Raw -Encoding UTF8 | ConvertFrom-Json).version
if (-not $version) {
  Write-Error ("no 'version' field in " + $fromPath)
  exit 1
}
$version = ([string]$version).Trim()

$lines = @(Get-Content -LiteralPath $manifestPath)
$found = $false
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^\s*version\s*=') {
    $lines[$i] = 'version               = ' + $version
    $found = $true
  }
}
if (-not $found) { $lines += ('version               = ' + $version) }

# write UTF-8 (no BOM) + LF, matching the rest of the package
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, (($lines -join "`n") + "`n"), $utf8)

Write-Host ("    manifest version -> " + $version)
