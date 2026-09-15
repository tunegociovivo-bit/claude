using System.Drawing;
using System.Drawing.Imaging;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

namespace NegocioVivo.TimeAgent;

internal static class Program
{
    [STAThread] static void Main()
    {
        ApplicationConfiguration.Initialize();
        var exe = Environment.ProcessPath;
        if (!string.IsNullOrWhiteSpace(exe)) Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")?.SetValue("Negocio Vivo Control Horario", $"\"{exe}\" --background");
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

    public AgentForm(bool hideOnStart)
    {
        this.hideOnStart = hideOnStart;
        hub = new HubClient(store);
        Text = "Negocio Vivo · Control horario";
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = true;
        StartPosition = FormStartPosition.CenterScreen; ClientSize = new Size(440, 250);
        var panel = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(26), FlowDirection = FlowDirection.TopDown, WrapContents = false };
        panel.Controls.Add(new Label { Text = "Negocio Vivo · Control horario", AutoSize = true, Font = new Font("Segoe UI", 16, FontStyle.Bold), Margin = new Padding(0, 0, 0, 18) });
        panel.Controls.Add(status); panel.Controls.Add(detail);
        panel.Controls.Add(enrollment); panel.Controls.Add(connect);
        var row = new FlowLayoutPanel { Width = 390, Height = 54, Margin = new Padding(0, 18, 0, 0) }; row.Controls.Add(start); row.Controls.Add(pause); panel.Controls.Add(row);
        panel.Controls.Add(new Label { Text = "La configuración de seguimiento se administra exclusivamente desde el Hub.", AutoSize = true, MaximumSize = new Size(390, 0), ForeColor = Color.Gray, Margin = new Padding(0, 12, 0, 0) });
        Controls.Add(panel);
        start.Click += async (_, _) => await SetShift("start");
        pause.Click += async (_, _) => await SetShift(paused ? "start" : "stop");
        connect.Click += async (_, _) => await Enroll();
        heartbeat.Tick += async (_, _) => await Heartbeat();
        capture.Tick += async (_, _) => await CaptureCycle();
        Shown += async (_, _) => { await RefreshState(); if (this.hideOnStart) BeginInvoke(Hide); };
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
        try { policy = await hub.Policy(); active = await hub.IsActive(); paused = false; Render(true); heartbeat.Start(); ScheduleCapture(); }
        catch (Exception ex) { status.Text = "Sin conexión con el Hub"; detail.Text = ex.Message; }
    }

    private void Render(bool enrolled)
    {
        enrollment.Visible = connect.Visible = !enrolled;
        start.Visible = pause.Visible = enrolled;
        if (!enrolled) { status.Text = "Equipo pendiente de vincular"; detail.Text = "Introduce el código individual que te haya enviado el administrador."; return; }
        status.Text = active ? (paused ? "Jornada en pausa" : "Jornada activa") : "Jornada no iniciada";
        detail.Text = active ? "El seguimiento se realiza automáticamente según la política definida por el administrador." : "Pulsa Iniciar jornada para comenzar.";
        start.Enabled = !active || paused; pause.Enabled = active; pause.Text = paused ? "▶ Reanudar" : "⏸ Pausar";
    }

    private async Task SetShift(string action)
    {
        try { await hub.SetShift(action); active = action == "start"; paused = action == "stop"; if (!active) capture.Stop(); Render(true); if (active && !paused) ScheduleCapture(); }
        catch (Exception ex) { ShowError(ex.Message); }
    }

    private async Task Heartbeat()
    {
        if (!store.IsEnrolled || !active || paused) return;
        try { policy = await hub.Policy(); await hub.Activity(); }
        catch (Exception ex) { detail.Text = "Sincronización pendiente: " + ex.Message; }
    }

    private void ScheduleCapture()
    {
        capture.Stop();
        if (!active || paused || !policy.TrackingEnabled || !policy.ScreenshotsEnabled) return;
        var baseMs = Math.Max(2, policy.ScreenshotInterval) * 60_000;
        var jitter = baseMs * Math.Clamp(policy.ScreenshotJitter, 0, 50) / 100;
        capture.Interval = (int)(baseMs - jitter + Random.Shared.NextDouble() * jitter * 2);
        capture.Start();
    }

    private async Task CaptureCycle()
    {
        capture.Stop();
        try
        {
            if (active && !paused && policy.TrackingEnabled && policy.ScreenshotsEnabled && !policy.Excludes(HubClient.ForegroundApp()))
                await hub.Screenshot(policy.RetentionDays, policy.BlurScreenshots);
        }
        catch (Exception ex) { detail.Text = "Captura pendiente: " + ex.Message; }
        finally { ScheduleCapture(); }
    }

    private void ShowError(string message) => MessageBox.Show(this, message, "Negocio Vivo", MessageBoxButtons.OK, MessageBoxIcon.Warning);
}

internal sealed class AgentStore
{
    private readonly string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NegocioVivo", "time-agent.json");
    private readonly string machine = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Environment.MachineName + Environment.UserName)))[..24].ToLowerInvariant();
    public string DeviceId => machine;
    public bool IsEnrolled => File.Exists(path) && !string.IsNullOrWhiteSpace(Token);
    public string? Token { get { try { var json = JsonDocument.Parse(File.ReadAllText(path)); var value = json.RootElement.GetProperty("token").GetString(); return value is null ? null : Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(value), null, DataProtectionScope.CurrentUser)); } catch { return null; } } }
    public void Save(string token) { Directory.CreateDirectory(Path.GetDirectoryName(path)!); var crypt = Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(token), null, DataProtectionScope.CurrentUser)); File.WriteAllText(path, JsonSerializer.Serialize(new { token = crypt })); }
}

