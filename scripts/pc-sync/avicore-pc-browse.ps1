# AviCore Auto Import - "Browse…" on the office PC.
#
# The Auto Import page's Browse buttons open  avicore-sync://browse/<key>
# (registered by install-pc-sync.ps1). This script then shows the normal
# Windows Explorer dialog so the admin picks the folder / file - on this PC
# or on the company share drive - instead of typing a path. A mapped drive
# letter (Z:\...) is turned into its \\server\share path, so the sync task
# still finds it. The choice is sent to the VPS (.pc-pick-<key>.json), which
# saves it in the shared Auto Import settings; the page shows it within a
# minute.
#   key: fdt (folder) | roster | training (one file) | staff (several files)

param([string]$Url = "")

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
$Base    = Join-Path $env:ProgramData "AviCoreSync"
$Key     = Join-Path $Base "id_ed25519"
$Work    = Join-Path $Base "work"
$LogFile = Join-Path $Base "sync.log"
$Vps     = if ($env:AVICORE_SYNC_HOST) { $env:AVICORE_SYNC_HOST } else { "72.61.148.41" }
$Sftp    = Join-Path $env:SystemRoot "System32\OpenSSH\sftp.exe"
New-Item -ItemType Directory -Force -Path $Work | Out-Null

function Write-Log($text) { Add-Content -Path $LogFile -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $text) -Encoding UTF8 }

$m = [regex]::Match($Url, '^avicore-sync://browse/(fdt|roster|training|staff)/?', 'IgnoreCase')
if (-not $m.Success) { exit 0 }
$which = $m.Groups[1].Value.ToLower()

# Z:\folder\file.xlsx -> \\server\share\folder\file.xlsx (mapped drives are
# not reliably visible to the scheduled sync task; the UNC path always is).
function To-Unc([string]$p) {
  if ($p -match '^([A-Za-z]):\\(.*)$') {
    $drive = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='{0}:'" -f $Matches[1]) -ErrorAction SilentlyContinue
    if ($drive -and $drive.DriveType -eq 4 -and $drive.ProviderName) { return (Join-Path $drive.ProviderName $Matches[2]) }
  }
  return $p
}

# An invisible top-most owner so the dialog comes up in front of the browser.
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.WindowState = "Minimized"
$owner.Show(); $owner.Hide()

$titles = @{ fdt = "AviCore - choose the FDT folder (the *_FDT.xlsx files)"; roster = "AviCore - choose the roster Excel file"; training = "AviCore - choose the Pilot Training Due Excel file"; staff = "AviCore - choose the Staff Training Excel file(s)" }
$value = $null
if ($which -eq "fdt") {
  $d = New-Object System.Windows.Forms.FolderBrowserDialog
  $d.Description = $titles[$which]
  $d.ShowNewFolderButton = $false
  if ($d.ShowDialog($owner) -eq "OK") { $value = To-Unc $d.SelectedPath }
} else {
  $d = New-Object System.Windows.Forms.OpenFileDialog
  $d.Title = $titles[$which]
  $d.Filter = "Excel files (*.xlsx;*.xls;*.xlsm)|*.xlsx;*.xls;*.xlsm|All files (*.*)|*.*"
  $d.Multiselect = ($which -eq "staff")
  if ($d.ShowDialog($owner) -eq "OK") {
    $value = if ($which -eq "staff") { @($d.FileNames | ForEach-Object { To-Unc $_ }) } else { To-Unc $d.FileName }
  }
}
$owner.Close()
if ($null -eq $value) { exit 0 }

$pick = [ordered]@{ key = $which; value = $value; at = (Get-Date).ToUniversalTime().ToString("o"); computer = $env:COMPUTERNAME; user = $env:USERNAME }
$local = Join-Path $Work ".pc-pick-$which.json"
$pick | ConvertTo-Json -Depth 4 | Set-Content -Path $local -Encoding UTF8
$batch = Join-Path $Work "pick-batch.txt"
Set-Content -Path $batch -Value @(('put "{0}" ".pc-pick-{1}.json.part"' -f $local, $which), ('-rm ".pc-pick-{0}.json"' -f $which), ('rename ".pc-pick-{0}.json.part" ".pc-pick-{0}.json"' -f $which)) -Encoding ASCII
$ErrorActionPreference = "Continue"
$out = & $Sftp -i $Key -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$Base\known_hosts" -o ConnectTimeout=20 -o LogLevel=ERROR -b $batch "avicoreimport@$Vps" 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Log "Browse ($which): could not send the choice to the VPS: $($out | Out-String)"
  [System.Windows.Forms.MessageBox]::Show("Could not send the choice to the AviCore server.`n$($out | Out-String)", "AviCore Auto Import", "OK", "Error") | Out-Null
  exit 1
}
Write-Log ("Browse ({0}): {1}" -f $which, (@($value) -join "; "))
