# The Start menu's Wings shortcut: the launcher (Wings.exe) with its icon, carrying the taskbar name the
# browser's windows carry (System.AppUserModel.ID = Wings.Browser, set by Backend.sys.mjs). With it, the
# windows group under it on the taskbar, and pinning a window pins this shortcut - the launcher, not the
# engine inside. Run again after moving the folder.
#   powershell -File gecko\tools\shortcut.ps1 [-Remove]
param([switch]$Remove, [string]$Id = 'Wings.Browser', [string]$Name = 'Wings')
$ErrorActionPreference = 'Stop'
$gecko = Split-Path -Parent $PSScriptRoot
$target = Join-Path $gecko 'Wings.exe'
$lnk = Join-Path ([Environment]::GetFolderPath('Programs')) "$Name.lnk"
if ($Remove) { Remove-Item -LiteralPath $lnk -ErrorAction SilentlyContinue; "removed $lnk"; return }
if (-not (Test-Path $target)) { throw "no launcher at $target" }

Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

public static class WingsShortcut {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class CShellLink {}

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
  interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder f, int n, IntPtr fd, uint flags);
    void GetIDList(out IntPtr pidl);
    void SetIDList(IntPtr pidl);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int n);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string s);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int n);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string s);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int n);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string s);
    void GetHotkey(out short k);
    void SetHotkey(short k);
    void GetShowCmd(out int c);
    void SetShowCmd(int c);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int n, out int i);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string s, int i);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string s, uint r);
    void Resolve(IntPtr hwnd, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string s);
  }

  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  struct PROPERTYKEY { public Guid fmtid; public uint pid; }

  // (a PROPVARIANT holding a string: VT_LPWSTR = 31; 24 bytes on 64-bit Windows)
  [StructLayout(LayoutKind.Explicit, Size = 24)]
  struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
  interface IPropertyStore {
    void GetCount(out uint n);
    void GetAt(uint i, out PROPERTYKEY k);
    void GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
    void SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
    void Commit();
  }

  public static void Make(string lnk, string target, string dir, string icon, string desc, string appId) {
    var link = (IShellLinkW)new CShellLink();
    link.SetPath(target);
    link.SetWorkingDirectory(dir);
    link.SetIconLocation(icon, 0);
    link.SetDescription(desc);
    var store = (IPropertyStore)link;
    // System.AppUserModel.ID
    var key = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    var v = new PROPVARIANT { vt = 31, p = Marshal.StringToCoTaskMemUni(appId) };
    try { store.SetValue(ref key, ref v); store.Commit(); } finally { Marshal.FreeCoTaskMem(v.p); }
    ((IPersistFile)link).Save(lnk, true);
  }
}
'@

[WingsShortcut]::Make($lnk, $target, $gecko, $target, 'Wings - trình duyệt', $Id)
# (read back: what Windows sees)
$item = (New-Object -ComObject Shell.Application).Namespace((Split-Path $lnk)).ParseName((Split-Path $lnk -Leaf))
"wrote $lnk -> $target (AppUserModel.ID: $($item.ExtendedProperty('System.AppUserModel.ID')))"
