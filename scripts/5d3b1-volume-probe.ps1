param([string]$EvidenceRoot = "$PSScriptRoot/../docs/evidence/5d3b1")
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $EvidenceRoot)) { throw 'Evidence parent does not exist' }
if (-not (Test-Path -LiteralPath "$env:TEMP/opencode")) { throw 'QA temporary parent does not exist' }
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
public static class FiscalVolumeProbe {
  [StructLayout(LayoutKind.Sequential)] struct Storage { public uint Device; public Guid Vendor; }
  [StructLayout(LayoutKind.Explicit, Size=56)] struct Create {
    [FieldOffset(0)] public uint Version;
    [FieldOffset(8)] public Guid Id;
    [FieldOffset(24)] public ulong Maximum;
    [FieldOffset(32)] public uint Block;
    [FieldOffset(36)] public uint Sector;
    [FieldOffset(40)] public IntPtr Parent;
    [FieldOffset(48)] public IntPtr Source;
  }
  [StructLayout(LayoutKind.Sequential)] struct Attach { public uint Version; public uint Reserved; }
  [DllImport("virtdisk.dll",CharSet=CharSet.Unicode)] static extern uint CreateVirtualDisk(ref Storage s,string p,uint access,IntPtr sd,uint flags,uint provider,ref Create c,IntPtr overlap,out IntPtr handle);
  [DllImport("virtdisk.dll")] static extern uint AttachVirtualDisk(IntPtr h,IntPtr sd,uint flags,uint provider,ref Attach a,IntPtr overlap);
  [DllImport("virtdisk.dll")] static extern uint DetachVirtualDisk(IntPtr h,uint flags,uint provider);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static uint[] Run(string path) {
    IntPtr h=IntPtr.Zero; bool attached=false;
    var storage=new Storage{Device=2,Vendor=new Guid("ec984aec-a0f9-47e9-901f-71415a66345b")};
    var create=new Create{Version=1,Id=Guid.NewGuid(),Maximum=67108864,Sector=512};
    try {
      uint made=CreateVirtualDisk(ref storage,path,0x3f0000,IntPtr.Zero,0,0,ref create,IntPtr.Zero,out h);
      if(made!=0)return new uint[]{made,0xffffffff};
      var a=new Attach{Version=1};uint mount=AttachVirtualDisk(h,IntPtr.Zero,2,0,ref a,IntPtr.Zero);attached=mount==0;
      return new uint[]{made,mount};
    } finally { if(attached)DetachVirtualDisk(h,0,0);if(h!=IntPtr.Zero)CloseHandle(h);if(File.Exists(path))File.Delete(path); }
  }
}
'@
$path = Join-Path "$env:TEMP/opencode" "5d3b1-volume-$([Guid]::NewGuid()).vhd"
$result = [FiscalVolumeProbe]::Run($path)
$record = [ordered]@{
  recordedAt = [DateTime]::UtcNow.ToString('o')
  nativeApi = 'CreateVirtualDisk/AttachVirtualDisk; isolated64MiB; no host volume filled'
  createWin32Error = $result[0]
  attachWin32Error = $result[1]
  status = $(if ($result[0] -eq 0 -and $result[1] -eq 0) { 'qa-volume-available; full-volume-test-not-yet-run' } else { 'blocked-no-attach-privilege; full-volume-test-not-run' })
  sqliteQuotaIsNotFullVolume = $true
  temporaryVhdRemoved = (-not (Test-Path -LiteralPath $path))
}
$json = $record | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $EvidenceRoot 'volume-probe.json'), $json + "`n", [Text.UTF8Encoding]::new($false))
$json
