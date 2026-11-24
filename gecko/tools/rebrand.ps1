param(
  [Parameter(Mandatory)][string]$Exe,
  [string]$Name = 'Wings',
  [string]$Company = 'Wings',
  [string]$Icon = ''
)
# Gives an executable our name and icon in Windows (Task Manager, Explorer, the taskbar read them from
# its version and icon resources), with Windows' own resource API: nothing else is changed in it.
# Its version numbers are kept; the file's digital signature no longer matches afterwards (it is our
# build now).
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class Rebrand {
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string f, IntPtr h, uint flags);
  [DllImport("kernel32")] static extern bool FreeLibrary(IntPtr h);
  [DllImport("kernel32", SetLastError = true)] static extern IntPtr FindResourceEx(IntPtr h, IntPtr type, IntPtr name, ushort lang);
  [DllImport("kernel32")] static extern IntPtr LoadResource(IntPtr h, IntPtr r);
  [DllImport("kernel32")] static extern IntPtr LockResource(IntPtr r);
  [DllImport("kernel32")] static extern uint SizeofResource(IntPtr h, IntPtr r);
  delegate bool EnumLang(IntPtr h, IntPtr type, IntPtr name, ushort lang, IntPtr p);
  delegate bool EnumName(IntPtr h, IntPtr type, IntPtr name, IntPtr p);
  [DllImport("kernel32")] static extern bool EnumResourceLanguages(IntPtr h, IntPtr type, IntPtr name, EnumLang f, IntPtr p);
  [DllImport("kernel32")] static extern bool EnumResourceNames(IntPtr h, IntPtr type, EnumName f, IntPtr p);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string f, bool del);
  [DllImport("kernel32", SetLastError = true)] static extern bool UpdateResource(IntPtr h, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool UpdateResource(IntPtr h, IntPtr type, string name, ushort lang, byte[] data, uint size);
  [DllImport("kernel32", SetLastError = true)] static extern bool EndUpdateResource(IntPtr h, bool discard);

  static readonly IntPtr RT_ICON = (IntPtr)3, RT_GROUP_ICON = (IntPtr)14, RT_VERSION = (IntPtr)16;

  // ---- reading what is there
  static ushort FirstLang(IntPtr m, IntPtr type, IntPtr name) {
    ushort found = 0; bool any = false;
    EnumResourceLanguages(m, type, name, (h, t, n, l, p) => { if (!any) { found = l; any = true; } return true; }, IntPtr.Zero);
    return found;
  }
  static byte[] Read(IntPtr m, IntPtr type, IntPtr name, ushort lang) {
    IntPtr r = FindResourceEx(m, type, name, lang);
    if (r == IntPtr.Zero) return null;
    uint n = SizeofResource(m, r);
    byte[] b = new byte[n];
    Marshal.Copy(LockResource(LoadResource(m, r)), b, 0, (int)n);
    return b;
  }

  // ---- a VS_VERSIONINFO, written as Windows reads it
  static void Pad(MemoryStream s) { while (s.Length % 4 != 0) s.WriteByte(0); }
  static byte[] Block(string key, byte[] value, bool text, int valueLen, List<byte[]> children) {
    var s = new MemoryStream(); var w = new BinaryWriter(s);
    w.Write((ushort)0); w.Write((ushort)valueLen); w.Write((ushort)(text ? 1 : 0));
    w.Write(Encoding.Unicode.GetBytes(key + "\0")); Pad(s);
    if (value != null) { w.Write(value); Pad(s); }
    if (children != null) foreach (var c in children) { w.Write(c); Pad(s); }
    byte[] b = s.ToArray();
    BitConverter.GetBytes((ushort)b.Length).CopyTo(b, 0);
    return b;
  }
  static byte[] Str(string key, string value) {
    byte[] v = Encoding.Unicode.GetBytes(value + "\0");
    return Block(key, v, true, value.Length + 1, null);
  }
  static byte[] Version(byte[] fixedInfo, string name, string company, string exeName, string ver) {
    var strings = new List<byte[]> {
      Str("CompanyName", company), Str("FileDescription", name), Str("FileVersion", ver),
      Str("InternalName", Path.GetFileNameWithoutExtension(exeName)), Str("LegalCopyright", "Based on Mozilla Firefox (MPL-2.0)"),
      Str("OriginalFilename", exeName), Str("ProductName", name), Str("ProductVersion", ver)
    };
    var table = Block("040904B0", null, true, 0, strings);
    var sfi = Block("StringFileInfo", null, true, 0, new List<byte[]> { table });
    var var_ = Block("Translation", new byte[] { 0x09, 0x04, 0xB0, 0x04 }, false, 4, null);
    var vfi = Block("VarFileInfo", null, true, 0, new List<byte[]> { var_ });
    return Block("VS_VERSION_INFO", fixedInfo, false, 52, new List<byte[]> { sfi, vfi });
  }

  public static string Apply(string exe, string name, string company, string icon) {
    var log = new StringBuilder();
    IntPtr m = LoadLibraryEx(exe, IntPtr.Zero, 0x00000002 | 0x00000020);
    if (m == IntPtr.Zero) throw new Exception("cannot open " + exe);
    ushort vlang = FirstLang(m, RT_VERSION, (IntPtr)1);
    byte[] old = Read(m, RT_VERSION, (IntPtr)1, vlang);
    // the icon group Windows shows: the first one
    object group = null; ushort glang = 0;
    EnumResourceNames(m, RT_GROUP_ICON, (h, t, n, p) => {
      group = ((long)n >> 16) == 0 ? (object)(int)(long)n : Marshal.PtrToStringUni(n);
      return false;
    }, IntPtr.Zero);
    if (group != null) glang = FirstLang(m, RT_GROUP_ICON, group is int ? (IntPtr)(int)group : Marshal.StringToHGlobalUni((string)group));
    FreeLibrary(m);
    byte[] fixedInfo = new byte[52];
    if (old != null && BitConverter.ToUInt32(old, 40) == 0xFEEF04BD) Array.Copy(old, 40, fixedInfo, 0, 52);
    else {
      // (a program of ours with none yet: version 1.0.0.0, an application for Windows)
      var fw = new BinaryWriter(new MemoryStream(fixedInfo));
      fw.Write(0xFEEF04BD); fw.Write(0x00010000u); fw.Write(0x00010000u); fw.Write(0u); fw.Write(0x00010000u); fw.Write(0u);
      fw.Write(0x3Fu); fw.Write(0u); fw.Write(0x40004u); fw.Write(1u); fw.Write(0u); fw.Write(0u); fw.Write(0u);
      vlang = 1033;
    }
    if (group == null) { group = 1; glang = 1033; }
    uint ms = BitConverter.ToUInt32(fixedInfo, 8), ls = BitConverter.ToUInt32(fixedInfo, 12);
    string ver = (ms >> 16) + "." + (ms & 0xFFFF) + "." + (ls >> 16) + "." + (ls & 0xFFFF);

    IntPtr u = BeginUpdateResource(exe, false);
    if (u == IntPtr.Zero) throw new Exception("cannot write " + exe + " (" + Marshal.GetLastWin32Error() + ")");
    byte[] vi = Version(fixedInfo, name, company, Path.GetFileName(exe), ver);
    if (!UpdateResource(u, RT_VERSION, (IntPtr)1, vlang, vi, (uint)vi.Length)) throw new Exception("version: " + Marshal.GetLastWin32Error());
    log.Append("version " + ver + " lang " + vlang);
    if (icon != "" && File.Exists(icon) && group != null) {
      byte[] ico = File.ReadAllBytes(icon);
      int count = BitConverter.ToUInt16(ico, 4);
      var grp = new MemoryStream(); var gw = new BinaryWriter(grp);
      gw.Write((ushort)0); gw.Write((ushort)1); gw.Write((ushort)count);
      for (int i = 0; i < count; i++) {
        int e = 6 + i * 16;
        int size = BitConverter.ToInt32(ico, e + 8), off = BitConverter.ToInt32(ico, e + 12);
        byte[] img = new byte[size]; Array.Copy(ico, off, img, 0, size);
        ushort id = (ushort)(30000 + i);
        if (!UpdateResource(u, RT_ICON, (IntPtr)id, glang, img, (uint)size)) throw new Exception("icon: " + Marshal.GetLastWin32Error());
        gw.Write(ico, e, 12); gw.Write(id);
      }
      byte[] g = grp.ToArray();
      bool ok = group is int ? UpdateResource(u, RT_GROUP_ICON, (IntPtr)(int)group, glang, g, (uint)g.Length) : UpdateResource(u, RT_GROUP_ICON, (string)group, glang, g, (uint)g.Length);
      if (!ok) throw new Exception("icon group: " + Marshal.GetLastWin32Error());
      log.Append(", icon group " + group + " (" + count + " images)");
    }
    if (!EndUpdateResource(u, false)) throw new Exception("save: " + Marshal.GetLastWin32Error());
    return log.ToString();
  }
}
'@
"$(Split-Path $Exe -Leaf): " + [Rebrand]::Apply((Resolve-Path $Exe).Path, $Name, $Company, $Icon)
