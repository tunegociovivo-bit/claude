// Keep a fleet responsive without continuously saturating its shared USB link.
export const MOBILE_VIDEO_OPTIONS = { maxSize: 960, videoBitRate: 1_000_000, maxFps: 10 };

export function mobileReconnectDelay(serial: string, attempts: number): number {
  const stagger = [...serial].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0) % 3_000;
  return Math.min(30_000, 2_000 * 2 ** Math.min(Math.max(0, attempts), 4)) + stagger;
}

/** Close resources arriving after a timeout, rather than leaking a USB owner. */
export function boundedMobileConnectionStep<T>(
  pending: Promise<T>,
  timeoutMs: number,
  label: string,
  closeLate?: (value: T) => Promise<unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(`${label} no ha respondido a tiempo. Se volverá a intentar la conexión automáticamente.`));
    }, timeoutMs);
    pending.then(value => {
      if (settled) {
        // The session is already failed; late cleanup must not revive it.
        if (closeLate) void Promise.resolve().then(() => closeLate(value)).catch(() => undefined);
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}
