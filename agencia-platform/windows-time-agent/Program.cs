using System.Drawing;
using System.Drawing.Imaging;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;
using System.Runtime.CompilerServices;

[assembly: InternalsVisibleTo("TimeAgent.Tests")]

namespace NegocioVivo.TimeAgent;

internal static class Program
{
    [STAThread] static void Main()
    {
        ApplicationConfiguration.Initialize();
        using var singleton = new Mutex(true, @"Local\NegocioVivo.TimeAgent", out var first);
        if (!first) { MessageBox.Show("El programa ya está abierto. Usa el icono del reloj junto a la hora de Windows.", "Negocio Vivo"); return; }
        Application.Run(new AgentForm(Environment.GetCommandLineArgs().Any(arg => arg.Equals("--background", StringComparison.OrdinalIgnoreCase))));
    }
}

internal sealed class AgentForm : Form
{
    private readonly AgentStore store = new();
    private readonly bool hideOnStart;
    private readonly HubClient hub;
    private readonly Label status = new() { AutoSize = true, Font = new Font("Segoe UI", 12, FontStyle.Bold), Margin = new Padding(0, 0, 0, 16) };
    private readonly Label detail = new() { AutoSize = true, MaximumSize = new Size(390, 0), ForeColor = Color.DimGray };
    private readonly Button start = new() { Text = "▶ Iniciar jornada", Width = 185, Height = 44 };
    private readonly Button pause = new() { Text = "⏸ Pausar", Width = 185, Height = 44 };
    private readonly TextBox enrollment = new() { Width = 385, PlaceholderText = "Código de vinculación" };
    private readonly Button connect = new() { Text = "Vincular este equipo", Width = 185, Height = 40 };
    private readonly System.Windows.Forms.Timer heartbeat = new() { Interval = 60_000 };
    private readonly System.Windows.Forms.Timer capture = new();
    private AgentPolicy policy = new();
    private bool active;
    private bool paused;
    private bool busy;
    private bool online;
    private bool quitting;
    private bool sessionLocked;
    private DateTimeOffset lastActivity = DateTimeOffset.UtcNow;
    private readonly NotifyIcon tray = new();
    private readonly Label startedLabel = new() { AutoSize = true, Margin = new Padding(0, 12, 0, 4) };
    private readonly Label workedLabel = new() { AutoSize = true, Font = new Font("Segoe UI", 24, FontStyle.Bold), Margin = new Padding(0, 0, 0, 4) };
    private readonly System.Windows.Forms.Timer displayClock = new() { Interval = 1000 };
    private DayProgress? dayProgress;
    private DateTimeOffset daySyncedAt;
    private DateTime dayRequested;
    private readonly Button finish = new() { Text = "Terminar jornada", Width = 185, Height = 40 };

    public AgentForm(bool hideOnStart)
    {
        this.hideOnStart = hideOnStart;
        hub = new HubClient(store);
        Text = "Negocio Vivo · Control horario";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = true;
        StartPosition = FormStartPosition.CenterScreen; ClientSize = new Size(460, 510);
        var panel = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(26), FlowDirection = FlowDirection.TopDown, WrapContents = false };
        panel.Controls.Add(new Label { Text = "Negocio Vivo · Control horario", AutoSize = true, Font = new Font("Segoe UI", 16, FontStyle.Bold), Margin = new Padding(0, 0, 0, 18) });
        panel.Controls.Add(status); panel.Controls.Add(detail); panel.Controls.Add(startedLabel); panel.Controls.Add(workedLabel);
        panel.Controls.Add(enrollment); panel.Controls.Add(connect);
        var row = new FlowLayoutPanel { Width = 390, Height = 54, Margin = new Padding(0, 18, 0, 0) }; row.Controls.Add(start); row.Controls.Add(pause); panel.Controls.Add(row);
        panel.Controls.Add(new Label { Text = "La configuración de seguimiento se administra exclusivamente desde el Hub.", AutoSize = true, MaximumSize = new Size(390, 0), ForeColor = Color.Gray, Margin = new Padding(0, 12, 0, 0) });
        Controls.Add(panel);
        panel.Controls.Add(finish);
        enrollment.UseSystemPasswordChar = true;
        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir control horario", null, (_, _) => { Show(); WindowState = FormWindowState.Normal; Activate(); });
        menu.Items.Add("Salir", null, (_, _) => { quitting = true; Close(); });
        tray.Icon = Icon; tray.Text = "Negocio Vivo · Control horario";
        tray.ContextMenuStrip = menu; tray.Visible = true;
        tray.DoubleClick += (_, _) => { Show(); WindowState = FormWindowState.Normal; Activate(); };
        FormClosing += (_, e) => { if (!quitting && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };
        SystemEvents.SessionSwitch += OnSessionSwitch;
        FormClosed += (_, _) => { SystemEvents.SessionSwitch -= OnSessionSwitch; heartbeat.Stop(); capture.Stop(); displayClock.Stop(); tray.Dispose(); };
        start.Click += async (_, _) => await SetShift("start");
        pause.Click += async (_, _) => await SetShift(paused ? "start" : "stop", true);
        finish.Click += async (_, _) => await SetShift("stop");
        connect.Click += async (_, _) => await Enroll();
        heartbeat.Tick += async (_, _) => await Heartbeat();
        displayClock.Tick += async (_, _) => {
            RenderClock();
            if (dayProgress is not null && dayRequested != DateTime.Today && !busy) await RefreshState();
        };
        displayClock.Start();
        capture.Tick += async (_, _) => await CaptureCycle();
        Shown += async (_, _) => { Render(store.IsEnrolled); heartbeat.Start(); await RefreshState(); if (this.hideOnStart && store.IsEnrolled) BeginInvoke(Hide); };
    }

