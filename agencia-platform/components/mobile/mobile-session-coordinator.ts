export type MobileSessionBroadcastChannel = {
  addEventListener: (type: "message", listener: (event: MessageEvent<unknown>) => void) => void;
  removeEventListener: (type: "message", listener: (event: MessageEvent<unknown>) => void) => void;
  postMessage: (message: unknown) => void;
  close: () => void;
};

type MobileSessionMessage = {
  type: "release-requested" | "release-started" | "release-finished";
  requestId: string;
  ownerId: string;
};

type CoordinatorOptions = {
  serial: string;
  release: () => Promise<void>;
  ownerId?: string;
  channelFactory?: (name: string) => MobileSessionBroadcastChannel;
  discoveryWindowMs?: number;
  releaseTimeoutMs?: number;
};

export type MobileSessionReleaseResult = "none" | "released" | "timed_out";

const DEFAULT_DISCOVERY_WINDOW_MS = 150;
const DEFAULT_RELEASE_TIMEOUT_MS = 8_000;

export function createMobileSessionAttemptTracker() {
  let generation = 0;
  return {
    begin() {
      const attemptGeneration = ++generation;
      return {
        isCurrent: () => generation === attemptGeneration
      };
    },
    invalidate() {
      generation += 1;
    }
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isMobileSessionMessage(value: unknown): value is MobileSessionMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<MobileSessionMessage>;
  return (
    ["release-requested", "release-started", "release-finished"].includes(String(message.type))
    && typeof message.requestId === "string"
    && typeof message.ownerId === "string"
  );
}

export function createMobileSessionCoordinator(options: CoordinatorOptions) {
  const ownerId = options.ownerId ?? randomId();
  const discoveryWindowMs = options.discoveryWindowMs ?? DEFAULT_DISCOVERY_WINDOW_MS;
  const releaseTimeoutMs = options.releaseTimeoutMs ?? DEFAULT_RELEASE_TIMEOUT_MS;
  const channelFactory = options.channelFactory ?? ((name: string) => new BroadcastChannel(name));
  const channel = channelFactory(`nv-mobile-session:${options.serial}`);
  const handledRequests = new Set<string>();

  const onReleaseRequest = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (
      !isMobileSessionMessage(message)
      || message.type !== "release-requested"
      || message.ownerId === ownerId
      || handledRequests.has(message.requestId)
    ) return;

    handledRequests.add(message.requestId);
    channel.postMessage({
      type: "release-started",
      requestId: message.requestId,
      ownerId
    } satisfies MobileSessionMessage);
    void options.release()
      .catch(() => undefined)
      .then(() => {
        try {
          channel.postMessage({
            type: "release-finished",
            requestId: message.requestId,
            ownerId
          } satisfies MobileSessionMessage);
        } catch {
          // The tab can disappear while its bounded cleanup is finishing.
        }
      });
  };

  channel.addEventListener("message", onReleaseRequest);

  return {
    async requestRelease(): Promise<MobileSessionReleaseResult> {
      const requestId = randomId();
      const startedOwners = new Set<string>();
      const finishedOwners = new Set<string>();
      let expectedOwners = new Set<string>();
      let discoveryComplete = false;
      let notifyFinished: (() => void) | undefined;
      const finishedSignal = new Promise<void>((resolve) => {
        notifyFinished = resolve;
      });
      const notifyWhenEveryOwnerFinished = () => {
        if (
          discoveryComplete
          && [...expectedOwners].every((expectedOwner) => finishedOwners.has(expectedOwner))
        ) {
          notifyFinished?.();
        }
      };
      const onResponse = (event: MessageEvent<unknown>) => {
        const message = event.data;
        if (!isMobileSessionMessage(message) || message.requestId !== requestId) return;
        if (message.type === "release-started") startedOwners.add(message.ownerId);
        if (message.type === "release-finished") {
          finishedOwners.add(message.ownerId);
          notifyWhenEveryOwnerFinished();
        }
      };

      channel.addEventListener("message", onResponse);
      try {
        channel.postMessage({ type: "release-requested", requestId, ownerId } satisfies MobileSessionMessage);
        await delay(discoveryWindowMs);
        if (startedOwners.size === 0) return "none";
        expectedOwners = new Set(startedOwners);
        discoveryComplete = true;
        notifyWhenEveryOwnerFinished();
        const completed = await Promise.race([
          finishedSignal.then(() => true),
          delay(releaseTimeoutMs).then(() => false)
        ]);
        return completed ? "released" : "timed_out";
      } finally {
        channel.removeEventListener("message", onResponse);
      }
    },
    close() {
      channel.removeEventListener("message", onReleaseRequest);
      channel.close();
    }
  };
}

async function settleWithin(task: () => Promise<unknown>, timeoutMs: number): Promise<void> {
  const settledTask = Promise.resolve()
    .then(task)
    .catch(() => undefined);
  await Promise.race([settledTask, delay(timeoutMs)]);
}

export async function runBoundedMobileSessionCleanup(
  tasks: ReadonlyArray<() => Promise<unknown>>,
  timeoutPerTaskMs = 1_000
): Promise<void> {
  for (const task of tasks) {
    await settleWithin(task, timeoutPerTaskMs);
  }
}

type MobileSessionClosable = { close: () => Promise<unknown> };
type MobileSessionRestorable = { restore: () => Promise<unknown> };
type MobileSessionRawConnection = {
  device: { raw: { close: () => Promise<unknown> } };
};

export async function closeMobileSessionResources(
  resources: {
    awakeSession?: MobileSessionRestorable;
    client?: MobileSessionClosable;
    adb?: MobileSessionClosable;
    connection?: MobileSessionRawConnection;
    pendingConnection?: Promise<MobileSessionRawConnection>;
  },
  timeoutPerTaskMs = 1_000
): Promise<void> {
  await runBoundedMobileSessionCleanup([
    async () => { await resources.awakeSession?.restore(); },
    async () => { await resources.client?.close(); },
    async () => { await resources.adb?.close(); },
    async () => {
      const connectedTransport = resources.connection ?? await resources.pendingConnection;
      await connectedTransport?.device.raw.close();
    }
  ], timeoutPerTaskMs);
}
