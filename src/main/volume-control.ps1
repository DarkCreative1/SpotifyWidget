# Kalici mod: stdin'den komut okur, stdout'a JSON yazar. Kapanmaz.
$ErrorActionPreference = "SilentlyContinue"

if (-not ("Seffaf.Audio" -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace Seffaf {
  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceCollection {
    int GetCount();
    [return: MarshalAs(UnmanagedType.Interface)] IMMDevice Item(int index);
  }
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwStateMask, [Out, MarshalAs(UnmanagedType.Interface)] out IMMDeviceCollection ppDevices);
    IMMDevice GetDefaultAudioEndpoint(int dataFlow, int role);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice {
    void Activate(ref Guid iid, int clsctx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionManager2 {
    [PreserveSig] int NotUsed0();
    [PreserveSig] int NotUsed1();
    [PreserveSig] int GetSessionEnumerator(out IntPtr pSessionList);
  }

  delegate int GetCountDelegate(IntPtr self, out int count);
  delegate int GetSessionDelegate(IntPtr self, int index, out IntPtr session);
  delegate int GetDisplayNameDelegate(IntPtr self, out IntPtr pName);
  delegate void SetMasterVolumeDelegate(IntPtr self, float level, Guid ctx);
  delegate void GetMasterVolumeDelegate(IntPtr self, out float level);
  delegate void SetMuteDelegate(IntPtr self, int mute, Guid ctx);
  delegate void GetMuteDelegate(IntPtr self, out int mute);

  public static class Audio {
    static readonly Guid savIid = new Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8");
    static readonly System.Globalization.CultureInfo INV = System.Globalization.CultureInfo.InvariantCulture;

    // Cacheleme: Spotify SAV pointer'ini tekrar aramaktan kac
    static IntPtr _cachedSav = IntPtr.Zero;

    static IntPtr QiRaw(IntPtr punk, Guid iid) {
      IntPtr p = IntPtr.Zero;
      Marshal.QueryInterface(punk, ref iid, out p);
      return p;
    }

    static IntPtr FindSpotifySav() {
      // Cache'li pointer hala gecerliyse kullan (AddRef yapilmis olmali ama crash riski icin dogrula)
      if (_cachedSav != IntPtr.Zero) {
        try {
          // Gecerli mi test et
          IntPtr vt = Marshal.ReadIntPtr(_cachedSav);
          var gm = Marshal.GetDelegateForFunctionPointer<GetMasterVolumeDelegate>(Marshal.ReadIntPtr(vt, 4 * IntPtr.Size));
          float tv; gm(_cachedSav, out tv);
          return _cachedSav;
        } catch { _cachedSav = IntPtr.Zero; }
      }

      var devEnumType = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"));
      var devEnum = (IMMDeviceEnumerator)Activator.CreateInstance(devEnumType);
      IMMDeviceCollection coll;
      devEnum.EnumAudioEndpoints(0, 1, out coll);
      if (coll == null) return IntPtr.Zero;
      var mgrIid = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");

      for (int d = 0; d < coll.GetCount(); d++) {
        IMMDevice dev = coll.Item(d);
        if (dev == null) continue;
        object smObj;
        try { dev.Activate(ref mgrIid, 1, IntPtr.Zero, out smObj); } catch { continue; }
        if (smObj == null) continue;

        var mgr = (IAudioSessionManager2)smObj;
        IntPtr enPtr;
        try { mgr.GetSessionEnumerator(out enPtr); } catch { continue; }
        if (enPtr == IntPtr.Zero) continue;

        IntPtr vtEn = Marshal.ReadIntPtr(enPtr);
        var getCount   = Marshal.GetDelegateForFunctionPointer<GetCountDelegate>(Marshal.ReadIntPtr(vtEn, 3 * IntPtr.Size));
        var getSession = Marshal.GetDelegateForFunctionPointer<GetSessionDelegate>(Marshal.ReadIntPtr(vtEn, 4 * IntPtr.Size));
        int cnt; getCount(enPtr, out cnt);

        for (int i = 0; i < cnt; i++) {
          IntPtr sp; getSession(enPtr, i, out sp);
          if (sp == IntPtr.Zero) continue;

          string sessName = "";
          try {
            IntPtr vtSp = Marshal.ReadIntPtr(sp);
            var getDN = Marshal.GetDelegateForFunctionPointer<GetDisplayNameDelegate>(Marshal.ReadIntPtr(vtSp, 4 * IntPtr.Size));
            IntPtr np; getDN(sp, out np);
            if (np != IntPtr.Zero) { sessName = Marshal.PtrToStringUni(np) ?? ""; Marshal.FreeCoTaskMem(np); }
          } catch {}

          if (sessName.IndexOf("spotify", StringComparison.OrdinalIgnoreCase) < 0) continue;

          IntPtr savPtr = QiRaw(sp, savIid);
          if (savPtr != IntPtr.Zero) {
            _cachedSav = savPtr;
            return savPtr;
          }
        }
      }
      return IntPtr.Zero;
    }

    static void GetVtFns(IntPtr p,
      out SetMasterVolumeDelegate sm, out GetMasterVolumeDelegate gm,
      out SetMuteDelegate smt, out GetMuteDelegate gmt) {
      IntPtr vt = Marshal.ReadIntPtr(p);
      sm  = Marshal.GetDelegateForFunctionPointer<SetMasterVolumeDelegate>(Marshal.ReadIntPtr(vt, 3 * IntPtr.Size));
      gm  = Marshal.GetDelegateForFunctionPointer<GetMasterVolumeDelegate>(Marshal.ReadIntPtr(vt, 4 * IntPtr.Size));
      smt = Marshal.GetDelegateForFunctionPointer<SetMuteDelegate>(Marshal.ReadIntPtr(vt, 5 * IntPtr.Size));
      gmt = Marshal.GetDelegateForFunctionPointer<GetMuteDelegate>(Marshal.ReadIntPtr(vt, 6 * IntPtr.Size));
    }

    public static string Get() {
      IntPtr sav = FindSpotifySav();
      if (sav == IntPtr.Zero) return "{\"ok\":false,\"error\":\"no-spotify\"}";
      SetMasterVolumeDelegate sm; GetMasterVolumeDelegate gm; SetMuteDelegate smt; GetMuteDelegate gmt;
      GetVtFns(sav, out sm, out gm, out smt, out gmt);
      float vol = 0f; int mute = 0; gm(sav, out vol); gmt(sav, out mute);
      return "{\"ok\":true,\"level\":" + vol.ToString("0.###", INV) + ",\"muted\":" + (mute != 0 ? "true" : "false") + "}";
    }

    public static string Set(float level) {
      IntPtr sav = FindSpotifySav();
      if (sav == IntPtr.Zero) return "{\"ok\":false,\"error\":\"no-spotify\"}";
      SetMasterVolumeDelegate sm; GetMasterVolumeDelegate gm; SetMuteDelegate smt; GetMuteDelegate gmt;
      GetVtFns(sav, out sm, out gm, out smt, out gmt);
      float lvl = Math.Max(0f, Math.Min(1f, level));
      sm(sav, lvl, Guid.Empty);
      int mute = 0; gmt(sav, out mute);
      return "{\"ok\":true,\"level\":" + lvl.ToString("0.###", INV) + ",\"muted\":" + (mute != 0 ? "true" : "false") + "}";
    }

    public static string Mute(bool mute) {
      IntPtr sav = FindSpotifySav();
      if (sav == IntPtr.Zero) return "{\"ok\":false,\"error\":\"no-spotify\"}";
      SetMasterVolumeDelegate sm; GetMasterVolumeDelegate gm; SetMuteDelegate smt; GetMuteDelegate gmt;
      GetVtFns(sav, out sm, out gm, out smt, out gmt);
      smt(sav, mute ? 1 : 0, Guid.Empty);
      return mute ? "{\"ok\":true,\"muted\":true}" : "{\"ok\":true,\"muted\":false}";
    }
  }
}
"@ 2>$null
}

# Hazir sinyali - Node.js bekliyor
[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()

# Komut dongusu - stdin'den oku, stdout'a yaz
$reader = [Console]::In
while ($true) {
  try {
    $line = $reader.ReadLine()
    if ($null -eq $line) { break }   # stdin kapandi
    $line = $line.Trim()
    if ($line -eq "") { continue }

    $parts = $line -split ' ', 2
    $cmd   = $parts[0].ToLower()
    $arg   = if ($parts.Count -gt 1) { $parts[1] } else { "" }

    $result = switch ($cmd) {
      'get'    { [Seffaf.Audio]::Get() }
      'set'    {
        $lvl = 0.0
        if ([double]::TryParse($arg, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$lvl)) {
          [Seffaf.Audio]::Set([float]$lvl)
        } else { '{"ok":false,"error":"bad-level"}' }
      }
      'mute'   { [Seffaf.Audio]::Mute($true) }
      'unmute' { [Seffaf.Audio]::Mute($false) }
      'ping'   { '{"ok":true,"pong":true}' }
      default  { '{"ok":false,"error":"unknown-cmd"}' }
    }

    [Console]::Out.WriteLine($result)
    [Console]::Out.Flush()
  } catch {
    [Console]::Out.WriteLine('{"ok":false,"error":"exception"}')
    [Console]::Out.Flush()
  }
}
