@echo off
REM Double-click this to build the AviCore Enterprise admin web app and deploy
REM it to its own Firebase Hosting site (separate URL from the Crew app).
REM First-time setup is required once - see the top of deploy-admin.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-admin.ps1"
echo.
pause
