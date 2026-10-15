/**
 * Saludos y avisos automáticos de WhatsApp Business («Gracias por
 * comunicarte con…», «Bienvenid@ a…», «En estos momentos no podemos
 * atenderle…»). La IA los clasificaba a menudo como interés o petición de
 * información: el lead quedaba como «respondido» y se paraban su secuencia y
 * su cadencia tras el primer mensaje.
 *
 * Solo frases propias de un mensaje automático; nunca se aplica si el texto
 * contiene una baja o un rechazo explícito.
 */
import { isExplicitRejectionReply, isOptOutReply, normalizedReply } from "./reply-classification";

const GREETING_PATTERNS: RegExp[] = [
  // «Bienvenid@ a Clínica X», «*Benvingut a …*»
  /^[\s¡!*_~"'.,:;-]*(?:(?:hola|buenas|muy buenas|bon dia|bones)[\s¡!*_~,.:;-]*)*(?:bienvenid[oa@]s?|benvingut|benvinguts|benvinguda|welcome)(?![a-z])/,
  // «Gracias por comunicarte con …», «… por ponerte en contacto con …»
  /\bgr[aà]ci(?:as|es)\s+(?:por|per)\s+(?:comunicarte|comunicar-te|ponerte\s+en\s+contacto|posar-te\s+en\s+contacte|contactar)\s+(?:con|amb)\b/,
  // Catalán: «Gràcies per escriure'm», «Gràcies pel teu missatge»
  /\bgr[aà]cies\s+(?:per|pel)\s+(?:escriure|el\s+teu\s+missatge|teu\s+missatge|contactar)/,
  /\b(?:est[aá]s|est[aá])\s+(?:pidiendo|solicitando)\s+cita\b/,
  /\ben\s+estos\s+momentos,?\s+no\s+(?:podemos|puedo)\s+atender/,
  /\bara\s+mateix,?\s+no\s+(?:podem|puc)\s+atendre/,
  /\b(?:mensaje|missatge|respuesta|resposta)\s+autom[aàá]tic[oa]?\b/,
  // «En breve te atenderemos», «Lo antes posible le responderemos»
  /\b(?:en\s+breve|en\s+breus\s+moments|lo\s+antes\s+posible|a\s+la\s+mayor\s+brevedad|tan\s+aviat\s+com\s+(?:pugui|puguem|sigui\s+possible))\b[^.!?]*\b(?:atenderemos|atenderle|atenderte|responderemos|contestaremos|atendrem|respondrem|et\s+respondr|us\s+respondr)/,
  /\bnuestro\s+horario\s+(?:de\s+atenci[oó]n\s+)?es\b/,
  /\b(?:fuera\s+del?\s+horario|fora\s+d['’]?horari)\b/
];

export function looksLikeAutomaticGreeting(text: string | null | undefined): boolean {
  const normalized = normalizedReply(String(text ?? ""));
  if (!normalized) return false;
  if (isOptOutReply(normalized) || isExplicitRejectionReply(normalized)) return false;
  return GREETING_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Un autorresponder contesta en segundos. Mensaje largo llegado nada más
 * enviar el nuestro, sin baja ni rechazo: se trata como automático.
 */
export function arrivedAsInstantAutoReply(text: string, receivedAt: Date, lastOutboundAt: Date | null, windowMs = 60_000): boolean {
  if (!lastOutboundAt) return false;
  const delta = receivedAt.getTime() - lastOutboundAt.getTime();
  if (delta < 0 || delta > windowMs) return false;
  const normalized = normalizedReply(text);
  if (normalized.length < 40 || isOptOutReply(normalized) || isExplicitRejectionReply(normalized)) return false;
  return true;
}