    private async Task SyncDay()
    {
        var requestedDay = DateTime.Today;
        var progress = await hub.Today(requestedDay);
        dayProgress = progress;
        dayRequested = requestedDay;
        daySyncedAt = DateTimeOffset.UtcNow;
        active = progress.Active;
        RenderClock();
    }

    private void RenderClock()
    {
        if (dayProgress is null || dayRequested != DateTime.Today)
        {
            startedLabel.Text = "Inicio de hoy: pendiente de sincronizar";
            workedLabel.Text = "Hoy: —";
            return;
        }
        startedLabel.Text = dayProgress.StartedAt is { } began
            ? $"Primera entrada: {began.ToLocalTime():dd/MM HH:mm:ss}"
            : "Hoy todavía no has iniciado la jornada";
        var seconds = dayProgress.SecondsAt(daySyncedAt, DateTimeOffset.UtcNow, online && active);
        workedLabel.Text = $"Hoy: {seconds / 3600:00}:{seconds / 60 % 60:00}:{seconds % 60:00}";
        if (!online) startedLabel.Text += " · Último dato sincronizado";
    }

    private async Task Enroll()
    {
        connect.Enabled = false;
        try { await hub.Enroll(enrollment.Text.Trim()); enrollment.Clear(); await RefreshState(); }
        catch (Exception ex) { ShowError(ex.Message); }
        finally { connect.Enabled = true; }
    }

    private async Task RefreshState()
    {
        if (!store.IsEnrolled) { Render(false); return; }
        if (busy) return;
        busy = true;
        try { policy = await hub.Policy(); await SyncDay(); online = true; if (active) paused = false; Render(true); ScheduleCapture(); }
        catch (Exception ex) { online = false; capture.Stop(); Render(true); status.Text = "Sin conexión con el Hub"; detail.Text = ex.Message + " Se reintentará automáticamente."; }
        finally { busy = false; }
    }

    private void Render(bool enrolled)
    {
        enrollment.Visible = connect.Visible = !enrolled;
        start.Visible = pause.Visible = enrolled;
        finish.Visible = enrolled; startedLabel.Visible = workedLabel.Visible = enrolled; RenderClock();
        if (!enrolled) { status.Text = "Equipo pendiente de vincular"; detail.Text = "Introduce el código individual que te haya enviado el administrador."; return; }
        status.Text = paused ? "Jornada en pausa" : active ? "Jornada activa" : "Jornada no iniciada";
        detail.Text = active ? "El seguimiento se realiza automáticamente según la política definida por el administrador." : "Pulsa Iniciar jornada para comenzar.";
        start.Enabled = online && policy.TrackingEnabled && !active; pause.Enabled = online && policy.TrackingEnabled && (active || paused); pause.Text = paused ? "▶ Reanudar" : "⏸ Pausar";
        finish.Enabled = online && (active || paused);
        if (!policy.TrackingEnabled) { status.Text = "Seguimiento desactivado"; detail.Text = "El administrador ha desactivado el seguimiento de este equipo."; }
    }

    private async Task SetShift(string action, bool isPause = false)
    {
        if (busy) return;
        busy = true; capture.Stop(); start.Enabled = pause.Enabled = finish.Enabled = false;
        try { if (action != "stop" || active) await hub.SetShift(action); active = action == "start"; paused = isPause && action == "stop"; online = true; lastActivity = DateTimeOffset.UtcNow; dayProgress = null; await SyncDay(); Render(true); if (active) ScheduleCapture(); }
        catch (Exception ex) { ShowError(ex.Message); }
        finally { busy = false; Render(store.IsEnrolled); }
    }

