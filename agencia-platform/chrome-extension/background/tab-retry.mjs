export function isTabTemporarilyBusy(error) {
  return /Tabs cannot be edited right now|user may be dragging a tab/i.test(String(error?.message || error));
}

export async function retryTabOperation(operation, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const delays = [250, 500, 1000, 2000, 3000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isTabTemporarilyBusy(error) || attempt >= delays.length) throw error;
      await pause(delays[attempt]);
    }
  }
}
