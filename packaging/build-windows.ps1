# Builds the Windows setup program: release\IHOP-Operations-Setup-<version>.exe
#   powershell -ExecutionPolicy Bypass -File packaging\build-windows.ps1
# Needs Node (to build the frontend) and Inno Setup 6. The C# compiler used for the tray
# program ships with Windows. The installer carries its own copy of Node for the client.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$nodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { "v24.21.0" }
$version = (Get-Content "$root\server\package.json" | ConvertFrom-Json).version
$build = "$root\release\windows"
$stage = "$build\stage"
$cache = "$root\release\.cache"

Write-Host "== Frontend and server components"
if (-not (Test-Path "$root\client\node_modules")) { Push-Location "$root\client"; npm ci; Pop-Location }
Push-Location "$root\client"; npm run build | Out-Null; Pop-Location
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Force "$stage\app\server", "$stage\app\client", $cache | Out-Null
Copy-Item "$root\server\src" "$stage\app\server\src" -Recurse
Copy-Item "$root\server\package.json", "$root\server\package-lock.json" "$stage\app\server\"
Copy-Item "$root\client\dist" "$stage\app\client\dist" -Recurse
Push-Location "$stage\app\server"; npm ci --omit=dev --ignore-scripts --no-audit --no-fund | Out-Null; Pop-Location
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

Write-Host "== Node $nodeVersion for Windows"
$zip = "node-$nodeVersion-win-x64.zip"
if (-not (Test-Path "$cache\$zip")) { Invoke-WebRequest "https://nodejs.org/dist/$nodeVersion/$zip" -OutFile "$cache\$zip" }
$sums = (Invoke-WebRequest "https://nodejs.org/dist/$nodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
$want = ($sums -split "`n" | Where-Object { $_ -match "  $([regex]::Escape($zip))$" }) -replace "\s.*", ""
$have = (Get-FileHash "$cache\$zip" -Algorithm SHA256).Hash.ToLower()
if (-not $want -or $want -ne $have) { Remove-Item "$cache\$zip"; throw "Checksum mismatch for $zip" }
Expand-Archive "$cache\$zip" -DestinationPath "$build\node" -Force
Copy-Item "$build\node\node-$nodeVersion-win-x64\node.exe" "$stage\node.exe"
Remove-Item "$build\node" -Recurse -Force

Write-Host "== Tray program"
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
& $csc /nologo /target:winexe /platform:anycpu /optimize+ "/win32icon:$root\packaging\assets\icon.ico" `
  /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
  "/out:$stage\IHOP Operations.exe" "$root\packaging\windows\Launcher.cs"
if ($LASTEXITCODE -ne 0) { throw "The tray program did not compile" }

Write-Host "== Setup program"
$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "Inno Setup 6 is not installed (https://jrsoftware.org/isdl.php, or: choco install innosetup)" }
& $iscc /Q "/DAppVersion=$version" "/DStageDir=$stage" "$root\packaging\windows\installer.iss"
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed" }
$out = "$root\release\IHOP-Operations-Setup-$version.exe"
Write-Host ("Built {0} ({1:N0} MB)" -f $out, ((Get-Item $out).Length / 1MB))
