using NegocioVivo.TimeAgent;
using Xunit;

public class DayProgressTests
{
    private static readonly DateTimeOffset At = new(2026, 9, 16, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void RunningDayAddsElapsedSecondsToEarlierWork()
    {
        var day = new DayProgress(true, At.AddHours(-1), 1800);
        Assert.Equal(1835, day.SecondsAt(At, At.AddSeconds(35), true));
    }

    [Fact]
    public void PausedDayDoesNotCountBreakTime()
    {
        var day = new DayProgress(false, At.AddHours(-1), 1800);
        Assert.Equal(1800, day.SecondsAt(At, At.AddMinutes(15), true));
    }

    [Fact]
    public void OfflineDayKeepsLastConfirmedTotal()
    {
        var day = new DayProgress(true, At, 90);
        Assert.Equal(90, day.SecondsAt(At, At.AddMinutes(5), false));
    }

    [Fact]
    public void NewServerSnapshotResumesFromDailyTotalWithoutCountingPause()
    {
        var resumed = new DayProgress(true, At.AddHours(-2), 3600);
        Assert.Equal(3660, resumed.SecondsAt(At, At.AddMinutes(1), true));
        var tomorrow = new DayProgress(true, At, 0);
        Assert.Equal(60, tomorrow.SecondsAt(At, At.AddMinutes(1), true));
    }
}
