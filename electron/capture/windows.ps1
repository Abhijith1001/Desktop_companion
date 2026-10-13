# Window geometry for the buddy's "sit on top of a window" behaviour.
# Long-running: reads one command per line on stdin, answers one JSON line.
#   fg            the foreground window
#   rect <hwnd>   a specific window ({"gone":true} once closed, minimised or hidden)
# Rectangles are in physical pixels; the caller converts them to DIPs.
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BuddyWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
}
'@

function Describe([IntPtr]$hwnd) {
  if ($hwnd -eq [IntPtr]::Zero -or -not [BuddyWin]::IsWindow($hwnd) -or -not [BuddyWin]::IsWindowVisible($hwnd) -or [BuddyWin]::IsIconic($hwnd)) {
    return @{ gone = $true }
  }
  $cloaked = 0
  [void][BuddyWin]::DwmGetWindowAttribute($hwnd, 14, [ref]$cloaked, 4)   # DWMWA_CLOAKED (other virtual desktop)
  if ($cloaked -ne 0) { return @{ gone = $true } }
  $r = New-Object BuddyWin+RECT
  # DWMWA_EXTENDED_FRAME_BOUNDS excludes the invisible resize border.
  if ([BuddyWin]::DwmGetWindowAttribute($hwnd, 9, [ref]$r, 16) -ne 0) { [void][BuddyWin]::GetWindowRect($hwnd, [ref]$r) }
  $procId = [uint32]0
  [void][BuddyWin]::GetWindowThreadProcessId($hwnd, [ref]$procId)
  return @{
    hwnd = $hwnd.ToInt64(); pid = $procId; maximized = [BuddyWin]::IsZoomed($hwnd)
    x = $r.Left; y = $r.Top; w = $r.Right - $r.Left; h = $r.Bottom - $r.Top
  }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $parts = $line.Trim() -split '\s+'
    if ($parts[0] -eq 'fg') { $out = Describe ([BuddyWin]::GetForegroundWindow()) }
    elseif ($parts[0] -eq 'rect') { $out = Describe ([IntPtr][long]$parts[1]) }
    else { $out = @{ error = 'unknown command' } }
  } catch {
    $out = @{ error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}
