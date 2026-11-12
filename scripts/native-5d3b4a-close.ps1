param([Parameter(Mandatory=$true)][int]$ProcessId)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Nomina4aClose {
 public delegate bool Callback(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)]public struct RECT{public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")]public static extern bool EnumWindows(Callback c,IntPtr p);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern bool GetClientRect(IntPtr h,out RECT r);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 public static List<IntPtr> Windows(uint pid){var a=new List<IntPtr>();EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==pid)a.Add(h);return true;},IntPtr.Zero);return a;}
}
'@
$windows=@([Nomina4aClose]::Windows($ProcessId)|ForEach-Object{ $r=[Nomina4aClose+RECT]::new();[void][Nomina4aClose]::GetClientRect($_,[ref]$r);$t=[Text.StringBuilder]::new(512);$c=[Text.StringBuilder]::new(256);[void][Nomina4aClose]::GetWindowText($_,$t,512);[void][Nomina4aClose]::GetClassName($_,$c,256);@{handle=$_.ToInt64();title=$t.ToString();class=$c.ToString();visible=[Nomina4aClose]::IsWindowVisible($_);width=$r.Right;height=$r.Bottom}})
$main=@($windows|Where-Object{$_.visible -and $_.title -eq 'Calculadora de Nómina' -and $_.width -ge 300 -and $_.height -ge 200})
if($main.Count -ne 1){throw "Expected exactly one owned application client window: $($windows|ConvertTo-Json -Compress)"}
$posted=[Nomina4aClose]::PostMessage([IntPtr]$main[0].handle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
@{posted=$posted;selected=$main[0];ownedWindows=$windows}|ConvertTo-Json -Depth 5 -Compress
