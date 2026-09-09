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
