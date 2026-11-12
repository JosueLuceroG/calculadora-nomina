param([Parameter(Mandatory=$true)][int]$ProcessId,[ValidateSet('inspect','save','cancel')][string]$Action='inspect',[string]$FilePath)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Text;
public static class DocumentaryDialog {
 public delegate bool Callback(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback c,IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h,Callback c,IntPtr p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,string l);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 public static List<IntPtr> Owned(uint pid){var r=new List<IntPtr>();EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);var c=new StringBuilder(128);var s=new StringBuilder(512);GetClassName(h,c,128);GetWindowText(h,s,512);if(id==pid&&IsWindowVisible(h)&&c.ToString()=="#32770"&&s.ToString().StartsWith("Guardar reporte de simulación salarial"))r.Add(h);return true;},IntPtr.Zero);return r;}
 public static List<IntPtr> Editors(IntPtr h){var r=new List<IntPtr>();EnumChildWindows(h,(x,p)=>{var c=new StringBuilder(128);GetClassName(x,c,128);int id=GetDlgCtrlID(x);if(c.ToString()=="Edit"&&(id==1148||id==1001))r.Add(x);return true;},IntPtr.Zero);return r;}
}
'@
if((Get-Process -Id $ProcessId).ProcessName -ne 'calculadora-nomina'){throw 'Only the owned calculator is allowed'}
$windows=@(foreach($h in [DocumentaryDialog]::Owned([uint32]$ProcessId)){$editors=@([DocumentaryDialog]::Editors($h));@{handle=$h.ToInt64();editors=@($editors|ForEach-Object {$_.ToInt64()});ready=($editors.Count -eq 1)}})
if($Action -ne 'inspect'){if($windows.Count -ne 1 -or !$windows[0].ready){throw 'Expected one ready owned native documentary save dialog'};$w=$windows[0];if($Action -eq 'save'){if(!$FilePath){throw 'QA output path required'};[void][DocumentaryDialog]::SendMessage([IntPtr]$w.editors[0],0x000C,[IntPtr]::Zero,$FilePath);[void][DocumentaryDialog]::PostMessage([IntPtr]$w.handle,0x0111,[IntPtr]1,[IntPtr]::Zero)}else{[void][DocumentaryDialog]::PostMessage([IntPtr]$w.handle,0x0111,[IntPtr]2,[IntPtr]::Zero)}}
@{windows=$windows;action=$Action}|ConvertTo-Json -Depth 5 -Compress
