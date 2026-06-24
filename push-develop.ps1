param(
    [Parameter(Position = 0)]
    [string]$Message = "Auto update"
)

$ErrorActionPreference = "Stop"

# Ensure we run from this script's repository root.
Set-Location -Path $PSScriptRoot

# Verify we are in a git repository.
$null = git rev-parse --is-inside-work-tree 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Not inside a git repository."
    exit 1
}

# Stage all changes.
git add -A

# If nothing is staged, exit cleanly.
$staged = git diff --cached --name-only
if (-not $staged) {
    Write-Host "No changes to commit."
    exit 0
}

# Commit and push to develop.
git commit -m $Message
git push origin develop

if ($LASTEXITCODE -eq 0) {
    Write-Host "Pushed latest changes to develop."
}
