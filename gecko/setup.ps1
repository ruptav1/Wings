# Wings setup: makes a working Wings out of this source, everything inside this folder (gecko\):
#  1. engine\   Mozilla's Gecko core: the official Firefox 160.0.1 for Windows (in Vietnamese: the core's own
#               messages - form checks, file pickers - in Wings' language; -Locale for another), checked
#               (its SHA-512 and Mozilla's digital signature) and unpacked with Windows' own tar.exe - the
#               installer is never run, nothing is installed; Firefox's browser application, updater,
#               crash reporter and the like left out, its programs named "Wings" with Wings' icon
#               (tools\rebrand.ps1);
#  2. app\unkcore.dll   the back end (core\), built with Rust;
#  3. Wings.exe         the launcher (launcher\), built with Rust;
#  4. app\chrome\content\ui\   the interface (..\ui\), each page with bridge.js first.
# Rust and the C++ build tools it needs are installed when they are missing. Run it again after pulling
# changes: the engine is kept when it is already there (-Force fetches it again).
#
#   powershell -ExecutionPolicy Bypass -File gecko\setup.ps1 [-ToolsDir D:\Tools] [-Shortcut] [-Force]
#
#   -ToolsDir   where Rust lives / is installed (its rustup and cargo folders); default: Rust's own
#               (%USERPROFILE%\.rustup, .cargo) or what RUSTUP_HOME / CARGO_HOME say
#   -Shortcut   also put a "Wings" shortcut in the Start menu (tools\shortcut.ps1)
#   -Force      download and unpack the engine again
#   -Locale     the language of the engine's own messages (Mozilla's codes: vi, en-US, ja, fr...); default vi
param([string]$ToolsDir = '', [switch]$Shortcut, [switch]$Force, [string]$Locale = 'vi')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$here = $PSScriptRoot
$repo = Split-Path -Parent $here
$work = Join-Path $here '.setup'
New-Item -ItemType Directory -Force $work | Out-Null
# (temporary files stay on this drive, in .setup\)
$env:TEMP = $work
$env:TMP = $work

