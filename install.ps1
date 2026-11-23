# Claude Bridge for Premiere Pro - installer (Windows, per-user, no admin needed)
# Run from this folder:  powershell -ExecutionPolicy Bypass -File .\install.ps1
# Quit Premiere Pro and the Claude desktop app first.

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. Panel -> CEP extensions folder
$ext = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.claudebridge.premiere"
if (Test-Path $ext) { Remove-Item $ext -Recurse -Force }
New-Item -ItemType Directory -Force -Path $ext | Out-Null
Copy-Item (Join-Path $here "cep_panel\*") $ext -Recurse -Force
Write-Host "Panel installed -> $ext"

# 2. Allow unsigned panels (needed for any home-made CEP panel)
foreach ($v in 9..13) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name "PlayerDebugMode" -Value "1"
}
Write-Host "PlayerDebugMode enabled (CSXS 9-13)"

# 3. Python + MCP SDK
# find a real python.exe: user installs first, then PATH (skipping the Microsoft Store stub)
$py = $null
$found = @(Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs\Python\Python3*\python.exe") -ErrorAction SilentlyContinue) +
         @(Get-ChildItem "C:\Program Files\Python3*\python.exe" -ErrorAction SilentlyContinue)
$found = $found | Sort-Object FullName -Descending
if ($found) { $py = $found[0].FullName }
if (-not $py) {
  foreach ($name in @("python", "python3", "py")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notlike "*WindowsApps*") { $py = (& $cmd.Source -c "import sys; print(sys.executable)"); break }
  }
}
if (-not $py) { throw "Python 3 not found. Install it from python.org (tick 'Add to PATH')." }
Write-Host "Using Python: $py"
& $py -m pip install --upgrade mcp | Out-Null
Write-Host "MCP SDK installed for $py"

# 4. Register the server with Claude Desktop (backs up the old config)
$server = Join-Path $here "mcp_server\server.py"
$candidates = @(Join-Path $env:APPDATA "Claude")
$candidates += Get-ChildItem (Join-Path $env:LOCALAPPDATA "Packages") -Directory -Filter "Claude_*" -ErrorAction SilentlyContinue |
               ForEach-Object { Join-Path $_.FullName "LocalCache\Roaming\Claude" }
$written = $false
foreach ($dir in $candidates) {
  if (-not (Test-Path $dir)) { continue }
  $cfg = Join-Path $dir "claude_desktop_config.json"
  if (Test-Path $cfg) {
    Copy-Item $cfg "$cfg.bak" -Force
    $json = Get-Content $cfg -Raw | ConvertFrom-Json
  } else { $json = [pscustomobject]@{} }
  if (-not $json.PSObject.Properties["mcpServers"]) { $json | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{}) }
  $entry = [pscustomobject]@{ command = $py; args = @($server) }
  if ($json.mcpServers.PSObject.Properties["premiere"]) { $json.mcpServers.premiere = $entry }
  else { $json.mcpServers | Add-Member -NotePropertyName premiere -NotePropertyValue $entry }
  $json | ConvertTo-Json -Depth 10 | Set-Content $cfg -Encoding UTF8
  Write-Host "Registered 'premiere' MCP server in $cfg"
  $written = $true
}
if (-not $written) { Write-Warning "Claude Desktop config folder not found; open Claude Desktop once, then rerun." }

Write-Host ""
Write-Host "Done. Now: 1) start Claude Desktop  2) start Premiere Pro  3) Window > Extensions > Claude Bridge"
