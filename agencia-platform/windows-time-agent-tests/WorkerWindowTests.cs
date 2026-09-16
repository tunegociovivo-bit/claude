using System.Drawing;
using System.Reflection;
using System.Windows.Forms;
using NegocioVivo.TimeAgent;
using Xunit;

public class WorkerWindowTests
{
    [Fact]
    public void FinishingPersistsUntilNextDayWithoutDeletingEnrollment()
    {
        var folder = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        var store = new AgentStore(folder);
        var today = new DateTime(2026, 9, 16);
        store.Save("ag_test.test");
        store.FinishDay(today);
        Assert.True(new AgentStore(folder).IsFinished(today));
        Assert.False(store.IsFinished(today.AddDays(1)));
        Assert.Equal("ag_test.test", store.Token);
        store.ClearFinished();
        Assert.False(store.IsFinished(today));
        Directory.Delete(folder, true);
    }

    [Fact]
    public void FinishedWindowShowsZeroAndKeepsSavedTotal()
    {
        Exception? failure = null;
        var thread = new Thread(() => {
            var folder = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
            try {
                var store = new AgentStore(folder);
                store.FinishDay(DateTime.Today);
                using var form = new AgentForm(false, store);
                void Set(string name, object value) => typeof(AgentForm).GetField(name, BindingFlags.NonPublic | BindingFlags.Instance)!.SetValue(form, value);
                T Get<T>(string name) => (T)typeof(AgentForm).GetField(name, BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(form)!;
                Set("dayProgress", new DayProgress(false, DateTimeOffset.Now.AddHours(-2), 5400));
                Set("dayRequested", DateTime.Today); Set("online", true);
                typeof(AgentForm).GetMethod("Render", BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(form, new object[] { true });
                Assert.Equal("Hoy: 00:00:00", Get<Label>("workedLabel").Text);
                Assert.Equal("Total guardado hoy: 01:30:00", Get<Label>("startedLabel").Text);
                Assert.Equal(5400, Get<DayProgress>("dayProgress").WorkedSec);
                Assert.False(Get<Button>("start").Enabled);
                store.FinishDay(DateTime.Today.AddDays(-1));
                Set("dayProgress", new DayProgress(false, null, 0));
                typeof(AgentForm).GetMethod("Render", BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(form, new object[] { true });
                Assert.True(Get<Button>("start").Enabled);
            } catch (Exception ex) { failure = ex; }
            finally { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
        });
        thread.SetApartmentState(ApartmentState.STA); thread.Start(); thread.Join();
        if (failure is not null) throw failure;
    }

    [Theory]
    [InlineData(1f)]
    [InlineData(1.5f)]
    [InlineData(2f)]
    public void ThreeActionsStayInsideWindowAtDifferentScales(float scale)
    {
        Exception? failure = null;
        var thread = new Thread(() => {
            try {
                using var form = new AgentForm(false, new AgentStore(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString())));
                form.Scale(new SizeF(scale, scale));
                typeof(AgentForm).GetMethod("Render", BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(form, new object[] { true });
                form.CreateControl();
                form.PerformLayout();
                var names = new[] { "start", "pause", "finish" };
                foreach (var name in names) {
                    var button = (Button)typeof(AgentForm).GetField(name, BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(form)!;
                    button.Parent!.PerformLayout();
                    var bounds = new Rectangle(button.Left + button.Parent.Left, button.Top + button.Parent.Top, button.Width, button.Height);
                    Assert.True(form.ClientRectangle.Contains(bounds), $"{name}: {bounds} outside {form.ClientRectangle}");
                    Assert.True(button.Height >= 40);
                }
            } catch (Exception ex) { failure = ex; }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start(); thread.Join();
        if (failure is not null) throw failure;
    }
}
