# Builds the Enterprise Web admin app (dist-admin/) and deploys it to its OWN
# Firebase Hosting site (separate URL from the Crew app), using the separate
# firebase-admin.json config so the Crew deploy (deploy-web.ps1) is never
# touched. Read-only monitoring build - see src/web/AdminWebApp.jsx.
#
# ONE-TIME SETUP (do this once, in a terminal, before the first deploy):
#   1) npm install -g firebase-tools     (if you don't have it yet)
#   2) firebase login                    (if not already logged in)
#   3) firebase hosting:sites:create avicore-admin --project uoa-ftl-monitor
#      ^ creates the admin site. If you pick a different name, change "site"
#        in firebase-admin.json to match.
# After that, just double-click deploy-admin.bat each time to publish.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Fail($msg) {
    Write-Host ""
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

# See deploy-web.ps1 for why native commands are run with EAP relaxed.
function RunNative([string]$displayName, [scriptblock]$block) {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { & $block } finally { $ErrorActionPreference = $prevEAP }
    if ($LASTEXITCODE -ne 0) {
        Fail "$displayName failed (exit code $LASTEXITCODE) - see the output above."
    }
}

Write-Host "=== AviCore Enterprise - Admin Web Deploy (read-only) ===" -ForegroundColor Cyan

# --- Check firebase-tools is installed ---
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$firebaseVersion = & firebase --version 2>$null
$ErrorActionPreference = $prevEAP
if ($LASTEXITCODE -ne 0 -or -not $firebaseVersion) {
    Fail "Firebase CLI not found. Run this once first: npm install -g firebase-tools"
}
Write-Host "Firebase CLI: $firebaseVersion"

# --- Check this machine is logged in to Firebase ---
# Advisory only - see the long comment on the same block in deploy-web.ps1:
# `firebase projects:list` can crash on Windows (exit -1073740791) on a CLI
# that deploys perfectly well, so a failure here must not block the deploy.
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$loginInfo = & firebase login:list 2>&1
$loginExit = $LASTEXITCODE
$ErrorActionPreference = $prevEAP

if ($loginExit -ne 0) {
    Write-Host "WARNING: could not verify Firebase login (exit code $loginExit) - continuing anyway." -ForegroundColor Yellow
    Write-Host "         If the deploy below fails with an auth error, run: firebase login --reauth" -ForegroundColor Yellow
} elseif ($loginInfo -match "No authorized accounts") {
    Fail "Not logged in to Firebase on this machine. Run this once first: firebase login"
} else {
    Write-Host "Firebase login: OK"
}

# --- Build ---
Write-Host ""
Write-Host "Building admin web app (npm run build:admin)..." -ForegroundColor Cyan
RunNative "Build" { npm run build:admin }

if (-not (Test-Path "dist-admin/index.html")) {
    Fail "Build finished but dist-admin/index.html is missing - something is wrong with the build output."
}

# --- Deploy (to the separate admin site via firebase-admin.json) ---
Write-Host ""
Write-Host "Deploying to the admin Hosting site..." -ForegroundColor Cyan
Write-Host "(If this fails with 'site not found', run the one-time setup at the top of this file.)" -ForegroundColor Yellow
RunNative "Deploy" { firebase deploy --only hosting --config firebase-admin.json --project uoa-ftl-monitor }

Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Green
Write-Host "Admin monitor is live at the URL Firebase printed above (e.g. https://avicore-admin.web.app)."
Write-Host "Reminder: it's PIN-gated (see src/config/adminWebPin.js) and read-only."
