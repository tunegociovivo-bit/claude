export type ConversationSearchMode = "groups" | "posts";

export function conversationDestination(target: string, keyword = "") {
  const value = target.trim();
  if (!value || /^https?:\/\//i.test(value)) return { targetUrl: value, searchTerm: keyword.trim() };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.includes("facebook.com/")) throw new Error("El enlace no es válido. Usa una URL https completa o escribe la palabra clave en el buscador.");
  return { targetUrl: "", searchTerm: keyword.trim() || value };
}

export function validCalendarDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function postMatchesKeyword(text: string, keyword: string) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const terms = normalize(keyword).trim().split(/\s+/).filter(Boolean);
  return terms.every(term => normalize(text).includes(term));
}
