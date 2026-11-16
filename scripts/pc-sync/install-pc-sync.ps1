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

# "Browse…" on the Auto Import page opens avicore-sync://browse/<key>; this
# links that to the Explorer dialog script (for this Windows user only).
Copy-Item -Force (Join-Path $PSScriptRoot "avicore-pc-browse.ps1") (Join-Path $Base "avicore-pc-browse.ps1")
$proto = "HKCU:\Software\Classes\avicore-sync"
New-Item -Path "$proto\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $proto -Name "(Default)" -Value "URL:AviCore Sync"
Set-ItemProperty -Path $proto -Name "URL Protocol" -Value ""
Set-ItemProperty -Path "$proto\shell\open\command" -Name "(Default)" `
  -Value ('powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" "%1"' -f (Join-Path $Base "avicore-pc-browse.ps1"))

# The local Browse helper (127.0.0.1:47811): started at every Windows sign-in
# and right now, hidden. -STA is needed for the Explorer dialogs.
Copy-Item -Force (Join-Path $PSScriptRoot "avicore-pc-helper.ps1") (Join-Path $Base "avicore-pc-helper.ps1")
$hAction = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument ("-NoProfile -NonInteractive -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File `"{0}`"" -f (Join-Path $Base "avicore-pc-helper.ps1"))
$hTrigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$hSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "AviCore Sync Helper" -Action $hAction -Trigger $hTrigger -Settings $hSettings `
  -Description "Lets the AviCore Admin Auto Import page open Windows Explorer to pick files (127.0.0.1 only)" -Force | Out-Null
Start-ScheduledTask -TaskName "AviCore Sync Helper"

Write-Output "Installed. Public key:"
Get-Content "$Key.pub"
