param([Parameter(Mandatory=$true)][int]$ProcessId,[Parameter(Mandatory=$true)][long]$MenuHandle,[Parameter(Mandatory=$true)][int]$ItemIndex,[int]$ItemCount=4,[switch]$HoverOnly)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NominaMenuInput {
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h,uint message,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
}
'@
$app=Get-Process -Id $ProcessId
if($app.ProcessName -ne 'calculadora-nomina'){throw 'Solo se admite la calculadora de prueba.'}
if($ItemIndex -lt 0 -or $ItemIndex -ge $ItemCount -or $ItemCount -ne 4){throw 'Índice de periodicidad inválido.'}
$ids=[Collections.Generic.HashSet[int]]::new();[void]$ids.Add($ProcessId)
$all=@(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'")
for($i=0;$i -lt 5;$i++){foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)){[void]$ids.Add([int]$p.ProcessId)}}}
$h=[IntPtr]$MenuHandle;$owner=0u;[void][NominaMenuInput]::GetWindowThreadProcessId($h,[ref]$owner)
if(!$ids.Contains([int]$owner) -or ![NominaMenuInput]::IsWindowVisible($h)){throw 'El menú debe estar abierto y pertenecer al WebView2 propio.'}
$r=[NominaMenuInput+RECT]::new();[void][NominaMenuInput]::GetClientRect($h,[ref]$r)
if($r.Bottom -gt 300 -or $r.Bottom -lt 70){throw 'Geometría inesperada del menú de cuatro opciones.'}
$x=[int]($r.Right/2);$y=[int](2+($ItemIndex+0.5)*(($r.Bottom-4)/$ItemCount));$point=[IntPtr](($y -shl 16) -bor $x)
$result=[IntPtr]::Zero
# Mensajes de ratón al HWND nativo abierto, no eventos DOM ni cambios de value.
# No se desplaza el cursor del usuario ni se envía entrada a otras aplicaciones.
if([NominaMenuInput]::SendMessageTimeout($h,0x0200,[IntPtr]::Zero,$point,2,3000,[ref]$result) -eq [IntPtr]::Zero){throw 'El menú no respondió al movimiento.'}
if(!$HoverOnly){
 if([NominaMenuInput]::SendMessageTimeout($h,0x0201,[IntPtr]1,$point,2,3000,[ref]$result) -eq [IntPtr]::Zero){throw 'El menú no respondió al clic.'}
 [void][NominaMenuInput]::SendMessageTimeout($h,0x0202,[IntPtr]::Zero,$point,2,3000,[ref]$result)
}
@{menu=$MenuHandle;processId=$owner;itemIndex=$ItemIndex;clientPoint=@($x,$y);hoverOnly=[bool]$HoverOnly;method='WM_MOUSEMOVE/WM_LBUTTONDOWN/WM_LBUTTONUP'}|ConvertTo-Json -Compress
