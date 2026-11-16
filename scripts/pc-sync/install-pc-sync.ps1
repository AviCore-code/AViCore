# Installs the AviCore Auto Import PC sync on this Windows PC (run once):
#   powershell -ExecutionPolicy Bypass -File install-pc-sync.ps1
# - copies avicore-pc-sync.ps1 to %ProgramData%\AviCoreSync
# - creates the sync key (id_ed25519) if missing and prints its public key
#   (add it to the VPS: /home/avicoreimport/.ssh/authorized_keys)
# - registers the scheduled task "AviCore Auto Import Sync" (every 5 minutes,
#   while this user is signed in, hidden window)

$ErrorActionPreference = "Stop"
$Base = Join-Path $env:ProgramData "AviCoreSync"
New-Item -ItemType Directory -Force -Path $Base | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot "avicore-pc-sync.ps1") (Join-Path $Base "avicore-pc-sync.ps1")

$Key = Join-Path $Base "id_ed25519"
if (-not (Test-Path $Key)) {
  # Start-Process passes the argument string as written, so -N "" really is an
  # empty passphrase (Windows PowerShell drops a bare "" argument).
  Start-Process -FilePath (Join-Path $env:SystemRoot "System32\OpenSSH\ssh-keygen.exe") -Wait -NoNewWindow `
    -ArgumentList ("-q -t ed25519 -N `"`" -C avicore-pc-sync@{0} -f `"{1}`"" -f $env:COMPUTERNAME, $Key)
}
# The private key must be readable by this user only, or OpenSSH refuses it.
icacls $Key /inheritance:r /grant:r "$($env:USERNAME):(R)" "SYSTEM:(F)" | Out-Null

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument ("-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"{0}`"" -f (Join-Path $Base "avicore-pc-sync.ps1"))
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "AviCore Auto Import Sync" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Sends changed FDT / roster / training Excel files to the AviCore VPS for Auto Import" -Force | Out-Null

Write-Output "Installed. Public key:"
Get-Content "$Key.pub"
