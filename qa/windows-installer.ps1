$ErrorActionPreference = "Stop"
if ($env:CI -ne "true") { throw "Run installer smoke tests only in an isolated CI runner" }
$installer = (Get-ChildItem "src-tauri/target/release/bundle/nsis/*-setup.exe").FullName
$installDir = Join-Path $env:LOCALAPPDATA "Untab"
$dataDir = Join-Path $env:APPDATA "local.untab.app"
if (Test-Path $installDir) { throw "Unexpected pre-existing installation" }
if (Test-Path $dataDir) { throw "Unexpected pre-existing library" }
New-Item -ItemType Directory -Path $dataDir | Out-Null
$sentinel = Join-Path $dataDir "preserve-during-update.txt"
Set-Content $sentinel "Keep the user's library"
function Install-Untab {
  $result = Start-Process -FilePath $installer -ArgumentList "/S" -PassThru -Wait
  if ($result.ExitCode -ne 0) { throw "Installer failed: $($result.ExitCode)" }
  if (!(Test-Path "$installDir/untab.exe")) { throw "Application missing" }
  if (!(Test-Path $sentinel)) { throw "Installer removed user data" }
}
Install-Untab
$diagnostics = New-Item -ItemType Directory -Force ".qa/updater"
$app = Start-Process -FilePath "$installDir/untab.exe" -PassThru -RedirectStandardError "$diagnostics/installed-stderr.log"
$deadline = (Get-Date).AddSeconds(45)
while (!(Test-Path "$dataDir/untab.sqlite3") -and !$app.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if ($app.HasExited) { throw "Installed application did not stay running" }
if (!(Test-Path "$dataDir/untab.sqlite3")) {
  Get-Process untab | Select-Object Id, MainWindowTitle, Path | ConvertTo-Json | Set-Content "$diagnostics/process.json"
  Get-Content "$diagnostics/installed-stderr.log"
  throw "Installed app did not open its library"
}
$app.CloseMainWindow() | Out-Null
if (!$app.WaitForExit(10000)) { throw "App did not close normally" }
Install-Untab
$uninstaller = Get-ChildItem "$installDir/*uninstall*.exe" | Select-Object -First 1
if (!$uninstaller) { throw "Uninstaller missing" }
$result = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -PassThru -Wait
if ($result.ExitCode -ne 0) { throw "Uninstaller failed" }
$deadline = (Get-Date).AddSeconds(20)
while ((Test-Path "$installDir/untab.exe") -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if (Test-Path "$installDir/untab.exe") { throw "Application was not removed" }
if (!(Test-Path $sentinel) -or !(Test-Path "$dataDir/untab.sqlite3")) { throw "Uninstall removed the library without consent" }
$shortcut = Join-Path $env:APPDATA "Microsoft/Windows/Start Menu/Programs/Untab/Untab.lnk"
if (Test-Path $shortcut) { throw "Start menu shortcut was not removed" }
Write-Output "Windows install, launch, reinstall and uninstall passed; library preserved"
