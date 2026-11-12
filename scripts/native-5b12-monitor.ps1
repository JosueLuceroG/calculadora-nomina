param([ValidateSet('inspect','move')][string]$Action='inspect',[int]$ProcessId=0,[int]$Index=0)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class IntegralMonitors {
 public delegate bool Callback(IntPtr m,IntPtr dc,IntPtr rect,IntPtr data);
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct INFO {public int Size;public RECT Monitor,Work;public uint Flags;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string Device;}
 [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr dc,IntPtr rect,Callback callback,IntPtr data);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr m,ref INFO info);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT rect);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int z,uint flags);
 public static List<INFO> All(){var result=new List<INFO>();EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,(m,dc,r,d)=>{var i=new INFO();i.Size=Marshal.SizeOf(i);GetMonitorInfo(m,ref i);result.Add(i);return true;},IntPtr.Zero);return result;}
}
'@
$old=[IntegralMonitors]::SetThreadDpiAwarenessContext([IntPtr](-4))
try {
 $screens=@([IntegralMonitors]::All())
 if($Action -eq 'move'){
  $p=Get-Process -Id $ProcessId
  if($p.ProcessName -ne 'calculadora-nomina' -or $p.MainWindowHandle -eq 0){throw 'Se requiere la ventana propia de la calculadora QA.'}
  if($Index -lt 0 -or $Index -ge $screens.Count){throw 'Monitor no disponible.'}
  $r=[IntegralMonitors+RECT]::new();[void][IntegralMonitors]::GetWindowRect($p.MainWindowHandle,[ref]$r);$s=$screens[$Index].Work
  $x=$s.Left+[Math]::Max(0,($s.Right-$s.Left-($r.Right-$r.Left))/2);$y=$s.Top+[Math]::Max(0,($s.Bottom-$s.Top-($r.Bottom-$r.Top))/2)
  if(![IntegralMonitors]::SetWindowPos($p.MainWindowHandle,[IntPtr]::Zero,[int]$x,[int]$y,0,0,0x0015)){throw 'No se pudo mover la ventana QA.'}
  Start-Sleep -Milliseconds 600
 }
 @{action=$Action;monitors=@($screens | ForEach-Object {@{device=$_.Device;primary=($_.Flags -band 1) -ne 0;bounds=$_.Monitor;work=$_.Work}});target=$Index} | ConvertTo-Json -Depth 6 -Compress
} finally {[void][IntegralMonitors]::SetThreadDpiAwarenessContext($old)}
