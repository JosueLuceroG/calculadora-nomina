param(
  [ValidateSet('inspect', 'capture', 'resize', 'close', 'maximize', 'restore')][string]$Action = 'inspect',
  [int]$ProcessId = 0,
  [int]$Width = 1180,
  [int]$Height = 760,
  [string]$OutputPath
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NominaNativeVerification {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MINMAXINFO { public POINT Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int Size; public RECT Monitor, Work; public uint Flags; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
}
'@
$oldDpi = [NominaNativeVerification]::SetThreadDpiAwarenessContext([IntPtr](-4))
try {
  $app = if ($ProcessId) { Get-Process -Id $ProcessId } else {
    $apps = @(Get-Process -Name 'calculadora-nomina' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
    if ($apps.Count -ne 1) { throw "Se requiere exactamente una aplicación propia, encontradas: $($apps.Count)" }
    $apps[0]
  }
  $app.Refresh()
  $handle = $app.MainWindowHandle
  if ($handle -eq 0) { throw 'No hay ventana nativa visible disponible.' }
  $outer = [NominaNativeVerification+RECT]::new()
  $client = [NominaNativeVerification+RECT]::new()
  [void][NominaNativeVerification]::GetWindowRect($handle, [ref]$outer)
  [void][NominaNativeVerification]::GetClientRect($handle, [ref]$client)
  $scale = [NominaNativeVerification]::GetDpiForWindow($handle) / 96.0
  $frameWidth = $outer.Right - $outer.Left - $client.Right
  $frameHeight = $outer.Bottom - $outer.Top - $client.Bottom
  if ($Action -eq 'resize') {
    [void][NominaNativeVerification]::SetWindowPos($handle, [IntPtr]::Zero, $outer.Left, $outer.Top, [int]($Width * $scale + $frameWidth), [int]($Height * $scale + $frameHeight), 0x0014)
    Start-Sleep -Milliseconds 300
  }
  if ($Action -eq 'maximize' -or $Action -eq 'restore') {
    $command = if ($Action -eq 'maximize') { 0xF030 } else { 0xF120 }
    [void][NominaNativeVerification]::SendMessage($handle, 0x0112, [IntPtr]$command, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 300
  }
  if ($Action -eq 'close') {
    @{ posted = [NominaNativeVerification]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); pid = $app.Id } | ConvertTo-Json -Compress
    return
  }
  [void][NominaNativeVerification]::GetWindowRect($handle, [ref]$outer)
  [void][NominaNativeVerification]::GetClientRect($handle, [ref]$client)
  $monitor = [NominaNativeVerification+MONITORINFO]::new()
  $monitor.Size = [Runtime.InteropServices.Marshal]::SizeOf($monitor)
  [void][NominaNativeVerification]::GetMonitorInfo([NominaNativeVerification]::MonitorFromWindow($handle, 2), [ref]$monitor)
  $limits = [NominaNativeVerification+MINMAXINFO]::new()
  $buffer = [Runtime.InteropServices.Marshal]::AllocHGlobal([Runtime.InteropServices.Marshal]::SizeOf($limits))
  try {
    [Runtime.InteropServices.Marshal]::StructureToPtr($limits, $buffer, $false)
    [void][NominaNativeVerification]::SendMessage($handle, 0x0024, [IntPtr]::Zero, $buffer)
    $limits = [Runtime.InteropServices.Marshal]::PtrToStructure($buffer, [type][NominaNativeVerification+MINMAXINFO])
  } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
  $reply = [IntPtr]::Zero
  $pingAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $responding = [NominaNativeVerification]::SendMessageTimeout($handle, 0, [IntPtr]::Zero, [IntPtr]::Zero, 2, 1000, [ref]$reply) -ne [IntPtr]::Zero
  $watch.Stop()
  if ($Action -eq 'capture') {
    if (!$OutputPath -or !(Test-Path -LiteralPath (Split-Path -Parent $OutputPath))) { throw 'La carpeta de captura debe existir.' }
    $bitmap = [Drawing.Bitmap]::new($outer.Right - $outer.Left, $outer.Bottom - $outer.Top)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $dc = $graphics.GetHdc()
      try { $printed = [NominaNativeVerification]::PrintWindow($handle, $dc, 2) } finally { $graphics.ReleaseHdc($dc) }
      if (!$printed) { throw 'PrintWindow no pudo capturar la ventana Windows.' }
      $bitmap.Save($OutputPath, [Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
  $webviews = @(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*3b4-profile-*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { @{ pid = $_.ProcessId; parentPid = $_.ParentProcessId; commandLine = $_.CommandLine } })
  @{
    pid = $app.Id; session = $app.SessionId; executable = $app.Path; title = $app.MainWindowTitle; handle = $handle.ToInt64()
    visible = [NominaNativeVerification]::IsWindowVisible($handle); maximized = [NominaNativeVerification]::IsZoomed($handle)
    hung = [NominaNativeVerification]::IsHungAppWindow($handle); responding = $responding; nativePingMs = $watch.Elapsed.TotalMilliseconds; pingAtUtc = $pingAtUtc
    dpi = [NominaNativeVerification]::GetDpiForWindow($handle); scale = $scale
    clientPhysical = @($client.Right, $client.Bottom); clientLogical = @(($client.Right / $scale), ($client.Bottom / $scale))
    minimumClientLogical = @((($limits.MinTrackSize.X - $frameWidth) / $scale), (($limits.MinTrackSize.Y - $frameHeight) / $scale))
    outer = $outer; monitor = $monitor.Monitor; work = $monitor.Work; screenshot = $OutputPath; webviewProcesses = $webviews
  } | ConvertTo-Json -Depth 8 -Compress
} finally { [void][NominaNativeVerification]::SetThreadDpiAwarenessContext($oldDpi) }
