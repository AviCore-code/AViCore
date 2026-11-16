# AviCore Auto Import - office PC sync (Windows Task Scheduler, every 5 minutes).
#
# Sends the FDT / roster / training Excel files that changed since the last run
# to the AviCore VPS, which imports them 24 hours a day (avicore-autoimport
# service). Which files to send is set on the AviCore Admin "Auto Import" page;
# the VPS publishes those paths as .pc-config.json in the upload folder and this
# script reads them from there each run.
#
# Uses the built-in Windows OpenSSH client (sftp.exe) with its own key
# (%ProgramData%\AviCoreSync\id_ed25519). The VPS account it signs in to
# (avicoreimport) can only upload into its own folder - no shell.

$ErrorActionPreference = "Stop"
$Base    = Join-Path $env:ProgramData "AviCoreSync"
$Key     = Join-Path $Base "id_ed25519"
$State   = Join-Path $Base "state.json"
$LogFile = Join-Path $Base "sync.log"
$Work    = Join-Path $Base "work"
$Vps     = if ($env:AVICORE_SYNC_HOST) { $env:AVICORE_SYNC_HOST } else { "72.61.148.41" }
$Target  = "avicoreimport@$Vps"
$Sftp    = Join-Path $env:SystemRoot "System32\OpenSSH\sftp.exe"
$SshOpts = @("-i", $Key, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "UserKnownHostsFile=$Base\known_hosts", "-o", "ConnectTimeout=20")

New-Item -ItemType Directory -Force -Path $Base, $Work | Out-Null

function Write-Log($text) {
  $line = "{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $text
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
  if ((Get-Item $LogFile).Length -gt 2MB) {
    $keep = Get-Content $LogFile -Tail 2000
    Set-Content -Path $LogFile -Value $keep -Encoding UTF8
  }
}

function Invoke-Sftp([string[]]$commands) {
  $batch = Join-Path $Work "batch.txt"
  Set-Content -Path $batch -Value $commands -Encoding ASCII
  # Windows PowerShell turns any stderr line of a native program into an error
  # record; with "Stop" that would abort on a harmless ssh notice.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { $out = & $Sftp @SshOpts -o LogLevel=ERROR -b $batch $Target 2>&1 } finally { $ErrorActionPreference = $prev }
  return @{ code = $LASTEXITCODE; out = ($out | Out-String) }
}

# Quote a path for an sftp batch line.
function Q([string]$p) { return '"' + ($p -replace '"', '\"') + '"' }

try {
  # 1. Which files to send - published by the VPS from the Auto Import settings.
  $cfgLocal = Join-Path $Work "pc-config.json"
  if (Test-Path $cfgLocal) { Remove-Item $cfgLocal -Force }
  $r = Invoke-Sftp @("get .pc-config.json " + (Q $cfgLocal))
  if (-not (Test-Path $cfgLocal)) { Write-Log "No settings from the VPS yet (.pc-config.json): $($r.out.Trim())"; exit 0 }
  $cfg = Get-Content $cfgLocal -Raw -Encoding UTF8 | ConvertFrom-Json

  $wanted = @()
  if ($cfg.paths.fdt -and (Test-Path -LiteralPath $cfg.paths.fdt -PathType Container)) {
    Get-ChildItem -LiteralPath $cfg.paths.fdt -File | Where-Object { $_.Name -match '_FDT\.xlsx?$' -and $_.Name -notlike '~$*' } |
      ForEach-Object { $wanted += [pscustomobject]@{ key = "fdt"; file = $_ } }
  }
  foreach ($k in @("roster", "training")) {
    $p = $cfg.paths.$k
    if ($p -and (Test-Path -LiteralPath $p -PathType Leaf)) { $wanted += [pscustomobject]@{ key = $k; file = (Get-Item -LiteralPath $p) } }
  }
  foreach ($p in @($cfg.paths.staff)) {
    if ($p -and (Test-Path -LiteralPath $p -PathType Leaf)) { $wanted += [pscustomobject]@{ key = "staff"; file = (Get-Item -LiteralPath $p) } }
  }

  # 2. Only what changed since the last successful send.
  $seen = @{}
  if (Test-Path $State) { (Get-Content $State -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $seen[$_.Name] = $_.Value } }
  $todo = $wanted | Where-Object { $seen[("{0}/{1}" -f $_.key, $_.file.Name)] -ne ("{0}:{1}" -f $_.file.LastWriteTimeUtc.Ticks, $_.file.Length) }

  # 3. Copy first (Excel may have the file open), upload as .part, then rename.
  $cmds = @()
  $sent = @()
  foreach ($t in $todo) {
    $copy = Join-Path $Work ("{0}-{1}" -f $t.key, $t.file.Name)
    try { Copy-Item -LiteralPath $t.file.FullName -Destination $copy -Force } catch { Write-Log "Skipped (in use?) $($t.file.FullName): $($_.Exception.Message)"; continue }
    $remote = "{0}/{1}" -f $t.key, $t.file.Name
    $cmds += "put " + (Q $copy) + " " + (Q "$remote.part")
    $cmds += "-rm " + (Q $remote)
    $cmds += "rename " + (Q "$remote.part") + " " + (Q $remote)
    $sent += $t
  }
  $hb = Join-Path $Work ".pc-heartbeat"
  Set-Content -Path $hb -Value ("{0:o} {1}" -f (Get-Date), $env:COMPUTERNAME) -Encoding ASCII
  $cmds += "put " + (Q $hb) + " .pc-heartbeat"

  $r = Invoke-Sftp $cmds
  if ($r.code -ne 0) { Write-Log "Upload failed (exit $($r.code)): $($r.out.Trim())"; exit 1 }
  foreach ($t in $sent) { $seen[("{0}/{1}" -f $t.key, $t.file.Name)] = ("{0}:{1}" -f $t.file.LastWriteTimeUtc.Ticks, $t.file.Length) }
  $seen | ConvertTo-Json | Set-Content -Path $State -Encoding UTF8
  if ($sent.Count) { Write-Log ("Sent {0} file(s): {1}" -f $sent.Count, (($sent | ForEach-Object { "$($_.key)/$($_.file.Name)" }) -join ", ")) }
  Get-ChildItem $Work -File | Where-Object { $_.Name -ne "pc-config.json" } | Remove-Item -Force -ErrorAction SilentlyContinue
} catch {
  Write-Log "Error: $($_.Exception.Message)"
  exit 1
}
