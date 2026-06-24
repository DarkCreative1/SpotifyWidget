# Kalici mod: stdin'den komut okur, stdout'a JSON yazar.
# WinRT SMTC session bir kez acilir, kapanmaz.
$ErrorActionPreference = "SilentlyContinue"

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $t) {
    $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op))
    if ($task.Wait(4000)) { return $task.Result }
    return $null
}
function BoolJson($r) { if ($r -eq $true) { 'true' } else { 'false' } }

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.MediaPlaybackAutoRepeatMode, Windows.Media, ContentType=WindowsRuntime] | Out-Null

# SMTC oturumunu al (her komutta degil, bir kez al; session degisince yenile)
$mgr = $null
$session = $null

function Get-Session {
    if ($null -eq $mgr) {
        $script:mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    }
    $s = $null
    try {
        foreach ($ss in $mgr.GetSessions()) {
            if ($ss.SourceAppUserModelId -like '*Spotify*') { $s = $ss; break }
        }
    } catch {}
    if (-not $s) { $s = $mgr.GetCurrentSession() }
    return $s
}

function Handle-Cmd($line) {
    $parts = $line.Trim() -split '\s+', 2
    $cmd   = $parts[0].ToLower()
    $arg   = if ($parts.Count -gt 1) { $parts[1] } else { '' }

    $session = Get-Session
    if (-not $session -and $cmd -ne 'ping') {
        return '{"ok":false,"error":"no-session"}'
    }

    try {
        switch ($cmd) {
            'ping'   { return '{"ok":true,"pong":true}' }
            'caps' {
                $info = $session.GetPlaybackInfo(); $c = $info.Controls
                $shufActive = $false; $repMode = 0
                try { if ($null -ne $info.IsShuffleActive) { $shufActive = [bool]$info.IsShuffleActive.Value } } catch {}
                try { if ($null -ne $info.AutoRepeatMode)  { $repMode = [int]$info.AutoRepeatMode.Value }       } catch {}
                $o = [ordered]@{
                    ok=$true; appId=$session.SourceAppUserModelId; status=[int]$info.PlaybackStatus
                    play=[bool]$c.IsPlayEnabled; pause=[bool]$c.IsPauseEnabled
                    next=[bool]$c.IsNextEnabled; prev=[bool]$c.IsPreviousEnabled
                    toggle=[bool]$c.IsPlayPauseToggleEnabled
                    shuffle=[bool]$c.IsShuffleEnabled; repeat=[bool]$c.IsRepeatEnabled
                    seek=[bool]$c.IsPlaybackPositionEnabled
                    shuffleActive=$shufActive; repeatMode=$repMode
                }
                return ($o | ConvertTo-Json -Compress)
            }
            'play'    { return ('{\"ok\":' + (BoolJson (Await ($session.TryPlayAsync()) ([bool]))) + '}') }
            'pause'   { return ('{\"ok\":' + (BoolJson (Await ($session.TryPauseAsync()) ([bool]))) + '}') }
            'toggle'  { return ('{\"ok\":' + (BoolJson (Await ($session.TryTogglePlayPauseAsync()) ([bool]))) + '}') }
            'next'    { return ('{\"ok\":' + (BoolJson (Await ($session.TrySkipNextAsync()) ([bool]))) + '}') }
            'prev'    { return ('{\"ok\":' + (BoolJson (Await ($session.TrySkipPreviousAsync()) ([bool]))) + '}') }
            'stop'    { return ('{\"ok\":' + (BoolJson (Await ($session.TryStopAsync()) ([bool]))) + '}') }
            'shuffle' {
                $info = $session.GetPlaybackInfo(); $cur = $false
                try { if ($null -ne $info.IsShuffleActive) { $cur = [bool]$info.IsShuffleActive.Value } } catch {}
                $new = -not $cur
                $r = Await ($session.TryChangeShuffleActiveAsync($new)) ([bool])
                return ('{\"ok\":' + (BoolJson $r) + ',\"shuffleActive\":' + ($new.ToString().ToLower()) + '}')
            }
            'repeat' {
                $info = $session.GetPlaybackInfo(); $mode = 0
                try { if ($null -ne $info.AutoRepeatMode) { $mode = [int]$info.AutoRepeatMode.Value } } catch {}
                $next = ($mode + 1) % 3
                $r = Await ($session.TryChangeAutoRepeatModeAsync([Windows.Media.MediaPlaybackAutoRepeatMode]$next)) ([bool])
                return ('{\"ok\":' + (BoolJson $r) + ',\"repeatMode\":' + $next + '}')
            }
            'seek' {
                $pos = 0
                if ([long]::TryParse($arg, [ref]$pos)) { if ($pos -lt 0) { $pos = 0 } }
                $ticks = [long]($pos * 10000)
                $r = Await ($session.TryChangePlaybackPositionAsync($ticks)) ([bool])
                return ('{\"ok\":' + (BoolJson $r) + '}')
            }
            default { return '{"ok":false,"error":"unknown-cmd"}' }
        }
    } catch {
        return ('{"ok":false,"error":' + (ConvertTo-Json $_.Exception.Message -Compress) + '}')
    }
}

# Hazir sinyali
[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()

$reader = [Console]::In
while ($true) {
    try {
        $line = $reader.ReadLine()
        if ($null -eq $line) { break }
        $line = $line.Trim()
        if ($line -eq '') { continue }

        $result = Handle-Cmd $line
        [Console]::Out.WriteLine($result)
        [Console]::Out.Flush()
    } catch {
        [Console]::Out.WriteLine('{"ok":false,"error":"exception"}')
        [Console]::Out.Flush()
    }
}
