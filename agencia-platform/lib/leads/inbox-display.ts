type PhoneDisplay = {
  leadPhone?: string | null;
  realPhone?: string | null;
  isLid?: boolean;
  selectedPhone: string;
};

type ConversationHeaderInput = PhoneDisplay & {
  leadName?: string | null;
  displayName?: string | null;
};

type Channel = { name: string; label?: string | null };

export function displayedLeadPhone(input: PhoneDisplay): string {
  return input.leadPhone || input.realPhone || (input.isLid ? "nº oculto por WhatsApp" : input.selectedPhone);
}

export function conversationHeader(input: ConversationHeaderInput): {
  title: string;
  titleIsPhone: boolean;
} {
  const savedName = input.leadName?.trim() || input.displayName?.trim();
  return savedName
    ? { title: savedName, titleIsPhone: false }
    : { title: displayedLeadPhone(input), titleIsPhone: true };
}

export function conversationListTitle(input: ConversationHeaderInput): string {
  return conversationHeader(input).title;
}

export function managedChannelLabel(
  channels: Channel[],
  name: string | null | undefined,
): string {
  if (!name) return "Principal";
  const channel = channels.find((candidate) => candidate.name === name);
  const label = channel?.label?.trim();
  if (!label || label === name) return name;
  return `${name} - ${label}`;
}
