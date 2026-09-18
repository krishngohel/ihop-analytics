// IHOP Operations for Windows. A notification-area (tray) icon that runs the dashboard
// server (the Node program installed beside it) with no console window, and opens it in
// the browser. Built with the C# compiler that ships with Windows, so it sticks to C# 5.
//
// Everything the person owns lives outside the program folder, so an update or reinstall
// never touches it:
//   %LOCALAPPDATA%\IHOP Operations           database, secret key, log
//   Documents\IHOP Operations Reports        reports saved here are imported
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    const string AppName = "IHOP Operations";
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string SettingsKey = @"Software\IHOP Operations";
    static readonly string Port = Environment.GetEnvironmentVariable("PORT") ?? "4000";
    static readonly string Address = "http://localhost:" + Port;
    static readonly string InstallDir = AppDomain.CurrentDomain.BaseDirectory;
    static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName);
    static readonly string ReportsDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), AppName + " Reports");
    static readonly string LogFile = Path.Combine(DataDir, "dashboard.log");

    static NotifyIcon tray;
    static MenuItem statusLine, loginItem, shareItem;
    static Process server;
    static IntPtr job = IntPtr.Zero;
    static bool stopping;
    static int restarts;
    static StreamWriter log;
    static readonly object logLock = new object();

    [STAThread]
    static void Main(string[] args)
    {
        bool background = Array.IndexOf(args, "--background") >= 0;
        bool first;
        using (Mutex single = new Mutex(true, "IHOP-Operations-Dashboard", out first))
        {
            // A second copy (the Start menu shortcut while it is already running) just opens the browser.
            if (!first) { OpenDashboard(); return; }
            Application.EnableVisualStyles();
            Directory.CreateDirectory(DataDir);
            Directory.CreateDirectory(ReportsDir);
            BuildTray();
            // Scheduled refreshes need the computer awake (the display may still sleep).
            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
            if (Answering()) { statusLine.Text = "Running"; if (!background) OpenDashboard(); }
            else StartServer(!background);
            Application.ApplicationExit += delegate { StopServer(); };
            Application.Run();
            tray.Visible = false;
        }
    }

    static void BuildTray()
    {
        statusLine = new MenuItem("Starting...") { Enabled = false };
        loginItem = new MenuItem("Start When I Sign In", delegate { ToggleLogin(); }) { Checked = LoginEnabled() };
        shareItem = new MenuItem("Let Others on This Network Open It", delegate { ToggleSharing(); }) { Checked = Sharing() };
        ContextMenu menu = new ContextMenu(new MenuItem[] {
            statusLine, new MenuItem("-"),
            new MenuItem("Open Dashboard", delegate { OpenDashboard(); }) { DefaultItem = true },
            new MenuItem("Show Reports Folder", delegate { Process.Start(ReportsDir); }),
            new MenuItem("-"), loginItem, shareItem,
            new MenuItem("Show Log", delegate { if (File.Exists(LogFile)) Process.Start("notepad.exe", "\"" + LogFile + "\""); }),
            new MenuItem("-"),
            new MenuItem("Quit " + AppName, delegate { Application.Exit(); }),
        });
        tray = new NotifyIcon();
        tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        tray.Text = AppName;
        tray.ContextMenu = menu;
        tray.Visible = true;
        tray.DoubleClick += delegate { OpenDashboard(); };
    }

    static void StartServer(bool openWhenReady)
    {
        RotateLog();
        ProcessStartInfo info = new ProcessStartInfo(Path.Combine(InstallDir, "node.exe"), "--experimental-sqlite --no-warnings src\\index.js");
        info.WorkingDirectory = Path.Combine(InstallDir, "app", "server");
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        info.EnvironmentVariables["PORT"] = Port;
        info.EnvironmentVariables["OPS_DB_PATH"] = Path.Combine(DataDir, "ops.db");
        info.EnvironmentVariables["OPS_DEFAULT_IMPORT_DIR"] = ReportsDir;
        // This computer only unless sharing is switched on, so Windows Firewall never asks.
        if (Sharing()) info.EnvironmentVariables.Remove("OPS_HOST"); else info.EnvironmentVariables["OPS_HOST"] = "127.0.0.1";
        try
        {
            lock (logLock) { if (log != null) { log.Dispose(); log = null; } }
            log = new StreamWriter(new FileStream(LogFile, FileMode.Append, FileAccess.Write, FileShare.ReadWrite)) { AutoFlush = true };
            server = new Process { StartInfo = info, EnableRaisingEvents = true };
            server.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { WriteLog(e.Data); };
            server.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { WriteLog(e.Data); };
            server.Exited += delegate { ServerStopped(); };
            server.Start();
            KeepTogether(server);
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
        }
        catch (Exception e) { Fail("The dashboard could not start: " + e.Message); return; }

        Thread waiter = new Thread(delegate()
        {
            for (int i = 0; i < 60 && !stopping; i++)
            {
                if (Answering()) { SetStatus("Running at localhost:" + Port); if (openWhenReady) OpenDashboard(); return; }
                Thread.Sleep(500);
            }
        });
        waiter.IsBackground = true;
        waiter.Start();
    }

    static void ServerStopped()
    {
        if (stopping) return;
        restarts++;
        if (restarts <= 3) { SetStatus("Restarting..."); Thread.Sleep(2000); if (!stopping) StartServer(false); }
        else Fail("The dashboard stopped and could not be restarted. Choose Show Log from the tray icon for the reason.");
    }

    static void StopServer()
    {
        stopping = true;
        try { if (server != null && !server.HasExited) { server.Kill(); server.WaitForExit(4000); } } catch { }
        lock (logLock) { if (log != null) { log.Dispose(); log = null; } }
    }

    static bool Answering()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Address + "/api/auth/me");
            request.Timeout = 1500;
            request.Proxy = null;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse()) return response.StatusCode == HttpStatusCode.OK;
        }
        catch { return false; }
    }

    static void OpenDashboard() { try { Process.Start(Address); } catch { } }
    static void WriteLog(string line) { if (line == null) return; lock (logLock) { if (log != null) log.WriteLine(line); } }
    static void SetStatus(string text) { try { statusLine.Text = text; } catch { } }

    static void RotateLog()
    {
        try
        {
            FileInfo f = new FileInfo(LogFile);
            if (f.Exists && f.Length > 5000000) { string old = Path.Combine(DataDir, "dashboard.old.log"); File.Delete(old); File.Move(LogFile, old); }
        }
        catch { }
    }

    static void Fail(string message)
    {
        SetStatus("Not running");
        MessageBox.Show(message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    // The same registry value the installer's "start when I sign in" box writes.
    static bool LoginEnabled() { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey)) return k != null && k.GetValue(AppName) != null; }
    static void ToggleLogin()
    {
        using (RegistryKey k = Registry.CurrentUser.CreateSubKey(RunKey))
        {
            if (k.GetValue(AppName) != null) k.DeleteValue(AppName, false);
            else k.SetValue(AppName, "\"" + Application.ExecutablePath + "\" --background");
        }
        loginItem.Checked = LoginEnabled();
    }

    // Off: only this computer. On: anyone on the office network can open http://<this computer's name>:4000
    // (Windows Firewall asks once). The server restarts to apply it.
    static bool Sharing() { using (RegistryKey k = Registry.CurrentUser.OpenSubKey(SettingsKey)) return k != null && Convert.ToInt32(k.GetValue("ShareOnNetwork", 0)) == 1; }
    static void ToggleSharing()
    {
        using (RegistryKey k = Registry.CurrentUser.CreateSubKey(SettingsKey)) k.SetValue("ShareOnNetwork", Sharing() ? 0 : 1, RegistryValueKind.DWord);
        shareItem.Checked = Sharing();
        restarts = 0;
        SetStatus("Restarting...");
        try { if (server != null && !server.HasExited) { restarts = -1; server.Kill(); } } catch { } // ServerStopped() brings it back
    }

    // A job object ties the server to this program: if the tray program ends for any reason
    // (even an update closing it by force), Windows ends the server too, so it can never be
    // left running unseen and holding the port or the program files.
    static void KeepTogether(Process child)
    {
        try
        {
            if (job == IntPtr.Zero)
            {
                job = CreateJobObject(IntPtr.Zero, null);
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                info.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                IntPtr pointer = Marshal.AllocHGlobal(length);
                Marshal.StructureToPtr(info, pointer, false);
                SetInformationJobObject(job, 9, pointer, (uint)length);
                Marshal.FreeHGlobal(pointer);
            }
            AssignProcessToJobObject(job, child.Handle);
        }
        catch { }
    }

    const uint ES_CONTINUOUS = 0x80000000, ES_SYSTEM_REQUIRED = 0x00000001;
    [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
}
