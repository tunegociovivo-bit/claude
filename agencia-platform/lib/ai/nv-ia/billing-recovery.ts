const RECOVERABLE_STATUSES = new Set(["FAILED", "REQUIRES_HUMAN"]);

const ANTHROPIC_BILLING_ERRORS = [
  "credit balance is too low",
  "plans & billing",
  "purchase credits"
];

export function isRecoverableAnthropicBillingFailure(run: {
  status: string;
  error: string | null;
}): boolean {
  if (!RECOVERABLE_STATUSES.has(run.status) || !run.error) return false;

  const normalizedError = run.error.toLowerCase();
  return ANTHROPIC_BILLING_ERRORS.some((message) => normalizedError.includes(message));
}