    private async Task Heartbeat()
    {
        if (!store.IsEnrolled || busy) return;
        busy = true;
        try {
            var wasActive = active;
            policy = await hub.Policy(); await SyncDay(); online = true;
            var now = DateTimeOffset.UtcNow;
            if (!wasActive && active) lastActivity = now;
            if (active) paused = false;
            var elapsed = (int)(now - lastActivity).TotalSeconds;
            // A sleep or network gap cannot be reported as observed work.
            if (active && !paused && policy.TrackingEnabled && elapsed is > 0 and <= 90) await hub.Activity(policy, elapsed);
            lastActivity = now;
            Render(true);
            if (!active || !policy.TrackingEnabled || !policy.ScreenshotsEnabled) capture.Stop();
            else if (!capture.Enabled) ScheduleCapture();
        }
        catch (Exception ex) { online = false; lastActivity = DateTimeOffset.UtcNow; capture.Stop(); Render(true); detail.Text = "Sincronización pendiente: " + ex.Message; }
        finally { busy = false; }
    }

    private void ScheduleCapture()
    {
        capture.Stop();
        if (sessionLocked || !online || !active || paused || !policy.TrackingEnabled || !policy.ScreenshotsEnabled) return;
        var baseMs = Math.Clamp(policy.ScreenshotInterval, 2, 120) * 60_000;
        var jitter = baseMs * Math.Clamp(policy.ScreenshotJitter, 0, 50) / 100;
        capture.Interval = (int)(baseMs - jitter + Random.Shared.NextDouble() * jitter * 2);
        capture.Start();
    }

    private async Task CaptureCycle()
    {
        capture.Stop();
        if (busy) { ScheduleCapture(); return; }
        busy = true;
        try
        {
            policy = await hub.Policy(); await SyncDay();
            if (!sessionLocked && active && !paused && policy.TrackingEnabled && policy.ScreenshotsEnabled && HubClient.CanCapture(policy))
                await hub.Screenshot(policy.RetentionDays, policy.BlurScreenshots);
        }
        catch (Exception ex) { online = false; detail.Text = "Captura pendiente: " + ex.Message; }
        finally { busy = false; ScheduleCapture(); }
    }

    private void OnSessionSwitch(object sender, SessionSwitchEventArgs e)
    {
        if (IsDisposed || !IsHandleCreated) return;
        BeginInvoke(() => {
            sessionLocked = e.Reason is SessionSwitchReason.SessionLock or SessionSwitchReason.SessionLogoff or SessionSwitchReason.ConsoleDisconnect or SessionSwitchReason.RemoteDisconnect;
            if (sessionLocked) capture.Stop();
        });
    }

    private void ShowError(string message) => MessageBox.Show(this, message, "Negocio Vivo", MessageBoxButtons.OK, MessageBoxIcon.Warning);
}

internal sealed record DayProgress(bool Active, DateTimeOffset? StartedAt, long WorkedSec)
{
    public long SecondsAt(DateTimeOffset syncedAt, DateTimeOffset now, bool running) =>
        Math.Max(0, WorkedSec) + (Active && running ? Math.Max(0, (long)(now - syncedAt).TotalSeconds) : 0);
}

internal interface IAgentStore
{
    string DeviceId { get; }
    string? Token { get; }
    void Save(string token);
}

internal sealed class AgentStore : IAgentStore
{
    private readonly string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NegocioVivo", "time-agent.json");
    private readonly string machine = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Environment.MachineName + Environment.UserName)))[..24].ToLowerInvariant();
    public string DeviceId => machine;
    public bool IsEnrolled => File.Exists(path) && !string.IsNullOrWhiteSpace(Token);
    public string? Token { get { try { using var json = JsonDocument.Parse(File.ReadAllText(path)); var value = json.RootElement.GetProperty("token").GetString(); return value is null ? null : Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(value), null, DataProtectionScope.CurrentUser)); } catch { return null; } } }
    public void Save(string token) { Directory.CreateDirectory(Path.GetDirectoryName(path)!); var crypt = Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(token), null, DataProtectionScope.CurrentUser)); File.WriteAllText(path, JsonSerializer.Serialize(new { token = crypt })); }
}

