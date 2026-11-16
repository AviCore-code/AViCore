# AviCore Auto Import - local Browse helper on the office PC.
#
# Started at Windows sign-in (scheduled task "AviCore Sync Helper", hidden).
# Listens ONLY on 127.0.0.1:47811, so nothing outside this PC can reach it,
# and answers only the AviCore Admin web app. The Auto Import page's Browse…
# button asks it:  GET http://127.0.0.1:47811/browse?key=fdt|roster|training|staff
# and it shows the normal Windows Explorer dialog (this PC or the company share
# drive) and returns the chosen path - a mapped drive letter turned into its
# \\server\share form - straight into the page's field.
# A browser cannot give a web page the real path of a file it picks; this is
# the small piece on the PC that can.

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$Port    = 47811
$Base    = Join-Path $env:ProgramData "AviCoreSync"
$LogFile = Join-Path $Base "sync.log"
$Origins = @("https://avicore-admin.web.app", "https://avicore-admin.firebaseapp.com", "http://localhost:5173", "http://localhost:5199")
function Write-Log($text) { Add-Content -Path $LogFile -Value ("{0:yyyy-MM-dd HH:mm:ss}  helper: {1}" -f (Get-Date), $text) -Encoding UTF8 }

function To-Unc([string]$p) {
  if ($p -match '^([A-Za-z]):\\(.*)$') {
    $drive = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='{0}:'" -f $Matches[1]) -ErrorAction SilentlyContinue
    if ($drive -and $drive.DriveType -eq 4 -and $drive.ProviderName) { return (Join-Path $drive.ProviderName $Matches[2]) }
  }
  return $p
}

function Show-Picker([string]$which) {
  $owner = New-Object System.Windows.Forms.Form
  $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.FormBorderStyle = "None"
  $owner.StartPosition = "Manual"; $owner.Location = New-Object System.Drawing.Point(200, 200)
  $owner.Size = New-Object System.Drawing.Size(1, 1); $owner.Opacity = 0
  $owner.Show(); $owner.Activate()
  try {
    if ($which -eq "fdt") {
      # Capt. Weera: the folder-picker dialog does not open on the company
      # share (Azure Files), the file dialog does - so pick any one *_FDT.xlsx
      # and use the folder it is in.
      $d = New-Object System.Windows.Forms.OpenFileDialog
      $d.Title = "AviCore - FDT: pick ONE *_FDT.xlsx = every file in that folder, or pick SEVERAL (Ctrl / Shift) = only those"
      $d.Filter = "FDT files (*_FDT.xlsx)|*_FDT.xlsx;*_FDT.xls|Excel files (*.xlsx;*.xls;*.xlsm)|*.xlsx;*.xls;*.xlsm"
      $d.Multiselect = $true
      if ($d.ShowDialog($owner) -ne "OK") { return $null }
      # One file = the whole folder; several = only those files.
      $names = @($d.FileNames | ForEach-Object { Split-Path -Leaf $_ })
      return [ordered]@{ folder = (To-Unc (Split-Path -Parent $d.FileName)); files = $(if ($names.Count -gt 1) { $names } else { @() }) }
    }
    $d = New-Object System.Windows.Forms.OpenFileDialog
    $d.Title = @{ roster = "AviCore - choose the roster Excel file"; training = "AviCore - choose the Pilot Training Due Excel file"; staff = "AviCore - choose the Staff Training Excel file(s)" }[$which]
    $d.Filter = "Excel files (*.xlsx;*.xls;*.xlsm)|*.xlsx;*.xls;*.xlsm|All files (*.*)|*.*"
    $d.Multiselect = ($which -eq "staff")
    if ($d.ShowDialog($owner) -ne "OK") { return $null }
    if ($which -eq "staff") { return @($d.FileNames | ForEach-Object { To-Unc $_ }) }
    return (To-Unc $d.FileName)
  } finally { $owner.Close() }
}

function Send($stream, [int]$code, [string]$status, [string]$body, [string]$origin) {
  $h = "HTTP/1.1 $code $status`r`nContent-Type: application/json; charset=utf-8`r`nCache-Control: no-store`r`nConnection: close`r`n"
  if ($origin) {
    $h += "Access-Control-Allow-Origin: $origin`r`nVary: Origin`r`nAccess-Control-Allow-Methods: GET, OPTIONS`r`n"
    $h += "Access-Control-Allow-Headers: content-type`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Max-Age: 600`r`n"
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  $h += "Content-Length: $($bytes.Length)`r`n`r`n"
  $head = [Text.Encoding]::ASCII.GetBytes($h)
  $stream.Write($head, 0, $head.Length); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush()
}

# One helper per user session.
$mutex = New-Object System.Threading.Mutex($false, "Local\AviCoreSyncHelper")
if (-not $mutex.WaitOne(0)) { exit 0 }

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try { $listener.Start() } catch { Write-Log "cannot listen on 127.0.0.1:$Port - $($_.Exception.Message)"; exit 1 }
Write-Log "listening on 127.0.0.1:$Port"

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 5000
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 4096, $true)
    $first = $reader.ReadLine()
    $headers = @{}
    while ($true) { $l = $reader.ReadLine(); if ([string]::IsNullOrEmpty($l)) { break }; $i = $l.IndexOf(":"); if ($i -gt 0) { $headers[$l.Substring(0, $i).Trim().ToLower()] = $l.Substring($i + 1).Trim() } }
    $parts = "$first".Split(" ")
    $method = $parts[0]; $target = if ($parts.Length -gt 1) { $parts[1] } else { "/" }
    $origin = $headers["origin"]
    $allowed = $origin -and ($Origins -contains $origin)
    if (-not $allowed) { Send $stream 403 "Forbidden" '{"ok":false,"error":"origin not allowed"}' $null; continue }
    if ($method -eq "OPTIONS") { Send $stream 204 "No Content" "" $origin; continue }
    $uri = [Uri]("http://127.0.0.1" + $target)
    $key = ([regex]::Match($uri.Query, '(?:^|[?&])key=([a-z]+)')).Groups[1].Value
    if ($uri.AbsolutePath -eq "/ping") { Send $stream 200 "OK" ('{"ok":true,"computer":"' + $env:COMPUTERNAME + '"}') $origin; continue }
    if ($uri.AbsolutePath -ne "/browse" -or @("fdt", "roster", "training", "staff") -notcontains $key) { Send $stream 404 "Not Found" '{"ok":false,"error":"unknown request"}' $origin; continue }
    $value = Show-Picker $key
    $body = [ordered]@{ ok = $true; key = $key; value = $value; cancelled = ($null -eq $value); computer = $env:COMPUTERNAME } | ConvertTo-Json -Compress -Depth 4
    if ($null -ne $value) { Write-Log ("browse {0}: {1}" -f $key, (@($value) -join "; ")) }
    Send $stream 200 "OK" $body $origin
  } catch {
    Write-Log "request failed: $($_.Exception.Message)"
  } finally {
    $client.Close()
  }
}
