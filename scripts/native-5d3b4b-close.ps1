param([Parameter(Mandatory=$true)][int]$ProcessId)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Text;
public static class Fiscal4bWindow {
 public delegate bool Callback(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)]public struct RECT{public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")]public static extern bool EnumWindows(Callback c,IntPtr p);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern bool GetClientRect(IntPtr h,out RECT r);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 public static List<IntPtr> Windows(uint pid){var a=new List<IntPtr>();EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==pid)a.Add(h);return true;},IntPtr.Zero);return a;}
}
'@
$windows=@([Fiscal4bWindow]::Windows($ProcessId)|ForEach-Object{$r=[Fiscal4bWindow+RECT]::new();[void][Fiscal4bWindow]::GetClientRect($_,[ref]$r);$t=[Text.StringBuilder]::new(512);[void][Fiscal4bWindow]::GetWindowText($_,$t,512);@{handle=$_.ToInt64();title=$t.ToString();shown=[Fiscal4bWindow]::IsWindowVisible($_);width=$r.Right;height=$r.Bottom}})
$main=@($windows|Where-Object{$_.shown -and $_.title.StartsWith('Calculadora de Nómina') -and $_.width -ge 300 -and $_.height -ge 200})
if($main.Count -ne 1){throw 'Exactly one owned application client is required'}
@{posted=[Fiscal4bWindow]::PostMessage([IntPtr]$main[0].handle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero);selected=$main[0]}|ConvertTo-Json -Depth 3 -Compress
