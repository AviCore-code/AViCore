@echo off
rem AviCore Auto Import - install the PC sync + Browse helper on THIS PC.
rem Double-click this file. It needs no administrator rights.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-pc-sync.ps1"
if errorlevel 1 goto :fail
type "%ProgramData%\AviCoreSync\id_ed25519.pub" | clip
echo.
echo ============================================================
echo  Done. The key line above is COPIED to the clipboard.
echo  Paste it to Claude (the AviCore chat) so this PC can send
echo  files to the AviCore server. Then open AviCore Admin -
echo  Auto Import and press Browse.
echo ============================================================
pause
exit /b 0
:fail
echo Installation failed - send a photo of this window to Claude.
pause
exit /b 1
