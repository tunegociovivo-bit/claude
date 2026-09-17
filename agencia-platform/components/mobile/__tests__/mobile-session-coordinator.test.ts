import { describe, expect, it, vi } from "vitest";
import {
  closeMobileSessionResources,
  createMobileSessionAttemptTracker,
  createMobileSessionCoordinator,
  runBoundedMobileSessionCleanup,
  type MobileSessionBroadcastChannel
} from "../mobile-session-coordinator";

type MessageListener = (event: MessageEvent<unknown>) => void;

class MemoryBroadcastChannel implements MobileSessionBroadcastChannel {
  private static readonly channels = new Map<string, Set<MemoryBroadcastChannel>>();
  private readonly listeners = new Set<MessageListener>();

  constructor(private readonly name: string) {
    const peers = MemoryBroadcastChannel.channels.get(name) ?? new Set<MemoryBroadcastChannel>();
    peers.add(this);
    MemoryBroadcastChannel.channels.set(name, peers);
  }

  addEventListener(_type: "message", listener: MessageListener) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: MessageListener) {
    this.listeners.delete(listener);
  }

  postMessage(message: unknown) {
    for (const peer of MemoryBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer === this) continue;
      queueMicrotask(() => {
        for (const listener of peer.listeners) {
          listener({ data: message } as MessageEvent<unknown>);
        }
      });
    }
  }

  close() {
    this.listeners.clear();
    const peers = MemoryBroadcastChannel.channels.get(this.name);
    peers?.delete(this);
    if (peers?.size === 0) MemoryBroadcastChannel.channels.delete(this.name);
  }
}

class ScriptedResponseChannel implements MobileSessionBroadcastChannel {
  private readonly listeners = new Set<MessageListener>();
  private requestId = "";

  addEventListener(_type: "message", listener: MessageListener) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: MessageListener) {
    this.listeners.delete(listener);
  }

  postMessage(message: unknown) {
    const request = message as { type?: string; requestId?: string };
    if (request.type !== "release-requested" || !request.requestId) return;
    this.requestId = request.requestId;
    queueMicrotask(() => {
      this.emit("release-started", "fast");
      this.emit("release-finished", "fast");
    });
    setTimeout(() => this.emit("release-started", "slow"), 2);
  }

  finishSlowRelease() {
    this.emit("release-finished", "slow");
  }

  close() {
    this.listeners.clear();
  }

  private emit(type: "release-started" | "release-finished", ownerId: string) {
    const event = {
      data: { type, requestId: this.requestId, ownerId }
    } as MessageEvent<unknown>;
    for (const listener of this.listeners) listener(event);
  }
}