$FIREFOX = '160.0.1'
$MOZ = "https://archive.mozilla.org/pub/firefox/releases/$FIREFOX"
$SETUP_URL = "$MOZ/win64/$Locale/Firefox%20Setup%20$FIREFOX.exe"
# (the SHA-512 Mozilla lists for these builds; another language's is read from Mozilla's SHA512SUMS)
$PINNED = @{
  'vi'    = '2832e423ab2de7dfec32ff62587a1e06036e4a3713078fca06105fe2616244d1541c0ff70494eaf653a3570fb40fbab901b3702b46435911a560de2ed4439ea6'
  'en-US' = 'e0356669960e73528d53c194ae2e3f46d663483073da16d58ba318cd67036d4023a10a23f47e1b733554dce88d8b7c299d806e06bbe31c590286ded20886eaea'
}
# what of Firefox's files the engine keeps (the rest is Firefox's own application and services)
$KEEP_FILES = @('AccessibleMarshal.dll', 'CoreMessagingXP.dll', 'InstallationDirLayout.dll', 'Microsoft.InputStateManager.dll',
  'Microsoft.Internal.FrameworkUdk.dll', 'Microsoft.UI.Composition.OSSupport.dll', 'Microsoft.UI.Input.dll',
  'Microsoft.UI.Windowing.Core.dll', 'Microsoft.UI.Windowing.dll', 'Microsoft.WindowsAppRuntime.Insights.Resource.dll',
  'Microsoft.WindowsAppRuntime.dll', 'application.ini', 'crashhelper.exe', 'dependentlibs.list', 'dxcompiler.dll',
  'firefox.exe', 'freebl3.dll', 'gkcodecs.dll', 'lgpllibs.dll', 'libEGL.dll', 'libGLESv2.dll', 'marshal.dll',
  'mozavcodec.dll', 'mozavutil.dll', 'mozglue.dll', 'mozwer.dll', 'msixcomserver.dll', 'msvcp140.dll',
  'msvcp140_atomic_wait.dll', 'notificationserver.dll', 'nss3.dll', 'omni.ja', 'platform.ini', 'plugin-container.exe',
  'softokn3.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'wmfclearkey.dll', 'xul.dll')
$KEEP_DIRS = @('defaults', 'fonts', 'gmp-clearkey', 'installation_dir_layout')

function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Done($text) { Write-Host "   $text" -ForegroundColor Green }

function Download($url, $file) {
  Write-Host "   downloading $url"
  Invoke-WebRequest -Uri $url -OutFile "$file.part" -UseBasicParsing
  Move-Item -Force "$file.part" $file
}

# Wings must not be running from this folder while its files are replaced
$running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($here + '\', [StringComparison]::OrdinalIgnoreCase) }
if ($running) { throw 'Wings is running from this folder: close it first, then run setup again.' }

# ------------------------------------------------------------------ 1. the engine
$engine = Join-Path $here 'engine'
$have = (Test-Path (Join-Path $engine 'Wings.exe')) -and ((Get-Content (Join-Path $engine 'platform.ini') -ErrorAction SilentlyContinue) -match "^Milestone=$([regex]::Escape($FIREFOX))$")
if ($have -and -not $Force) {
  Step "Engine: Firefox $FIREFOX is already in engine\ (-Force to fetch it again)"
} else {
  Step "Engine: Firefox $FIREFOX ($Locale), the official build from Mozilla"
  $want = $PINNED[$Locale]
  if (-not $want) {
    $sums = (Invoke-WebRequest -Uri "$MOZ/SHA512SUMS" -UseBasicParsing).Content -split "`n"
    $line = $sums | Where-Object { $_ -like "* win64/$Locale/Firefox Setup $FIREFOX.exe" } | Select-Object -First 1
    if (-not $line) { throw "Mozilla has no Firefox $FIREFOX in the language '$Locale'." }
    $want = ($line -split '\s+')[0].ToLower()
  }
  $setup = Join-Path $work "Firefox Setup $FIREFOX ($Locale).exe"
  if (-not (Test-Path $setup) -or (Get-FileHash -Algorithm SHA512 $setup).Hash.ToLower() -ne $want) { Download $SETUP_URL $setup }
  if ((Get-FileHash -Algorithm SHA512 $setup).Hash.ToLower() -ne $want) { Remove-Item -Force $setup; throw 'The Firefox download is not the expected file (SHA-512 differs).' }
  $sig = Get-AuthenticodeSignature $setup
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O="?Mozilla Corporation') { throw "The Firefox download is not signed by Mozilla ($($sig.Status))." }
  Done "checked: SHA-512 and Mozilla's signature"
  $x = Join-Path $work 'firefox'
  if (Test-Path $x) { Remove-Item -Recurse -Force $x }
  New-Item -ItemType Directory $x | Out-Null
  # (the installer is a 7-Zip archive: its core\ folder read out with Windows' own tar.exe, the installer
  # itself never run)
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (-not (Test-Path $tar)) { throw 'Windows tar.exe is missing (Windows 10 1803 or later is needed).' }
  & $tar -xf $setup -C $x core
  $core = Join-Path $x 'core'
  if ($LASTEXITCODE -or -not (Test-Path (Join-Path $core 'xul.dll'))) { throw "Could not unpack Firefox (tar exit code $LASTEXITCODE)." }
  $new = Join-Path $here 'engine.new'
  if (Test-Path $new) { Remove-Item -Recurse -Force $new }
  New-Item -ItemType Directory $new | Out-Null
  foreach ($f in $KEEP_FILES) { Copy-Item -LiteralPath (Join-Path $core $f) (Join-Path $new $f) }
  foreach ($d in $KEEP_DIRS) { if (Test-Path (Join-Path $core $d)) { Copy-Item -Recurse -LiteralPath (Join-Path $core $d) (Join-Path $new $d) } }
  Rename-Item (Join-Path $new 'firefox.exe') 'Wings.exe'
  # (Firefox's own application.ini is not used: Wings starts with -app app\application.ini; still, no
  # address of Mozilla's crash reports or updates is left in it)
  $ini = Join-Path $new 'application.ini'
  $text = [IO.File]::ReadAllText($ini) -replace '(?m)^Vendor=.*$', 'Vendor=UnknowWeb' -replace '(?m)^Name=.*$', 'Name=UnknowWeb' -replace '(?m)^RemotingName=.*$', 'RemotingName=unknowweb'
  $text = $text -replace '(?m)^(?:ServerURL|URL)=.*(?:\r?\n|$)', ''
  [IO.File]::WriteAllText($ini, $text, (New-Object Text.UTF8Encoding $false))
  $icon = Join-Path $here 'branding\wings.ico'
  foreach ($exe in 'Wings.exe', 'plugin-container.exe', 'crashhelper.exe') {
    & (Join-Path $here 'tools\rebrand.ps1') -Exe (Join-Path $new $exe) -Name 'Wings' -Company 'Wings' -Icon $icon | Out-Null
  }
  if (Test-Path $engine) { Remove-Item -Recurse -Force $engine }
  Rename-Item $new 'engine'
  Remove-Item -Recurse -Force $x
  Done "engine\ ready ($((Get-ChildItem -Recurse -File $engine).Count) files)"
}

# ------------------------------------------------------------------ 2. Rust (and the C++ build tools)
Step 'Rust'
if ($ToolsDir) {
  $env:RUSTUP_HOME = Join-Path $ToolsDir 'rustup'
  $env:CARGO_HOME = Join-Path $ToolsDir 'cargo'
}
function Find-Cargo {
  $c = @()
  if ($env:CARGO_HOME) { $c += Join-Path $env:CARGO_HOME 'bin\cargo.exe' }
  $g = Get-Command cargo -ErrorAction SilentlyContinue
  if ($g) { $c += $g.Source }
  $c += Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
  foreach ($f in $c) { if ($f -and (Test-Path $f)) { return $f } }
  return $null
}
function Have-VCTools {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Test-Path $vswhere)) { return $false }
  return [bool](& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
}
if (-not (Have-VCTools)) {
  Write-Host '   Microsoft C++ build tools (needed by Rust) not found: installing Visual Studio Build Tools (C++)...'
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'winget is missing: install "Visual Studio Build Tools" with "Desktop development with C++" yourself, then run setup again.' }
  winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements --override '--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
  if (-not (Have-VCTools)) { throw 'The C++ build tools could not be installed: install "Visual Studio Build Tools" with "Desktop development with C++", then run setup again.' }
}
$cargo = Find-Cargo
if (-not $cargo) {
  Write-Host '   Rust not found: installing it (rustup, stable, minimal)...'
  $init = Join-Path $work 'rustup-init.exe'
  $url = 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe'
  Download $url $init
  $want = ((Invoke-WebRequest -Uri "$url.sha256" -UseBasicParsing).Content -split '\s+')[0].ToLower()
  if ((Get-FileHash -Algorithm SHA256 $init).Hash.ToLower() -ne $want) { throw 'The rustup download is not the expected file (SHA-256 differs).' }
  & $init -y --profile minimal --default-toolchain stable --no-modify-path
  if ($LASTEXITCODE) { throw "rustup-init failed ($LASTEXITCODE)." }
  $cargo = Find-Cargo
  if (-not $cargo) { throw 'Rust was installed but cargo is not found.' }
}
$env:Path = (Split-Path $cargo) + ';' + $env:Path
Done ((& $cargo --version) -join ' ')

