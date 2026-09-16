using System.Net;
using System.Text.Json;
using NegocioVivo.TimeAgent;
using Xunit;

public class HubClientTests
{
    private sealed class Store : IAgentStore
    {
        public string DeviceId => "test-device-1234";
        public string? Token { get; private set; }
        public void Save(string token) => Token = token;
    }

    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request);
    }

    private static HttpResponseMessage Json(string body, HttpStatusCode status = HttpStatusCode.OK) => new(status) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };

    [Fact]
    public async Task EnrollmentValidatesTheActualBearerCredentialBeforeSaving()
    {
        var store = new Store();
        var client = new HubClient(store, new Handler(request => {
            Assert.Equal(HttpMethod.Get, request.Method);
            Assert.Equal("/api/v1/time-tracking/agent-config", request.RequestUri!.AbsolutePath);
            Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
            Assert.Equal("ag_example.example", request.Headers.Authorization.Parameter);
            Assert.Null(store.Token);
            return Task.FromResult(Json("{\"trackingEnabled\":true,\"screenshotsEnabled\":false}"));
        }));
        await client.Enroll("ag_example.example");
        Assert.Equal("ag_example.example", store.Token);
    }

    [Fact]
    public async Task RejectedCredentialDoesNotReplaceExistingEnrollment()
    {
        var store = new Store(); store.Save("ag_existing.valid");
        var client = new HubClient(store, new Handler(_ => Task.FromResult(Json("{\"error\":{\"message\":\"Credencial inválida\"}}", HttpStatusCode.Unauthorized))));
        var error = await Assert.ThrowsAsync<Exception>(() => client.Enroll("ag_invalid.invalid"));
        Assert.Equal("Credencial inválida", error.Message);
        Assert.Equal("ag_existing.valid", store.Token);
    }

    [Theory]
    [InlineData("")]
    [InlineData("NV-OLD-CODE")]
    [InlineData("NVV-OLD-CODE")]
    public async Task LegacyCodesAreRejectedWithoutCallingRemovedEndpoint(string code)
    {
        var client = new HubClient(new Store(), new Handler(_ => throw new InvalidOperationException("No request expected")));
        var error = await Assert.ThrowsAsync<Exception>(() => client.Enroll(code));
        Assert.Contains("credencial nueva", error.Message);
    }

    [Fact]
    public async Task ReadsPolicyFlagsWithoutChangingTheirMeaning()
    {
        var client = new HubClient(new Store(), new Handler(_ => Task.FromResult(Json("{\"trackingEnabled\":false,\"screenshotsEnabled\":false,\"collectApps\":false,\"collectIdle\":false,\"excludedApps\":[\"BANK\"]}"))));
        var policy = await client.Policy();
        Assert.False(policy.TrackingEnabled); Assert.False(policy.ScreenshotsEnabled);
        Assert.False(policy.CollectApps); Assert.False(policy.CollectIdle);
        Assert.True(policy.Excludes("my-bank-app"));
    }

    [Theory]
    [InlineData("start")]
    [InlineData("stop")]
    public async Task ShiftCommandsMatchHubContract(string action)
    {
        var store = new Store(); store.Save("ag_test.example");
        var client = new HubClient(store, new Handler(async request => {
            Assert.Equal("/api/v1/time-tracking", request.RequestUri!.AbsolutePath);
            Assert.Equal("ag_test.example", request.Headers.Authorization!.Parameter);
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
            Assert.Equal(action, body.RootElement.GetProperty("action").GetString());
            Assert.Equal(action == "start", body.RootElement.TryGetProperty("deviceId", out _));
            return Json("{}");
        }));
        await client.SetShift(action);
    }

    [Fact]
    public async Task IncompletePolicyCannotAuthorizeEnrollment()
    {
        var store = new Store();
        var client = new HubClient(store, new Handler(_ => Task.FromResult(Json("{}"))));
        await Assert.ThrowsAsync<Exception>(() => client.Enroll("ag_test.example"));
        Assert.Null(store.Token);
    }

    [Fact]
    public async Task NetworkFailureDoesNotSaveUnvalidatedCredential()
    {
        var store = new Store();
        var client = new HubClient(store, new Handler(_ => throw new HttpRequestException("Sin conexión")));
        await Assert.ThrowsAsync<HttpRequestException>(() => client.Enroll("ag_test.example"));
        Assert.Null(store.Token);
    }

    [Fact]
    public async Task DisabledCollectionSendsOnlyElapsedTimeWithoutWindowMetadata()
    {
        var client = new HubClient(new Store(), new Handler(async request => {
            Assert.Equal("/api/v1/time-tracking/activity", request.RequestUri!.AbsolutePath);
            using var json = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
            var entry = json.RootElement.GetProperty("entries")[0];
            Assert.Equal(17, entry.GetProperty("durationSec").GetInt32());
            Assert.Equal(JsonValueKind.Null, entry.GetProperty("appName").ValueKind);
            Assert.Equal(JsonValueKind.Null, entry.GetProperty("windowTitle").ValueKind);
            Assert.False(entry.GetProperty("idle").GetBoolean());
            Assert.True(entry.GetProperty("bucketStart").GetDateTimeOffset() < DateTimeOffset.UtcNow);
            return Json("{\"ok\":true}");
        }));
        await client.Activity(new AgentPolicy { CollectApps = false, CollectIdle = false, CollectWindowTitles = false }, 17);
    }

    [Fact]
    public async Task ScreenshotMultipartUsesBrowserCompatibleDispositionFields()
    {
        using var form = HubClient.ScreenshotForm([1, 2, 3], "device-test", 30, false);
        var encoded = await form.ReadAsStringAsync();
        Assert.Contains("name=\"file\"; filename=\"capture.jpg\"", encoded);
        Assert.DoesNotContain("filename*=", encoded);
        foreach (var name in new[] { "deviceId", "capturedAt", "retentionDays", "blurred" })
            Assert.Contains($"name=\"{name}\"", encoded);
    }
}
