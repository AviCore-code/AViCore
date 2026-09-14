@echo off
REM Double-click this to build the AviCore Crew web app and deploy it to
REM Firebase Hosting in one go. First-time setup is required before this
REM works the first time - see FIREBASE-WEB-SETUP.md.
REM All output is also saved to deploy-web-log.txt for troubleshooting.
powershell -NoProfile -ExecutionPolicy Bypass -Command "& '%~dp0deploy-web.ps1' *>&1 | Tee-Object -FilePath '%~dp0deploy-web-log.txt'"
echo.
echo (A copy of this output was saved to deploy-web-log.txt in this folder.)
pause