function Build($dir) {
  Push-Location (Join-Path $here $dir)
  try {
    & $cargo build --release
    if ($LASTEXITCODE) { throw "cargo build failed in $dir ($LASTEXITCODE)." }
  } finally {
    Pop-Location
  }
}

# ------------------------------------------------------------------ 3. the back end and the launcher
Step 'Back end: core\ -> app\unkcore.dll'
Build 'core'
Copy-Item -Force (Join-Path $here 'core\target\release\unkcore.dll') (Join-Path $here 'app\unkcore.dll')
Done 'app\unkcore.dll'

Step 'Launcher: launcher\ -> Wings.exe'
Build 'launcher'
$launcher = Join-Path $here 'Wings.exe'
Copy-Item -Force (Join-Path $here 'launcher\target\release\launcher.exe') $launcher
& (Join-Path $here 'tools\rebrand.ps1') -Exe $launcher -Name 'Wings' -Company 'Wings' -Icon (Join-Path $here 'branding\wings.ico') | Out-Null
Done 'Wings.exe'

# ------------------------------------------------------------------ 4. the interface (as tools\sync-ui.mjs does)
Step 'Interface: ..\ui -> app\chrome\content\ui'
$from = Join-Path $repo 'ui'
$to = Join-Path $here 'app\chrome\content\ui'
if (Test-Path $to) { Remove-Item -Recurse -Force $to }
$bridge = '<script src="chrome://unknowweb/content/bridge.js"></script>'
$head = [regex]'(?i)<head>(\s*)'
$utf8 = New-Object Text.UTF8Encoding $false
$pages = 0
foreach ($f in Get-ChildItem -Recurse -File $from) {
  $rel = $f.FullName.Substring($from.Length + 1)
  $dst = Join-Path $to $rel
  New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
  if ($f.Name -eq 'index.html') {
    # (first in <head>: before the modules that ask for window.__TAURI__)
    $html = [IO.File]::ReadAllText($f.FullName, $utf8)
    $html = $head.Replace($html, { param($m) '<head>' + $m.Groups[1].Value + $bridge + $m.Groups[1].Value }, 1)
    [IO.File]::WriteAllText($dst, $html, $utf8)
    $pages++
  } else {
    Copy-Item -LiteralPath $f.FullName $dst
  }
}
Done "$pages pages"

if ($Shortcut) {
  Step 'Start menu shortcut'
  & (Join-Path $here 'tools\shortcut.ps1')
}

Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
Write-Host ''
Write-Host "Wings is ready: $launcher" -ForegroundColor Green
