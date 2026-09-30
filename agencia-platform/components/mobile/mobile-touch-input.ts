import { AndroidKeyCode, AndroidKeyEventAction, AndroidKeyEventMeta, AndroidMotionEventAction, AndroidMotionEventButton, ScrcpyPointerId, type ScrcpyControlMessageWriter } from "@yume-chan/scrcpy";
import type { AndroidUiPoint } from "./android-ui-hierarchy";

type Size = { width: number; height: number };
type Dependencies = {
  controller: Pick<ScrcpyControlMessageWriter, "injectTouch" | "injectKeyCode">;
  readDisplaySize: () => Promise<string>;
  videoSize: () => Size;
  wait: (ms: number) => Promise<void>;
};

export function parseAndroidDisplaySize(output: string): Size {
  const match = /Override size:\s*(\d+)x(\d+)/i.exec(output) ?? /Physical size:\s*(\d+)x(\d+)/i.exec(output);
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) throw new Error("No se conoce el tamaño real de la pantalla Android.");
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** Reuses the live control channel instead of spawning Android's input process per gesture. */
export function createMobileTouchInput(deps: Dependencies) {
  let display: Promise<Size> | undefined;
  async function geometry() {
    display ??= deps.readDisplaySize().then(parseAndroidDisplaySize);
    const native = await display;
    const video = deps.videoSize();
    if (![video.width, video.height].every(value => Number.isInteger(value) && value > 0 && value <= 65535)) throw new Error("La pantalla de control todavía no tiene dimensiones válidas.");
    const rotated = (native.width > native.height) !== (video.width > video.height);
    const source = rotated ? { width: native.height, height: native.width } : native;
    return { source, video };
  }
  async function gesture(from: AndroidUiPoint, to?: AndroidUiPoint) {
    const { source, video } = await geometry();
    const position = (point: AndroidUiPoint) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= source.width || point.y >= source.height) {
        throw new Error("El toque queda fuera de la pantalla Android.");
      }
      return { pointerX: Math.min(video.width - 1, Math.round(point.x * video.width / source.width)), pointerY: Math.min(video.height - 1, Math.round(point.y * video.height / source.height)) };
    };
    let point = position(from);
    if (to) position(to); // Validate both endpoints before touching the screen.
    const inject = (action: AndroidMotionEventAction) => deps.controller.injectTouch({
      action, pointerId: ScrcpyPointerId.Finger, ...point, videoWidth: video.width, videoHeight: video.height,
      pressure: action === AndroidMotionEventAction.Up ? 0 : 1,
      actionButton: AndroidMotionEventButton.None, buttons: AndroidMotionEventButton.None
    });
    let failed = false;
    try {
      await inject(AndroidMotionEventAction.Down);
      if (to) {
        for (let step = 1; step <= 7; step++) {
          await deps.wait(50);
          point = position({ x: from.x + (to.x - from.x) * step / 7, y: from.y + (to.y - from.y) * step / 7 });
          await inject(AndroidMotionEventAction.Move);
        }
      }
    } catch (error) { failed = true; throw error; }
    finally {
      try { await inject(AndroidMotionEventAction.Up); }
      catch (error) { if (!failed) throw error; }
    }
  }
  return {
    tap: (point: AndroidUiPoint) => gesture(point),
    swipe: (from: AndroidUiPoint, to: AndroidUiPoint) => gesture(from, to),
    back: async () => {
      for (const action of [AndroidKeyEventAction.Down, AndroidKeyEventAction.Up]) {
        await deps.controller.injectKeyCode({ action, keyCode: AndroidKeyCode.AndroidBack, repeat: 0, metaState: AndroidKeyEventMeta.None });
      }
    }
  };
}
