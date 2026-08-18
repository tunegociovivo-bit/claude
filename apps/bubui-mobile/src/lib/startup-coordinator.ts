export type StartupRoute = "Feed" | "Onboarding";

export type StartupSession = {
  customerId: string;
};

type StartupDependencies<TSession extends StartupSession> = {
  checkSession: () => Promise<TSession | null>;
  waitForDealCapture: () => Promise<void>;
  waitForReferralCapture: () => Promise<void>;
  getPendingDeal: () => Promise<string | null>;
  deadlineMs: number;
};

export type StartupResult<TSession extends StartupSession> = {
  route: StartupRoute;
  session: TSession | null;
  pendingDeal: string | null;
  timedOut: boolean;
};

const FALLBACK: StartupResult<never> = {
  route: "Onboarding",
  session: null,
  pendingDeal: null,
  timedOut: true
};

/** Resolve the first screen under one hard deadline. */
export async function resolveStartupRoute<TSession extends StartupSession>(
  deps: StartupDependencies<TSession>
): Promise<StartupResult<TSession>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<StartupResult<TSession>>((resolve) => {
    timer = setTimeout(() => resolve(FALLBACK), deps.deadlineMs);
  });

  const hydration = (async (): Promise<StartupResult<TSession>> => {
    try {
      const session = await deps.checkSession();
      await deps.waitForDealCapture();
      await deps.waitForReferralCapture();
      const pendingDeal = await deps.getPendingDeal();
      return {
        route: session ? "Feed" : "Onboarding",
        session,
        pendingDeal,
        timedOut: false
      };
    } catch {
      return { ...FALLBACK, timedOut: false };
    }
  })();

  const result = await Promise.race([hydration, deadline]);
  if (timer) clearTimeout(timer);
  return result;
}
