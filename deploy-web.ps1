# Builds the AviCore Crew web app (dist-web/) and deploys it to Firebase
# Hosting in one step. Requires one-time setup first - see the "First-time
# setup" section in the printed instructions below, or FIREBASE-WEB-SETUP.md.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Fail($msg) {
    Write-Host ""
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

# Runs a native command (firebase, npm, ...) with $ErrorActionPreference
# temporarily relaxed. Without this, PowerShell treats ANY line a native
# command writes to stderr - including harmless progress/status text like
# Firebase CLI's "Preparing the list of your Firebase projects..." - as a
# terminating error while $ErrorActionPreference = "Stop" is active, even
# though the command actually succeeded. Real failures are still caught
# below via $LASTEXITCODE, which native commands set correctly regardless.
function RunNative([string]$displayName, [scriptblock]$block) {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $block
    } finally {
        $ErrorActionPreference = $prevEAP
    }
    if ($LASTEXITCODE -ne 0) {
        Fail "$displayName failed (exit code $LASTEXITCODE) - see the output above."
    }
}

Write-Host "=== AviCore Crew - Web Deploy ===" -ForegroundColor Cyan

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
# Advisory only, never fatal. This used to run `firebase projects:list` and
# abort on a non-zero exit - but that command makes a network call and some
# firebase-tools/Node combinations on Windows CRASH inside it (exit code
# -1073740791 = 0xC0000409, "stack buffer overrun") even though the CLI is
# perfectly able to deploy. Failing the whole script there blocked a deploy
# that would have worked. So: use the cheap local `firebase login:list`
# (reads the saved credentials, no network), and if it doesn't come back
# clean just warn and carry on - the deploy step below is the real check and
# gives a clear "not logged in" error of its own if that's genuinely it.
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

# --- Check a project is linked (.firebaserc) ---
if (-not (Test-Path ".firebaserc")) {
    Fail "No Firebase project linked yet. Run this once first: firebase use --add"
}

# --- Build ---
Write-Host ""
Write-Host "Building web app (npm run build:web)..." -ForegroundColor Cyan
RunNative "Build" { npm run build:web }

if (-not (Test-Path "dist-web/index.html")) {
    Fail "Build finished but dist-web/index.html is missing - something is wrong with the build output."
}

# --- Deploy ---
Write-Host ""
Write-Host "Deploying to Firebase Hosting..." -ForegroundColor Cyan
RunNative "Deploy" { firebase deploy --only hosting --project uoa-ftl-monitor }

Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Green
Write-Host "Your pilots can now open the URL Firebase just printed above in any browser."