describe("mobile session coordinator", () => {
  it("keeps an active screen connected when another tab requests it", async () => {
    const release = vi.fn(async () => undefined);
    let active = true;
    const factory = (name: string) => new MemoryBroadcastChannel(name);
    const existing = createMobileSessionCoordinator({
      serial: "protected-phone", release, isActive: () => active,
      channelFactory: factory, discoveryWindowMs: 5
    });
    const incoming = createMobileSessionCoordinator({
      serial: "protected-phone", release: async () => undefined,
      channelFactory: factory, discoveryWindowMs: 5
    });
    try {
      await expect(incoming.requestRelease()).resolves.toBe("busy");
      expect(release).not.toHaveBeenCalled();
      active = false;
      await expect(incoming.requestRelease()).resolves.toBe("released");
      expect(release).toHaveBeenCalledTimes(1);
    } finally { existing.close(); incoming.close(); }
  });

  it("does not cancel either in-flight connection when tabs start simultaneously", async () => {
    const releaseA = vi.fn(async () => undefined);
    const releaseB = vi.fn(async () => undefined);
    const factory = (name: string) => new MemoryBroadcastChannel(name);
    const a = createMobileSessionCoordinator({ serial: "simultaneous-phone", release: releaseA, isActive: () => true, channelFactory: factory, discoveryWindowMs: 5 });
    const b = createMobileSessionCoordinator({ serial: "simultaneous-phone", release: releaseB, isActive: () => true, channelFactory: factory, discoveryWindowMs: 5 });
    try {
      expect(await Promise.all([a.requestRelease(), b.requestRelease()])).toEqual(["busy", "busy"]);
      expect(releaseA).not.toHaveBeenCalled();
      expect(releaseB).not.toHaveBeenCalled();
    } finally { a.close(); b.close(); }
  });

  it("asks an existing tab to release the same Android before connecting", async () => {
    const release = vi.fn(async () => undefined);
    const factory = (name: string) => new MemoryBroadcastChannel(name);
    const existing = createMobileSessionCoordinator({
      serial: "5bf19462",
      ownerId: "existing",
      release,
      channelFactory: factory,
      discoveryWindowMs: 5,
      releaseTimeoutMs: 100
    });
    const incoming = createMobileSessionCoordinator({
      serial: "5bf19462",
      ownerId: "incoming",
      release: async () => undefined,
      channelFactory: factory,
      discoveryWindowMs: 5,
      releaseTimeoutMs: 100
    });

    await expect(incoming.requestRelease()).resolves.toBe("released");
    expect(release).toHaveBeenCalledTimes(1);

    incoming.close();
    existing.close();
  });

  it("does not delay a connection when no other tab owns the Android", async () => {
    const coordinator = createMobileSessionCoordinator({
      serial: "320135530517",
      ownerId: "only-tab",
      release: async () => undefined,
      channelFactory: (name) => new MemoryBroadcastChannel(name),
      discoveryWindowMs: 1,
      releaseTimeoutMs: 20
    });

    await expect(coordinator.requestRelease()).resolves.toBe("none");
    coordinator.close();
  });

  it("waits for every tab discovered before reporting that the Android was released", async () => {
    const scriptedChannel = new ScriptedResponseChannel();
    const incoming = createMobileSessionCoordinator({
      serial: "multi-tab-device",
      ownerId: "incoming",
      release: async () => undefined,
      channelFactory: () => scriptedChannel,
      discoveryWindowMs: 10,
      releaseTimeoutMs: 100
    });

    const releaseResult = incoming.requestRelease();
    await expect(Promise.race([
      releaseResult.then(() => "resolved"),
      new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 20))
    ])).resolves.toBe("waiting");
    scriptedChannel.finishSlowRelease();
    await expect(releaseResult).resolves.toBe("released");

    incoming.close();
  });
});

describe("mobile session attempt tracker", () => {
  it("keeps an in-flight connection cancelled after cleanup finishes", async () => {
    const tracker = createMobileSessionAttemptTracker();
    const attempt = tracker.begin();
    let finishConnect: (() => void) | undefined;
    const connect = new Promise<void>((resolve) => {
      finishConnect = resolve;
    });
    const connectionResult = connect.then(() => attempt.isCurrent());

    tracker.invalidate();
    finishConnect?.();

    await expect(connectionResult).resolves.toBe(false);
  });
});

describe("bounded mobile session cleanup", () => {
  it("closes the raw USB connection while ADB authentication is still pending", async () => {
    const closeRawUsb = vi.fn(async () => undefined);

    await closeMobileSessionResources({
      connection: { device: { raw: { close: closeRawUsb } } }
    }, 100);

    expect(closeRawUsb).toHaveBeenCalledTimes(1);
  });

  it("continues closing ADB even when an earlier cleanup operation never settles", async () => {
    vi.useFakeTimers();
    const closeAdb = vi.fn(async () => undefined);
    const cleanup = runBoundedMobileSessionCleanup([
      async () => new Promise<void>(() => undefined),
      closeAdb
    ], 100);

    await vi.advanceTimersByTimeAsync(101);
    await cleanup;

    expect(closeAdb).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
