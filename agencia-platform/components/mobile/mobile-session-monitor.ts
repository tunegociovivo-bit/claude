/** Observe both clean stream endings and transport failures, once per session. */
export function createMobileSessionMonitor(
  isCurrent: () => boolean,
  onEnd: (error: unknown) => void
) {
  let ended = false;
  const finish = (error: unknown) => {
    if (ended || !isCurrent()) return;
    ended = true;
    onEnd(error);
  };
  return {
    observe(promise: Promise<unknown>, closedMessage: string) {
      // Install the rejection handler immediately: ADB exposes disconnection
      // as a separate rejecting promise, even when the video is also observed.
      void promise.then(() => finish(new Error(closedMessage)), finish);
    }
  };
}
