# The computer's apps for Unknow Web Browser's sidebar (apps.rs runs it, $mode set before it):
#  - shortcuts: the Start menu's shortcuts to programs (.lnk -> .exe), read with Windows' own shell;
#  - packages: the Start menu's Store / MSIX apps, with their package's signature kind, folder,
#    publisher and logo (from the package's manifest);
#  - verify: for the programs given on stdin (a JSON list of paths), whether each carries a valid
#    signature (WinVerifyTrust on the file's own Authenticode signature, without the slow online
#    revocation lookups; else Windows' catalog signatures, as Get-AuthenticodeSignature reads them),
#    and who signed it.
# Writes JSON on stdout.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

if ($mode -eq 'shortcuts') {
  $sh = New-Object -ComObject WScript.Shell
  $dirs = @([Environment]::GetFolderPath('CommonPrograms'), [Environment]::GetFolderPath('Programs'))
  $out = foreach ($d in $dirs) {
    if (-not $d -or -not (Test-Path -LiteralPath $d)) { continue }
    foreach ($f in Get-ChildItem -LiteralPath $d -Recurse -Filter *.lnk -Depth 4) {
      try { $t = $sh.CreateShortcut($f.FullName).TargetPath } catch { continue }
      if ($t -and $t.ToLower().EndsWith('.exe') -and (Test-Path -LiteralPath $t)) { [pscustomobject]@{ name = $f.BaseName; lnk = $f.FullName; exe = $t } }
    }
  }
  ConvertTo-Json -InputObject @($out) -Compress
}

if ($mode -eq 'packages') {
  $pk = @{}
  foreach ($p in Get-AppxPackage) { $pk[$p.PackageFamilyName] = $p }
  $out = foreach ($a in Get-StartApps) {
    if ($a.AppID -notlike '*!*') { continue }
    $fam, $id = $a.AppID -split '!', 2
    $p = $pk[$fam]
    if (-not $p) { continue }
    $pub = ''
    $logo = ''
    try {
      [xml]$m = Get-Content -LiteralPath (Join-Path $p.InstallLocation 'AppxManifest.xml') -Raw -Encoding UTF8
      $pub = [string]$m.Package.Properties.PublisherDisplayName
      $node = @($m.Package.Applications.Application) | Where-Object { $_.Id -eq $id } | Select-Object -First 1
      $logo = [string]$node.VisualElements.Square44x44Logo
    } catch {}
    [pscustomobject]@{ name = $a.Name; appid = $a.AppID; kind = "$($p.SignatureKind)"; location = $p.InstallLocation; publisher = $pub; logo = $logo }
  }
  ConvertTo-Json -InputObject @($out) -Compress -Depth 3
}

if ($mode -eq 'verify') {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class UnkTrust {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct FileInfo { public uint cbStruct; public string path; public IntPtr hFile; public IntPtr known; }
  [StructLayout(LayoutKind.Sequential)]
  struct Data { public uint cbStruct; public IntPtr policy; public IntPtr sip; public uint ui; public uint revoke; public uint choice; public IntPtr file; public uint action; public IntPtr state; public IntPtr url; public uint flags; public uint context; public IntPtr sigSettings; }
  [DllImport("wintrust.dll", CharSet = CharSet.Unicode)] static extern int WinVerifyTrust(IntPtr hwnd, ref Guid action, ref Data data);
  // WINTRUST_ACTION_GENERIC_VERIFY_V2 on the file's own signature: no UI, no revocation lookups
  public static bool Check(string path) {
    var fi = new FileInfo { cbStruct = (uint)Marshal.SizeOf(typeof(FileInfo)), path = path };
    var pfi = Marshal.AllocHGlobal(Marshal.SizeOf(fi));
    Marshal.StructureToPtr(fi, pfi, false);
    var d = new Data { cbStruct = (uint)Marshal.SizeOf(typeof(Data)), ui = 2, revoke = 0, choice = 1, file = pfi, action = 1, flags = 0x10 };
    var g = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
    int r = WinVerifyTrust(IntPtr.Zero, ref g, ref d);
    d.action = 2;
    WinVerifyTrust(IntPtr.Zero, ref g, ref d);
    Marshal.FreeHGlobal(pfi);
    return r == 0;
  }
}
'@
  $paths = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $out = foreach ($f in @($paths)) {
    $ok = [UnkTrust]::Check($f)
    $signer = ''
    if ($ok) {
      try { $signer = ([Security.Cryptography.X509Certificates.X509Certificate2]::new([Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($f))).GetNameInfo('SimpleName', $false) } catch {}
    } else {
      $a = Get-AuthenticodeSignature -LiteralPath $f
      if ($a.Status -eq 'Valid') {
        $ok = $true
        $signer = $a.SignerCertificate.GetNameInfo('SimpleName', $false)
      }
    }
    [pscustomobject]@{ path = $f; ok = $ok; signer = $signer }
  }
  ConvertTo-Json -InputObject @($out) -Compress
}
