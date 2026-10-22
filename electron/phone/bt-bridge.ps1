# Bluetooth bridge to the Buddy Link phone app. Connects (RFCOMM) to a paired
# phone running the app and copies its JSON lines to stdout, adding its own
# {"t":"status"} lines. Retries forever; the parent process stops it.
# Uses only Windows' built-in Bluetooth sockets, so nothing to install.
param([string]$Prefer = '')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class BuddyBridge {
  // Must match LinkServer.SERVICE in the phone app.
  static readonly Guid Service = new Guid("6f1c2b8e-5d3a-4c7e-9a41-b2d7e0c3f915");
  const AddressFamily AF_BTH = (AddressFamily)32;
  const ProtocolType BTHPROTO_RFCOMM = (ProtocolType)3;

  [StructLayout(LayoutKind.Sequential)]
  struct SYSTEMTIME { public ushort a, b, c, d, e, f, g, h; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct DEVICE_INFO {
    public int dwSize; public ulong Address; public uint ulClassofDevice;
    [MarshalAs(UnmanagedType.Bool)] public bool fConnected;
    [MarshalAs(UnmanagedType.Bool)] public bool fRemembered;
    [MarshalAs(UnmanagedType.Bool)] public bool fAuthenticated;
    public SYSTEMTIME stLastSeen; public SYSTEMTIME stLastUsed;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string szName;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct SEARCH_PARAMS {
    public int dwSize;
    [MarshalAs(UnmanagedType.Bool)] public bool fReturnAuthenticated;
    [MarshalAs(UnmanagedType.Bool)] public bool fReturnRemembered;
    [MarshalAs(UnmanagedType.Bool)] public bool fReturnUnknown;
    [MarshalAs(UnmanagedType.Bool)] public bool fReturnConnected;
    [MarshalAs(UnmanagedType.Bool)] public bool fIssueInquiry;
    public byte cTimeoutMultiplier;
    public IntPtr hRadio;
  }

  [DllImport("bthprops.cpl")] static extern IntPtr BluetoothFindFirstDevice(ref SEARCH_PARAMS p, ref DEVICE_INFO info);
  [DllImport("bthprops.cpl")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool BluetoothFindNextDevice(IntPtr h, ref DEVICE_INFO info);
  [DllImport("bthprops.cpl")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool BluetoothFindDeviceClose(IntPtr h);

  // SOCKADDR_BTH (packed): family(2) addr(8) serviceClassId(16) port(4).
  class BthEndPoint : EndPoint {
    readonly ulong addr;
    public BthEndPoint(ulong a) { addr = a; }
    public override AddressFamily AddressFamily { get { return AF_BTH; } }
    public override SocketAddress Serialize() {
      var sa = new SocketAddress(AF_BTH, 30);
      byte[] a = BitConverter.GetBytes(addr);
      for (int i = 0; i < 8; i++) sa[2 + i] = a[i];
      byte[] g = Service.ToByteArray();
      for (int i = 0; i < 16; i++) sa[10 + i] = g[i];
      return sa; // port 0: Windows looks the service up on the phone
    }
    public override EndPoint Create(SocketAddress sa) { return this; }
  }

  class Phone { public ulong Addr; public string Name; }

  static readonly object outLock = new object();
  static void Emit(string line) { lock (outLock) { Console.Out.WriteLine(line); Console.Out.Flush(); } }
  static string Esc(string s) {
    var b = new StringBuilder();
    foreach (char c in s ?? "") {
      if (c == '"' || c == '\\') b.Append('\\').Append(c);
      else if (c < ' ') b.AppendFormat("\\u{0:x4}", (int)c);
      else b.Append(c);
    }
    return b.ToString();
  }
  static void Status(string state, string device, string error) {
    Emit("{\"t\":\"status\",\"state\":\"" + state + "\",\"device\":" + (device == null ? "null" : "\"" + Esc(device) + "\"")
      + ",\"error\":" + (error == null ? "null" : "\"" + Esc(error) + "\"") + "}");
  }

  // Paired devices that look like phones (major class 2), or all paired ones
  // if the class is unknown.
  static List<Phone> PairedPhones() {
    var list = new List<Phone>();
    var p = new SEARCH_PARAMS();
    p.dwSize = Marshal.SizeOf(typeof(SEARCH_PARAMS));
    p.fReturnAuthenticated = true; p.fReturnRemembered = true;
    var info = new DEVICE_INFO();
    info.dwSize = Marshal.SizeOf(typeof(DEVICE_INFO));
    IntPtr h = BluetoothFindFirstDevice(ref p, ref info);
    if (h == IntPtr.Zero) return list;
    try {
      do {
        uint major = (info.ulClassofDevice >> 8) & 0x1F;
        if ((major == 2 || info.ulClassofDevice == 0) && (info.fAuthenticated || info.fRemembered))
          list.Add(new Phone { Addr = info.Address, Name = info.szName });
        info = new DEVICE_INFO();
        info.dwSize = Marshal.SizeOf(typeof(DEVICE_INFO));
      } while (BluetoothFindNextDevice(h, ref info));
    } finally { BluetoothFindDeviceClose(h); }
    return list;
  }

  static string Mac(ulong a) {
    var s = a.ToString("X12");
    return string.Join(":", new[] { s.Substring(0, 2), s.Substring(2, 2), s.Substring(4, 2), s.Substring(6, 2), s.Substring(8, 2), s.Substring(10, 2) });
  }

  // Reads the phone's lines until the link drops. The phone sends at least
  // every 20 s, so 60 s of silence means it's gone.
  static void Session(Socket s, Phone ph) {
    s.ReceiveTimeout = 60000;
    s.SendTimeout = 60000;
    using (var stream = new NetworkStream(s, true))
    using (var reader = new StreamReader(stream, new UTF8Encoding(false))) {
      lock (sendLock) current = stream;
      try {
        Status("connected", ph.Name, null);
        Emit("{\"t\":\"device\",\"mac\":\"" + Mac(ph.Addr) + "\"}");
        string line;
        while ((line = reader.ReadLine()) != null) {
          if (line.Length > 0 && line[0] == '{') Emit(line);
        }
      } finally {
        lock (sendLock) current = null;
      }
    }
  }

  // Lines from the app (file transfers) go to the phone while it's connected.
  static readonly object sendLock = new object();
  static NetworkStream current;
  static void Forward() {
    var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
    string line;
    while ((line = input.ReadLine()) != null) {
      if (line.Length == 0 || line[0] != '{') continue;
      byte[] bytes = Encoding.UTF8.GetBytes(line + "\n");
      bool sent = false;
      lock (sendLock) {
        if (current != null) {
          try { current.Write(bytes, 0, bytes.Length); current.Flush(); sent = true; } catch (Exception) { }
        }
      }
      if (!sent) Emit("{\"t\":\"unsent\"}");
    }
    // The app closed our input: it's gone, so stop.
    Environment.Exit(0);
  }

  public static void Run(string prefer) {
    Console.OutputEncoding = new UTF8Encoding(false);
    var fwd = new Thread(Forward);
    fwd.IsBackground = true;
    fwd.Start();
    ulong last = 0;
    if (!string.IsNullOrEmpty(prefer)) { try { last = Convert.ToUInt64(prefer.Replace(":", ""), 16); } catch { } }
    string lastState = null;
    while (true) {
      List<Phone> phones;
      try { phones = PairedPhones(); } catch (Exception e) { phones = new List<Phone>(); lastState = null; Status("error", null, e.Message); }
      if (phones.Count == 0) {
        if (lastState != "nophone") Status("nophone", null, null);
        lastState = "nophone";
        Thread.Sleep(10000);
        continue;
      }
      // The phone that worked last time goes first.
      phones.Sort((x, y) => (y.Addr == last ? 1 : 0) - (x.Addr == last ? 1 : 0));
      bool linked = false;
      foreach (var ph in phones) {
        if (lastState != "searching") Status("searching", null, null);
        lastState = "searching";
        Socket s = null;
        try {
          s = new Socket(AF_BTH, SocketType.Stream, BTHPROTO_RFCOMM);
          s.Connect(new BthEndPoint(ph.Addr));
        } catch (Exception) {
          if (s != null) s.Close();
          continue; // not in range, Bluetooth off, or the app isn't running there
        }
        linked = true;
        last = ph.Addr;
        try { Session(s, ph); } catch (Exception) { }
        Status("searching", null, null);
        lastState = "searching";
        break;
      }
      Thread.Sleep(linked ? 2000 : 8000);
    }
  }
}
'@
[BuddyBridge]::Run($Prefer)
