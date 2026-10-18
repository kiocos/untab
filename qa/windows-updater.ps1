$ErrorActionPreference = "Stop"
if ($env:CI -ne "true") { throw "Updater installation tests require an isolated CI runner" }
$installDir = Join-Path $env:LOCALAPPDATA "Untab"
$dataDir = Join-Path $env:APPDATA "local.untab.app"
if (Test-Path $installDir/untab.exe) { throw "Unexpected existing installation" }
if (Test-Path $dataDir) {
  $sentinel = Join-Path $dataDir "preserve-during-update.txt"
  if (!(Test-Path $sentinel) -or (Get-Content $sentinel -Raw).Trim() -ne "Keep the user's library") {
    throw "Refusing to remove data not created by the installer test"
  }
  Remove-Item $dataDir -Recurse -Force
}
$root = New-Item -ItemType Directory -Force ".qa/updater"
$installer = Get-ChildItem "release-artifacts/*-setup.exe" | Select-Object -First 1
Copy-Item $installer.FullName "$root/update.exe"
Copy-Item "$($installer.FullName).sig" "$root/update.exe.sig"
$config = @{ version = "0.3.9"; bundle = @{ createUpdaterArtifacts = $false }; plugins = @{ updater = @{ dangerousInsecureTransportProtocol = $true } } }
$config | ConvertTo-Json -Depth 5 | Set-Content "$root/baseline.json"
npm run bundle -- --features updater-smoke --config "$root/baseline.json"
if ($LASTEXITCODE -ne 0) { throw "Baseline build failed" }
$baseline = Get-ChildItem "src-tauri/target/release/bundle/nsis/*_0.3.9_*-setup.exe" | Select-Object -First 1
if (!$baseline) { throw "Baseline installer missing" }
$result = Start-Process $baseline.FullName -ArgumentList "/S" -PassThru -Wait
if ($result.ExitCode -ne 0) { throw "Baseline install failed" }
$server = Start-Process node -ArgumentList "qa/updater-server.mjs", $root.FullName -PassThru -RedirectStandardError "$root/server-error.log"
try {
  $deadline = (Get-Date).AddSeconds(15)
  while (!(Test-Path "$root/endpoint.txt") -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
  $env:UNTAB_UPDATER_ENDPOINT = Get-Content "$root/endpoint.txt" -Raw
  $env:UNTAB_UPDATER_REPORT = Join-Path $root.FullName "report.json"
  $old = Start-Process "$installDir/untab.exe" -PassThru
  $version = (Get-Content package.json | ConvertFrom-Json).version
  $deadline = (Get-Date).AddMinutes(3)
  $updated = $false
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $env:UNTAB_UPDATER_REPORT) {
      $report = Get-Content $env:UNTAB_UPDATER_REPORT -Raw | ConvertFrom-Json
      if ($report.error) { throw $report.error }
    }
    if ((Test-Path "$installDir/untab.exe") -and (Get-Item "$installDir/untab.exe").VersionInfo.ProductVersion -eq $version) {
      $running = Get-Process untab -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $old.Id }
      if ($running) { $updated = $true; break }
    }
    Start-Sleep -Milliseconds 500
  }
  if (!$updated) { throw "Updater did not install and restart the new version" }
  Start-Sleep -Seconds 5
  $running = Get-Process untab -ErrorAction Stop
  foreach ($app in $running) {
    $app.CloseMainWindow() | Out-Null
    if (!$app.WaitForExit(10000)) { throw "Updated app did not close normally" }
  }
  python qa/verify-updated-library.py $env:UNTAB_UPDATER_REPORT $dataDir
  if ($LASTEXITCODE -ne 0) { throw "Library preservation check failed" }
} finally {
  Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
  Remove-Item Env:UNTAB_UPDATER_ENDPOINT -ErrorAction SilentlyContinue
  Remove-Item Env:UNTAB_UPDATER_REPORT -ErrorAction SilentlyContinue
}