internal sealed class AgentPolicy
{
    public bool CollectApps { get; init; } = true;
    public bool CollectIdle { get; init; } = true;
    public bool CollectWindowTitles { get; init; }
    public bool TrackingEnabled { get; init; } = true;
    public bool ScreenshotsEnabled { get; init; } = true;
    public int ScreenshotInterval { get; init; } = 10;
    public int ScreenshotJitter { get; init; } = 20;
    public bool BlurScreenshots { get; init; }
    public int RetentionDays { get; init; } = 30;
    public string[] ExcludedApps { get; init; } = [];
    public bool Excludes(string name) => ExcludedApps.Any(value => name.Contains(value, StringComparison.OrdinalIgnoreCase));
}

internal sealed class HubClient(IAgentStore store, HttpMessageHandler? handler = null)
{
    private const string Base = "https://hub.negociovivo.app";
    private readonly HttpClient http = handler is null ? new HttpClient { Timeout = TimeSpan.FromSeconds(20) } : new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20) };
    private HttpRequestMessage Request(HttpMethod method, string path) { var r = new HttpRequestMessage(method, Base + path); if (store.Token is { Length: > 0 } token) r.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token); return r; }
    private static async Task<string> Error(HttpResponseMessage response) { var text = await response.Content.ReadAsStringAsync(); try { return JsonDocument.Parse(text).RootElement.GetProperty("error").GetProperty("message").GetString() ?? "Error del Hub"; } catch { return $"Error del Hub ({(int)response.StatusCode})"; } }
    public async Task Enroll(string code)
    {
        if (string.IsNullOrWhiteSpace(code) || code.StartsWith("NV-", StringComparison.OrdinalIgnoreCase) || code.StartsWith("NVV-", StringComparison.OrdinalIgnoreCase))
            throw new Exception("Pide una credencial nueva al administrador desde Control horario → Vincular un equipo.");
        // The Hub issues an individual bearer credential, not a redeemable code.
        using var request = new HttpRequestMessage(HttpMethod.Get, Base + "/api/v1/time-tracking/agent-config");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", code);
        using var response = await http.SendAsync(request);
        if (!response.IsSuccessStatusCode) throw new Exception(await Error(response));
        _ = await ReadPolicy(response);
        store.Save(code);
    }
    public async Task<AgentPolicy> Policy() { using var r = Request(HttpMethod.Get, "/api/v1/time-tracking/agent-config"); using var response = await http.SendAsync(r); if (!response.IsSuccessStatusCode) throw new Exception(await Error(response)); return await ReadPolicy(response); }
    private static async Task<AgentPolicy> ReadPolicy(HttpResponseMessage response)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;
        foreach (var flag in new[] { "trackingEnabled", "screenshotsEnabled" })
            if (!root.TryGetProperty(flag, out var value) || value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                throw new Exception("El Hub devolvió una política incompleta; seguimiento detenido.");
        var policy = root.Deserialize<AgentPolicy>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        if (policy is null || policy.ExcludedApps is null) throw new Exception("Política del Hub inválida.");
        return policy;
    }
    public async Task<bool> IsActive() => (await Today(DateTime.Today)).Active;
    public async Task<DayProgress> Today(DateTime localDay)
    {
        var start = new DateTimeOffset(DateTime.SpecifyKind(localDay.Date, DateTimeKind.Local));
        var end = new DateTimeOffset(DateTime.SpecifyKind(localDay.Date.AddDays(1), DateTimeKind.Local));
        var path = "/api/v1/time-tracking/me?dayStart=" + Uri.EscapeDataString(start.ToString("O")) + "&dayEnd=" + Uri.EscapeDataString(end.ToString("O"));
        using var r = Request(HttpMethod.Get, path);
        using var response = await http.SendAsync(r);
        if (!response.IsSuccessStatusCode) throw new Exception(await Error(response));
        return await response.Content.ReadFromJsonAsync<DayProgress>() ?? throw new Exception("No se ha podido leer la jornada del Hub.");
    }
    public async Task SetShift(string action)
    {
        using var r = Request(HttpMethod.Post, "/api/v1/time-tracking");
        r.Content = action == "start" ? JsonContent.Create(new { action, deviceId = store.DeviceId }) : JsonContent.Create(new { action });
        using var response = await http.SendAsync(r); if (!response.IsSuccessStatusCode) throw new Exception(await Error(response));
    }
    public async Task Activity(AgentPolicy policy, int durationSec)
    {
        using var request = Request(HttpMethod.Post, "/api/v1/time-tracking/activity");
        var app = ForegroundApp();
        var excluded = policy.Excludes(app);
        var now = DateTimeOffset.UtcNow;
        request.Content = JsonContent.Create(new {
            deviceId = store.DeviceId,
            entries = new[] { new {
                bucketStart = now.AddSeconds(-durationSec), durationSec,
                appName = policy.CollectApps && !excluded ? app : null,
                windowTitle = policy.CollectWindowTitles && !excluded ? WindowTitle() : null,
                idle = policy.CollectIdle && IdleSeconds() > 300, privateMode = excluded
            } }
        });
        using var response = await http.SendAsync(request);
        if (!response.IsSuccessStatusCode) throw new Exception(await Error(response));
    }
    public async Task Screenshot(int retentionDays, bool blurred)
    {
        var bounds = SystemInformation.VirtualScreen;
        using var image = new Bitmap(bounds.Width, bounds.Height);
        using (var graphics = Graphics.FromImage(image)) graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size);
        if (blurred) Pixelate(image);
        using var stream = new MemoryStream(); image.Save(stream, ImageFormat.Jpeg); stream.Position = 0;
        using var form = ScreenshotForm(stream.ToArray(), store.DeviceId, retentionDays, blurred);
        using var r = Request(HttpMethod.Post, "/api/v1/time-tracking/screenshots"); r.Content = form; using var response = await http.SendAsync(r); if (!response.IsSuccessStatusCode) throw new Exception(await Error(response));
    }
    internal static MultipartFormDataContent ScreenshotForm(byte[] image, string deviceId, int retentionDays, bool blurred)
    {
        var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(image) { Headers = { ContentType = new MediaTypeHeaderValue("image/jpeg") } }, "file", "capture.jpg");
        form.Add(new StringContent(deviceId), "deviceId");
        form.Add(new StringContent(DateTimeOffset.UtcNow.ToString("O")), "capturedAt");
        form.Add(new StringContent(retentionDays.ToString()), "retentionDays");
        form.Add(new StringContent(blurred.ToString().ToLowerInvariant()), "blurred");
        // Node 20's FormData parser rejects .NET's unquoted attributes/filename*.
        // Send the same quoted ASCII disposition fields a browser would send.
        foreach (var part in form)
        {
            var disposition = part.Headers.ContentDisposition!;
            disposition.Name = "\"" + disposition.Name!.Trim('"') + "\"";
            if (disposition.FileName is { } name) disposition.FileName = "\"" + name.Trim('"') + "\"";
            disposition.FileNameStar = null;
        }
        return form;
    }
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInputInfo info);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    public static string ForegroundApp()
    {
        var handle = GetForegroundWindow(); if (handle == IntPtr.Zero) return string.Empty;
        GetWindowThreadProcessId(handle, out var id);
        try { using var process = System.Diagnostics.Process.GetProcessById((int)id); return process.ProcessName; } catch { return string.Empty; }
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int maxCount);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr handle);
    private delegate bool EnumWindow(IntPtr handle, IntPtr parameter);
    private static string WindowTitle()
    {
        var text = new StringBuilder(301);
        GetWindowText(GetForegroundWindow(), text, text.Capacity);
        return text.ToString();
    }
    public static bool CanCapture(AgentPolicy policy)
    {
        if (GetForegroundWindow() == IntPtr.Zero || IdleSeconds() > 300) return false;
        bool safe = true;
        // Full-desktop images may include background windows on another monitor.
        EnumWindows((handle, _) => {
            if (!IsWindowVisible(handle) || IsIconic(handle)) return true;
            GetWindowThreadProcessId(handle, out var id);
            try {
                using var process = System.Diagnostics.Process.GetProcessById((int)id);
                if (policy.Excludes(process.ProcessName)) safe = false;
            } catch { safe = false; }
            return safe;
        }, IntPtr.Zero);
        return safe;
    }
    private static void Pixelate(Bitmap image)
    {
        var reducedWidth = Math.Max(1, image.Width / 32); var reducedHeight = Math.Max(1, image.Height / 32);
        using var reduced = new Bitmap(image, new Size(reducedWidth, reducedHeight));
        using var graphics = Graphics.FromImage(image);
        graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;
        graphics.DrawImage(reduced, new Rectangle(0, 0, image.Width, image.Height));
    }
    private static uint IdleSeconds() { var info = new LastInputInfo { cbSize = (uint)Marshal.SizeOf<LastInputInfo>() }; return GetLastInputInfo(ref info) ? ((uint)Environment.TickCount - info.dwTime) / 1000 : 0; }
    [StructLayout(LayoutKind.Sequential)] private struct LastInputInfo { public uint cbSize; public uint dwTime; }
}