internal sealed class AgentPolicy
{
    public bool TrackingEnabled { get; init; } = true;
    public bool ScreenshotsEnabled { get; init; } = true;
    public int ScreenshotInterval { get; init; } = 10;
    public int ScreenshotJitter { get; init; } = 20;
    public bool BlurScreenshots { get; init; }
    public int RetentionDays { get; init; } = 30;
    public string[] ExcludedApps { get; init; } = [];
    public bool Excludes(string name) => ExcludedApps.Any(value => name.Contains(value, StringComparison.OrdinalIgnoreCase));
}

internal sealed class HubClient(AgentStore store)
{
    private const string Base = "https://hub.negociovivo.app";
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private HttpRequestMessage Request(HttpMethod method, string path) { var r = new HttpRequestMessage(method, Base + path); if (store.Token is { Length: > 0 } token) r.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token); return r; }
    private static async Task<string> Error(HttpResponseMessage response) { var text = await response.Content.ReadAsStringAsync(); try { return JsonDocument.Parse(text).RootElement.GetProperty("error").GetProperty("message").GetString() ?? "Error del Hub"; } catch { return $"Error del Hub ({(int)response.StatusCode})"; } }
    public async Task Enroll(string code) { if (string.IsNullOrWhiteSpace(code)) throw new Exception("Introduce el código de vinculación."); var body = JsonContent.Create(new { code, deviceId = store.DeviceId }); var response = await http.PostAsync(Base + "/api/public/time-tracking/enrollment-redeem", body); if (!response.IsSuccessStatusCode) throw new Exception(await Error(response)); var token = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("token").GetString(); if (string.IsNullOrEmpty(token)) throw new Exception("El Hub no devolvió una credencial válida."); store.Save(token); }
    public async Task<AgentPolicy> Policy() { using var r = Request(HttpMethod.Get, "/api/v1/time-tracking/agent-config"); var response = await http.SendAsync(r); if (!response.IsSuccessStatusCode) throw new Exception(await Error(response)); return await response.Content.ReadFromJsonAsync<AgentPolicy>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new AgentPolicy(); }
    public async Task<bool> IsActive() { using var r = Request(HttpMethod.Get, "/api/v1/time-tracking/me"); var response = await http.SendAsync(r); if (!response.IsSuccessStatusCode) throw new Exception(await Error(response)); return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.TryGetProperty("active", out var active) && active.GetBoolean(); }
    public async Task SetShift(string action)
    {
        using var r = Request(HttpMethod.Post, "/api/v1/time-tracking");
        r.Content = action == "start" ? JsonContent.Create(new { action, deviceId = store.DeviceId }) : JsonContent.Create(new { action });
        var response = await http.SendAsync(r); if (!response.IsSuccessStatusCode) throw new Exception(await Error(response));
    }
    public async Task Activity() { using var r = Request(HttpMethod.Post, "/api/v1/time-tracking/activity"); var now = DateTimeOffset.UtcNow; r.Content = JsonContent.Create(new { deviceId = store.DeviceId, entries = new[] { new { bucketStart = new DateTimeOffset(now.Year, now.Month, now.Day, now.Hour, now.Minute, 0, TimeSpan.Zero), durationSec = 60, appName = (string?)null, windowTitle = (string?)null, idle = IdleSeconds() > 300, privateMode = false } } }); var response = await http.SendAsync(r); if (!response.IsSuccessStatusCode) throw new Exception(await Error(response)); }
    public async Task Screenshot(int retentionDays, bool blurred)
    {
        var bounds = SystemInformation.VirtualScreen;
        using var image = new Bitmap(bounds.Width, bounds.Height);
        using (var graphics = Graphics.FromImage(image)) graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size);
        if (blurred) Pixelate(image);
        using var stream = new MemoryStream(); image.Save(stream, ImageFormat.Jpeg); stream.Position = 0;
        using var form = new MultipartFormDataContent(); form.Add(new StreamContent(stream) { Headers = { ContentType = new MediaTypeHeaderValue("image/jpeg") } }, "file", "capture.jpg"); form.Add(new StringContent(store.DeviceId), "deviceId"); form.Add(new StringContent(DateTimeOffset.UtcNow.ToString("O")), "capturedAt"); form.Add(new StringContent(retentionDays.ToString()), "retentionDays"); form.Add(new StringContent(blurred.ToString().ToLowerInvariant()), "blurred");
        using var r = Request(HttpMethod.Post, "/api/v1/time-tracking/screenshots"); r.Content = form; var response = await http.SendAsync(r); if (!response.IsSuccessStatusCode) throw new Exception(await Error(response));
    }
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInputInfo info);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    public static string ForegroundApp()
    {
        var handle = GetForegroundWindow(); if (handle == IntPtr.Zero) return string.Empty;
        GetWindowThreadProcessId(handle, out var id);
        try { return System.Diagnostics.Process.GetProcessById((int)id).ProcessName; } catch { return string.Empty; }
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
