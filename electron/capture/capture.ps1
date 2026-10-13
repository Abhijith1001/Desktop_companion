# Desktop Buddy - one-shot capture helper. Runs only when the user asks for a
# capture (shortcut / button) and exits; it never monitors anything.
#
#   -Mode info       foreground window details only
#   -Mode selection  selected text via UI Automation; with -AllowCopy, falls
#                    back to sending Ctrl+C (the caller saves/restores the clipboard)
#   -Mode ocr        screenshot of the foreground window -> Windows OCR (in memory only)
#
# Writes exactly one JSON object to stdout.
param(
  [ValidateSet('info', 'selection', 'ocr')][string]$Mode = 'selection',
  [switch]$AllowCopy,
  [int]$MaxChars = 100000
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Out-Result($obj) {
  [Console]::Out.Write(($obj | ConvertTo-Json -Compress -Depth 4))
  exit 0
}

try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class BuddyNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
  [void][BuddyNative]::SetProcessDPIAware()

  # The capture shortcut is usually still held down. Wait (max 1.5 s) until
  # Ctrl/Shift/Alt/Win are released so a synthetic Ctrl+C is not turned into
  # Ctrl+Shift+C (DevTools in browsers) or similar.
  $deadline = [DateTime]::UtcNow.AddMilliseconds(1500)
  while ([DateTime]::UtcNow -lt $deadline) {
    $held = @(0x10, 0x11, 0x12, 0x5B, 0x5C) | Where-Object { [BuddyNative]::GetAsyncKeyState($_) -band 0x8000 }
    if (-not $held) { break }
    Start-Sleep -Milliseconds 30
  }

  $hwnd = [BuddyNative]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) { Out-Result @{ ok = $false; reason = 'no-window' } }
  $procId = [uint32]0
  [void][BuddyNative]::GetWindowThreadProcessId($hwnd, [ref]$procId)
  $sb = New-Object System.Text.StringBuilder 512
  [void][BuddyNative]::GetWindowText($hwnd, $sb, 512)

  $processName = $null; $appName = $null
  try {
    $p = Get-Process -Id $procId
    $processName = $p.ProcessName
    try { $appName = $p.MainModule.FileVersionInfo.FileDescription } catch { } # elevated apps deny this
  } catch { }
  if (-not $appName) { $appName = $processName }

  $info = @{ pid = [int]$procId; process = $processName; app = $appName; title = $sb.ToString() }

  # Browser address bar via UI Automation (Chromium-based and Firefox). Only
  # reports what the bar actually shows; the user can edit it before saving.
  function Get-BrowserUrl {
    if (@('chrome', 'msedge', 'brave', 'vivaldi', 'opera', 'firefox') -notcontains $processName) { return $null }
    try {
      Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
      $edit = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      if (-not $edit) { return $null }
      $vp = $null
      if (-not $edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { return $null }
      $v = $vp.Current.Value.Trim()
      if ($v -match '^(https?|file)://\S+$') { return $v }
      # Chromium hides "https://" in the omnibox.
      if ($v -match '^[\w-]+(\.[\w-]+)+(:\d+)?(/\S*)?$') { return "https://$v" }
    } catch { }
    return $null
  }

  if ($Mode -eq 'info') { Out-Result ($info + @{ ok = $true; url = (Get-BrowserUrl) }) }

  if ($Mode -eq 'ocr') {
    $r = New-Object BuddyNative+RECT
    [void][BuddyNative]::GetWindowRect($hwnd, [ref]$r)
    Add-Type -AssemblyName System.Drawing, System.Windows.Forms
    $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $left = [Math]::Max($r.Left, $vs.Left); $top = [Math]::Max($r.Top, $vs.Top)
    $right = [Math]::Min($r.Right, $vs.Right); $bottom = [Math]::Min($r.Bottom, $vs.Bottom)
    $w = $right - $left; $h = $bottom - $top
    if ($w -lt 8 -or $h -lt 8) { Out-Result ($info + @{ ok = $false; reason = 'window-too-small' }) }

    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($left, $top, 0, 0, $bmp.Size)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $ms.Position = 0

    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    function Await($op, [Type]$type) {
      $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
      [void]$task.Wait(15000)
      $task.Result
    }

    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (-not $engine) { Out-Result ($info + @{ ok = $false; reason = 'ocr-unavailable' }) }
    $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $soft = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($soft)) ([Windows.Media.Ocr.OcrResult])
    $ms.Dispose()
    $text = ($result.Lines | ForEach-Object { $_.Text }) -join "`n"
    if ($text.Length -gt $MaxChars) { $text = $text.Substring(0, $MaxChars) }
    Out-Result ($info + @{ ok = [bool]$text; method = 'ocr'; text = $text; url = (Get-BrowserUrl); reason = $(if ($text) { $null } else { 'no-text' }) })
  }

  # ---- selection: 1) UI Automation TextPattern on the focused element
  $text = $null
  try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $el = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($el -and $el.Current.ProcessId -eq $procId) {
      if ($el.Current.IsPassword) { Out-Result ($info + @{ ok = $false; reason = 'password-field' }) }
      $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
      for ($i = 0; $el -and $i -lt 6 -and -not $text; $i++) {
        $tp = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
          $parts = foreach ($range in $tp.GetSelection()) { $range.GetText($MaxChars) }
          $joined = ($parts -join "`n")
          if ($joined -and $joined.Trim()) { $text = $joined }
        }
        $el = $walker.GetParent($el)
      }
    }
  } catch { }
  if ($text) { Out-Result ($info + @{ ok = $true; method = 'uia'; text = $text; url = (Get-BrowserUrl) }) }

  # ---- 2) Clipboard fallback: synthetic Ctrl+C, detect via sequence number.
  if ($AllowCopy) {
    $before = [BuddyNative]::GetClipboardSequenceNumber()
    [BuddyNative]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)   # Ctrl down
    [BuddyNative]::keybd_event(0x43, 0, 0, [UIntPtr]::Zero)   # C down
    [BuddyNative]::keybd_event(0x43, 0, 2, [UIntPtr]::Zero)   # C up
    [BuddyNative]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)   # Ctrl up
    $deadline = [DateTime]::UtcNow.AddMilliseconds(900)
    while ([DateTime]::UtcNow -lt $deadline -and [BuddyNative]::GetClipboardSequenceNumber() -eq $before) { Start-Sleep -Milliseconds 25 }
    $copied = [BuddyNative]::GetClipboardSequenceNumber() -ne $before
    $clipUrl = $null
    if ($copied) {
      Start-Sleep -Milliseconds 60 # let the app finish writing all formats
      # Browsers record the page address in the CF_HTML header ("SourceURL:").
      try {
        Add-Type -AssemblyName System.Windows.Forms
        $h = [System.Windows.Forms.Clipboard]::GetData('HTML Format')
        if ($h -is [System.IO.Stream]) { $h = (New-Object System.IO.StreamReader($h, [System.Text.Encoding]::UTF8)).ReadToEnd() }
        if ($h -and ([string]$h).Substring(0, [Math]::Min(4096, ([string]$h).Length)) -match '(?m)^SourceURL:(\S+)\s*$') { $clipUrl = $Matches[1] }
      } catch { }
    }
    Out-Result ($info + @{ ok = $copied; method = 'clipboard'; copied = $copied; clipUrl = $clipUrl; url = (Get-BrowserUrl); reason = $(if ($copied) { $null } else { 'no-selection' }) })
  }

  Out-Result ($info + @{ ok = $false; reason = 'no-selection' })
} catch {
  Out-Result @{ ok = $false; reason = 'error'; error = $_.Exception.Message }
}
