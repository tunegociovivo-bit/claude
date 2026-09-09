function digits(value: string) {
  return value.replace(/\D/g, "");
}

export function identifyMetaBillingAccount(input: {
  messageText: string;
  pdfText?: string | null;
  accountIds: string[];
}) {
  const haystack = digits(`${input.messageText}\n${input.pdfText || ""}`);
  const matches = [...new Set(input.accountIds.filter((id) => {
    const normalized = digits(id);
    return normalized.length >= 6 && haystack.includes(normalized);
  }))];
  return matches.length === 1 ? matches[0] : null;
}
