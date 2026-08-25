export type SepaApprovalContext = {
  source: "HOLDED" | "HUB";
  importedNow: boolean;
  legacyAutoApproveFlag?: boolean;
};

/**
 * Every SEPA debit requires a deliberate administrator decision.
 * Import origin, recency and legacy environment flags must never bypass it.
 */
export function requiresExplicitApproval(_context: SepaApprovalContext): true {
  return true;
}
