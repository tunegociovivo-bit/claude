export type WhatsAppTarget = "consumer" | "business";

export const WHATSAPP_PACKAGES: Record<WhatsAppTarget, string> = {
  consumer: "com.whatsapp",
  business: "com.whatsapp.w4b",
};

export function whatsappChatUrl(phone: string, message: string) {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function whatsappAppUrl(phone: string, message: string) {
  const digits = phone.replace(/\D/g, "");
  return `whatsapp://send?phone=${digits}&text=${encodeURIComponent(message)}`;
}

export function canRemindChallengeFriend(progress?: { registered?: boolean; redeemed?: boolean } | null) {
  return !!progress?.registered && !progress?.redeemed;
}
