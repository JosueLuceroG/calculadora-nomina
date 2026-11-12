param([Parameter(Mandatory=$true)][int]$ProcessId,[ValidateSet('inspect','save','cancel','capture')][string]$Action='inspect',[string]$FilePath,[string]$OutputPath)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Text;
public static class FiscalDialogNative {
 public delegate bool Callback(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback c,IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h,Callback c,IntPtr p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint command);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,string l);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
 public static List<IntPtr> Owned(uint pid){var list=new List<IntPtr>();EnumWindows((h,p)=>{uint owner;GetWindowThreadProcessId(h,out owner);var c=new StringBuilder(128);var t=new StringBuilder(512);GetClassName(h,c,128);GetWindowText(h,t,512);if(owner==pid&&IsWindowVisible(h)&&c.ToString()=="#32770"&&t.ToString().StartsWith("Importar"))list.Add(h);return true;},IntPtr.Zero);return list;}
 public static List<IntPtr> Editors(IntPtr dialog){var list=new List<IntPtr>();EnumChildWindows(dialog,(h,p)=>{var c=new StringBuilder(128);GetClassName(h,c,128);int id=GetDlgCtrlID(h);if(c.ToString()=="Edit"&&(id==1148||id==1001))list.Add(h);return true;},IntPtr.Zero);return list;}
}
'@
$process=Get-Process -Id $ProcessId
if($process.ProcessName -ne 'calculadora-nomina'){throw 'Only the owned calculator QA process is allowed'}
$windows=@(foreach($h in [FiscalDialogNative]::Owned([uint32]$ProcessId)){$title=[Text.StringBuilder]::new(512);[void][FiscalDialogNative]::GetWindowText($h,$title,512);$editors=@([FiscalDialogNative]::Editors($h));@{handle=$h.ToInt64();title=$title.ToString();ownerHandle=([FiscalDialogNative]::GetWindow($h,4)).ToInt64();editors=@($editors|ForEach-Object {$_.ToInt64()});ready=($editors.Count -eq 1)}})
if($Action -ne 'inspect'){
 if($windows.Count -ne 1){throw 'Expected exactly one owned import dialog'}
 $w=$windows[0];$h=[IntPtr]$w.handle
 if($Action -eq 'save'){if(!$FilePath -or !$w.ready){throw 'Expected native filename editor'};[void][FiscalDialogNative]::SendMessage([IntPtr]$w.editors[0],0x000C,[IntPtr]::Zero,$FilePath);[void][FiscalDialogNative]::PostMessage($h,0x0111,[IntPtr]1,[IntPtr]::Zero)}
 if($Action -eq 'cancel'){[void][FiscalDialogNative]::PostMessage($h,0x0111,[IntPtr]2,[IntPtr]::Zero)}
 if($Action -eq 'capture'){if(!$OutputPath -or !(Test-Path -LiteralPath (Split-Path -Parent $OutputPath))){throw 'Output parent required'};$r=[FiscalDialogNative+RECT]::new();[void][FiscalDialogNative]::GetWindowRect($h,[ref]$r);$b=[Drawing.Bitmap]::new($r.Right-$r.Left,$r.Bottom-$r.Top);$g=[Drawing.Graphics]::FromImage($b);try{$dc=$g.GetHdc();try{if(![FiscalDialogNative]::PrintWindow($h,$dc,2)){throw 'Native dialog capture failed'}}finally{$g.ReleaseHdc($dc)};$b.Save($OutputPath,[Drawing.Imaging.ImageFormat]::Png)}finally{$g.Dispose();$b.Dispose()}}
}
@{action=$Action;windows=$windows}|ConvertTo-Json -Depth 6 -Compress
