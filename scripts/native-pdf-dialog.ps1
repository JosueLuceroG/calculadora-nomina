param([Parameter(Mandatory=$true)][int]$ProcessId,[ValidateSet('inspect','set-name','save','cancel','yes','no','accept','capture')][string]$Action='inspect',[string]$FilePath,[string]$OutputPath)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class PdfDialogNative {
 public delegate bool Callback(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback c,IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h,Callback c,IntPtr p);
 [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h,uint message,IntPtr w,string l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr h,uint message,IntPtr w,StringBuilder l,uint flags,uint timeout,out IntPtr result);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint message,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 public static List<IntPtr> Owned(uint pid){var result=new List<IntPtr>();EnumWindows((h,p)=>{uint owner;GetWindowThreadProcessId(h,out owner);var s=new StringBuilder(256);GetClassName(h,s,256);if(owner==pid&&IsWindowVisible(h)&&s.ToString()=="#32770")result.Add(h);return true;},IntPtr.Zero);return result;}
 public static object[] Children(IntPtr parent){var list=new List<object>();EnumChildWindows(parent,(h,p)=>{var c=new StringBuilder(128);var t=new StringBuilder(512);GetClassName(h,c,128);int id=GetDlgCtrlID(h);if(id==1001&&c.ToString()=="Edit"){IntPtr result;SendMessageTimeout(h,0x000D,(IntPtr)512,t,2,1000,out result);}else GetWindowText(h,t,512);list.Add(new{handle=h.ToInt64(),id,type=c.ToString(),name=t.ToString()});return true;},IntPtr.Zero);return list.ToArray();}
}
'@
$app=Get-Process -Id $ProcessId
if($app.ProcessName -ne 'calculadora-nomina'){throw 'Solo se admiten diálogos propios de la calculadora de prueba.'}
$title='Guardar PDF de prueba - Calculadora de Nómina'
$windows=@(foreach($h in [PdfDialogNative]::Owned([uint32]$ProcessId)){$element=[Windows.Automation.AutomationElement]::FromHandle($h);$name=[Text.StringBuilder]::new(512);[void][PdfDialogNative]::GetWindowText($h,$name,512);@{handle=$h.ToInt64();title=$name.ToString();element=$element;children=[PdfDialogNative]::Children($h)}})
function Controls($element){try{$all=$element.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition);$picker=@($all|Where-Object {$_.Current.AutomationId -eq '1001' -and $_.Current.ControlType -eq [Windows.Automation.ControlType]::Edit}).Count -gt 0;@($all|ForEach-Object {try{if($_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -or $_.Current.ControlType -eq [Windows.Automation.ControlType]::Edit -or (!$picker -and $_.Current.ControlType -eq [Windows.Automation.ControlType]::Text)){@{id=$_.Current.AutomationId;name=$_.Current.Name;type=$_.Current.ControlType.ProgrammaticName;enabled=$_.Current.IsEnabled}}}catch{}})}catch{@()}}
function Button($element,$id){$condition=[Windows.Automation.AndCondition]::new([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,[string]$id),[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button));$button=$element.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition);if(!$button){$names=switch($id){'1'{'^(Aceptar|OK|Guardar|Save)$'}'2'{'^(Cancelar|Cancel)$'}'6'{'^(Sí|Yes|Reemplazar|Replace)$'}'7'{'^(No)$'}};$button=@($element.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button))|Where-Object {$_.Current.Name.Replace('&','') -match $names})[0]};if(!$button){throw "No se encontró el botón nativo $id"};$pattern=$button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern);$pattern.Invoke()}
$windowInfo=@($windows|ForEach-Object {@{handle=$_.handle;title=$_.title;controls=@(Controls $_.element);children=@($_.children)}})
$mainIds=@($windowInfo|Where-Object {@($_.controls|Where-Object {$_.id -eq '1001' -and $_.type -eq 'ControlType.Edit'}).Count -gt 0 -or @($_.children|Where-Object {$_.id -eq 1001 -and $_.type -eq 'Edit'}).Count -gt 0}|ForEach-Object {$_.handle})
$main=@($windows|Where-Object {$_.handle -in $mainIds})
$popup=@($windows|Where-Object {$_.handle -notin $mainIds})
if($Action -in @('save','set-name')){
 if($main.Count -ne 1 -or !$FilePath){throw 'Se requiere el diálogo propio de guardar y una ruta de prueba.'}
 $nativeEdit=@($main[0].children|Where-Object {$_.id -eq 1001 -and $_.type -eq 'Edit'})
 if($nativeEdit.Count -eq 1){[void][PdfDialogNative]::SendMessage([IntPtr]$nativeEdit[0].handle,0x000C,[IntPtr]::Zero,$FilePath)}else{
  $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,'1001');$edit=$main[0].element.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition);if(!$edit){throw 'No se encontró Nombre de archivo (1001).'};$pattern=$edit.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern);$pattern.SetValue($FilePath)
 };if($Action -eq 'save'){[void][PdfDialogNative]::PostMessage([IntPtr]$main[0].handle,0x0111,[IntPtr]1,[IntPtr]::Zero)}
}elseif($Action -eq 'cancel'){if($main.Count -ne 1){throw 'No hay diálogo propio de guardar para cancelar.'};[void][PdfDialogNative]::PostMessage([IntPtr]$main[0].handle,0x0111,[IntPtr]2,[IntPtr]::Zero)}
elseif($Action -in @('yes','no','accept')){if($popup.Count -lt 1){throw 'No hay aviso nativo propio disponible.'};$caption=if($Action -eq 'yes'){'^(Sí|Yes|Reemplazar|Replace)$'}elseif($Action -eq 'no'){'^No$'}else{'^(Aceptar|OK)$'};$buttons=@($popup[0].children|Where-Object {$_.type -eq 'Button' -and $_.name.Replace('&','').Trim() -match $caption});if($buttons.Count -ne 1){throw "No se identificó el botón del aviso: $Action"};[void][PdfDialogNative]::PostMessage([IntPtr]$buttons[0].handle,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)}
elseif($Action -eq 'capture'){
 if(!$OutputPath -or !(Test-Path -LiteralPath (Split-Path -Parent $OutputPath))){throw 'La carpeta de captura debe existir.'}
 $target=if($popup.Count){$popup[0]}elseif($main.Count){$main[0]}else{throw 'No hay diálogo propio visible para capturar.'}
 $old=[PdfDialogNative]::SetThreadDpiAwarenessContext([IntPtr](-4))
 try{$r=[PdfDialogNative+RECT]::new();[void][PdfDialogNative]::GetWindowRect([IntPtr]$target.handle,[ref]$r);$bitmap=[Drawing.Bitmap]::new($r.Right-$r.Left,$r.Bottom-$r.Top);$g=[Drawing.Graphics]::FromImage($bitmap);try{$dc=$g.GetHdc();try{$ok=[PdfDialogNative]::PrintWindow([IntPtr]$target.handle,$dc,2)}finally{$g.ReleaseHdc($dc)};if(!$ok){throw 'No se pudo capturar el diálogo nativo.'};$bitmap.Save($OutputPath,[Drawing.Imaging.ImageFormat]::Png)}finally{$g.Dispose();$bitmap.Dispose()}}finally{[void][PdfDialogNative]::SetThreadDpiAwarenessContext($old)}
}
@{action=$Action;windows=$windowInfo;screenshot=$OutputPath}|ConvertTo-Json -Depth 7 -Compress
