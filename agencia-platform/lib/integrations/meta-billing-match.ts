function accountPattern(accountId: string) {
  const parts = accountId.replace(/\D/g, "").split("");
  return new RegExp(`(?<!\\d)${parts.join("[\\s-]*")}(?!\\d)`);
}

export function identifyMetaBillingAccount(input: {
  messageText: string;
  pdfText?: string | null;
  accountIds: string[];
}) {
  const sources = [input.messageText, input.pdfText || ""];
  const matches = [...new Set(input.accountIds.filter((id) =>
    id.replace(/\D/g, "").length >= 6 && sources.some((source) => accountPattern(id).test(source)),
  ))];
  return matches.length === 1 ? matches[0] : null;
}

export function isTrustedMetaBillingSender(addresses: string[]) {
  return addresses.some((address) => {
    const domain = address.trim().toLowerCase().split("@").pop() || "";
    return ["facebookmail.com", "facebook.com", "meta.com"].some(
      (trusted) => domain === trusted || domain.endsWith(`.${trusted}`),
    );
  });
}

export function hasAuthenticatedMetaSender(authenticationResults: string, trustedAuthservIds: string[]) {
  const value = authenticationResults.toLowerCase();
  const authservId = value.match(/^\s*([^;\s]+)\s*;/)?.[1] || "";
  if (!trustedAuthservIds.some((id) => id.trim().toLowerCase() === authservId)) return false;
  const trustedDomain = String.raw`(?:[a-z0-9-]+\.)*(?:facebookmail\.com|facebook\.com|meta\.com)(?=\s|;|$)`;
  return new RegExp(String.raw`(?:dkim=pass[^;\r\n]*(?:header\.(?:i|d)=@?|d=)${trustedDomain}|dmarc=pass[^;\r\n]*header\.from=${trustedDomain}|spf=pass[^;\r\n]*smtp\.mailfrom=[^;\s@]*@?${trustedDomain})`, "i").test(value);
}

export function isScannableBillingMailbox(mailbox: { path: string; specialUse?: string | null; noSelect?: boolean }) {
  if (mailbox.noSelect) return false;
  const specialUse = String(mailbox.specialUse || "").toLowerCase();
  if (["\\sent", "\\trash", "\\junk", "\\drafts", "\\all"].includes(specialUse)) return false;
  return !/(^|[./])(?:sent|enviados|trash|papelera|spam|junk|drafts|borradores|all mail)([./]|$)/i.test(mailbox.path);
}
