import { describe, expect, it, vi } from "vitest";
import { AndroidMotionEventAction } from "@yume-chan/scrcpy";
import { createMobileTouchInput, parseAndroidDisplaySize } from "../mobile-touch-input";

function setup(output = "Physical size: 1080x2160", video = { width: 480, height: 960 }) {
  const controller = { injectTouch: vi.fn(async () => {}), injectKeyCode: vi.fn(async () => {}) };
  const readDisplaySize = vi.fn(async () => output);
  const wait = vi.fn(async () => {});
  return { controller, readDisplaySize, wait, input: createMobileTouchInput({ controller, readDisplaySize, videoSize: () => video, wait }) };
}

describe("mobile live control input", () => {
  it("prefers the Android override to physical resolution", () => {
    expect(parseAndroidDisplaySize("Physical size: 1080x2160\nOverride size: 480x960")).toEqual({ width: 480, height: 960 });
  });
  it("maps accessibility coordinates to the video and releases the finger", async () => {
    const { input, controller, readDisplaySize } = setup();
    await input.tap({ x: 999, y: 1800 });
    expect(controller.injectTouch.mock.calls).toEqual([
      [expect.objectContaining({ action: AndroidMotionEventAction.Down, pointerX: 444, pointerY: 800, videoWidth: 480, videoHeight: 960, pressure: 1 })],
      [expect.objectContaining({ action: AndroidMotionEventAction.Up, pointerX: 444, pointerY: 800, pressure: 0 })]
    ]);
    await input.tap({ x: 500, y: 900 });
    expect(readDisplaySize).toHaveBeenCalledTimes(1);
  });
  it("handles a rotated display", async () => {
    const { input, controller } = setup("Physical size: 1080x2160", { width: 960, height: 480 });
    await input.tap({ x: 1800, y: 900 });
    expect(controller.injectTouch).toHaveBeenCalledWith(expect.objectContaining({ pointerX: 800, pointerY: 400 }));
  });
  it.each(["", "Physical size: 0x960"])("rejects unknown screen geometry %s", async output => {
    const { input, controller } = setup(output);
    await expect(input.tap({ x: 1, y: 1 })).rejects.toThrow("tamaño real");
    expect(controller.injectTouch).not.toHaveBeenCalled();
  });
  it("rejects coordinates outside the native display before touching", async () => {
    const { input, controller } = setup();
    await expect(input.tap({ x: 1080, y: 1 })).rejects.toThrow("fuera");
    expect(controller.injectTouch).not.toHaveBeenCalled();
  });
  it("does not touch before a valid video frame is available", async () => {
    const { input, controller } = setup("Physical size: 480x960", { width: 0, height: 0 });
    await expect(input.tap({ x: 1, y: 1 })).rejects.toThrow("dimensiones válidas");
    expect(controller.injectTouch).not.toHaveBeenCalled();
  });
  it("rejects a swipe with an invalid endpoint before touching", async () => {
    const { input, controller } = setup();
    await expect(input.swipe({ x: 1, y: 1 }, { x: 1, y: -1 })).rejects.toThrow("fuera");
    expect(controller.injectTouch).not.toHaveBeenCalled();
  });
  it("releases the finger after a failed down event and preserves the failure", async () => {
    const { input, controller } = setup();
    controller.injectTouch.mockRejectedValueOnce(new Error("disconnected"));
    await expect(input.tap({ x: 100, y: 100 })).rejects.toThrow("disconnected");
    expect(controller.injectTouch).toHaveBeenLastCalledWith(expect.objectContaining({ action: AndroidMotionEventAction.Up, pressure: 0 }));
  });
  it("propagates a failed release", async () => {
    const { input, controller } = setup();
    controller.injectTouch.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("release failed"));
    await expect(input.tap({ x: 100, y: 100 })).rejects.toThrow("release failed");
  });
  it("makes a paced swipe on the same channel and releases at its endpoint", async () => {
    const { input, controller, wait } = setup("Physical size: 480x960");
    await input.swipe({ x: 240, y: 690 }, { x: 240, y: 585 });
    expect(wait).toHaveBeenCalledTimes(7);
    expect(controller.injectTouch).toHaveBeenCalledTimes(9);
    expect(controller.injectTouch).toHaveBeenLastCalledWith(expect.objectContaining({ action: AndroidMotionEventAction.Up, pointerX: 240, pointerY: 585 }));
  });
  it("sends Back over the control channel", async () => {
    const { input, controller, readDisplaySize } = setup();
    await input.back();
    expect(controller.injectKeyCode).toHaveBeenCalledTimes(2);
    expect(readDisplaySize).not.toHaveBeenCalled();
  });
});
