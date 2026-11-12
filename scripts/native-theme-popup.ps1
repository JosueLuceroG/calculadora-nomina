param([Parameter(Mandatory=$true)][int]$ProcessId,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public static class ThemePopupWindow {
 public delegate bool Callback(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb,IntPtr p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 public static List<IntPtr> Visible(){var result=new List<IntPtr>();EnumWindows((h,p)=>{if(IsWindowVisible(h))result.Add(h);return true;},IntPtr.Zero);return result;}
}
'@
$app=Get-Process -Id $ProcessId
if($app.ProcessName -ne 'calculadora-nomina'){throw 'La captura debe pertenecer a la calculadora de prueba.'}
if(!(Test-Path -LiteralPath (Split-Path -Parent $OutputPath))){throw 'La carpeta de captura debe existir.'}
$ids=[Collections.Generic.HashSet[int]]::new()
[void]$ids.Add($ProcessId)
$all=@(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'")
for($i=0;$i -lt 5;$i++){foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)){[void]$ids.Add([int]$p.ProcessId)}}}
$old=[ThemePopupWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
try{
 $windows=@(foreach($h in [ThemePopupWindow]::Visible()){$owner=0u;[void][ThemePopupWindow]::GetWindowThreadProcessId($h,[ref]$owner);if($ids.Contains([int]$owner) -and $h -ne $app.MainWindowHandle){$r=[ThemePopupWindow+RECT]::new();[void][ThemePopupWindow]::GetWindowRect($h,[ref]$r);$s=[Text.StringBuilder]::new(256);[void][ThemePopupWindow]::GetClassName($h,$s,256);if(($r.Right-$r.Left) -gt 100 -and ($r.Bottom-$r.Top) -gt 100){@{handle=$h.ToInt64();pid=$owner;class=$s.ToString();rect=$r}}}})
 $captured=$false
 if($windows.Count -eq 1){$w=$windows[0];$bitmap=[Drawing.Bitmap]::new($w.rect.Right-$w.rect.Left,$w.rect.Bottom-$w.rect.Top);$g=[Drawing.Graphics]::FromImage($bitmap);try{$dc=$g.GetHdc();try{$captured=[ThemePopupWindow]::PrintWindow([IntPtr]$w.handle,$dc,2)}finally{$g.ReleaseHdc($dc)};if($captured){$bitmap.Save($OutputPath,[Drawing.Imaging.ImageFormat]::Png)}}finally{$g.Dispose();$bitmap.Dispose()}}
 @{captured=$captured;windows=$windows;output=if($captured){$OutputPath}else{$null}}|ConvertTo-Json -Depth 6 -Compress
}finally{[void][ThemePopupWindow]::SetThreadDpiAwarenessContext($old)}
