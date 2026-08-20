/**
 * Resolución de identidad de un contacto entrante de WhatsApp.
 *
 * Con el nuevo sistema LID (Linked ID) de WhatsApp, el `from` de un mensaje
 * puede ser un id privado (…@lid) en vez del teléfono real, que Meta oculta a
 * propósito. Estas utilidades intentan sacar el número real del payload del
 * webhook (WAHA/Evolution lo incluye a veces en otros campos) y detectan si
 * el contacto es un LID para no mostrar el id feo al usuario.
 */

/** ¿Parece un teléfono real (E.164 sin +)? 8-15 dígitos con código de país. */
export function looksLikePhone(s: string | null | undefined): boolean {
  if (!s) return false;
  const d = String(s).replace(/\D/g, "");
  // Un LID suele tener 13-19 dígitos sin código de país plausible; los
  // teléfonos reales con prefijo van de 8 a 15. Exigimos prefijo conocido.
  if (d.length < 8 || d.length > 15) return false;
  return /^(34|1|44|33|49|39|351|352|31|32|41|43|45|46|47|48|351|352|212|213|216|52|54|55|57|56|58|591|593|595|598|502|503|504|505|506|507|509|7|380|40|30|353|358|420|421|36|385|386|90|972|971|966|countrycode)/.test(
    d
  )
    ? d.length <= 13
    : false;
}

/** Saca el mejor teléfono real (@c.us) de un payload de webhook, o null. */
export function realPhoneFromMeta(meta: any): string | null {
  if (!meta) return null;
  const candidates = [
    meta?.payload?.from,
    meta?.payload?.author,
    meta?.payload?.participant,
    meta?.payload?._data?.author,
    meta?.payload?._data?.from,
    meta?.payload?._data?.id?.remote,
    meta?.payload?._data?.key?.remoteJidAlt,
    meta?.payload?._data?.key?.remoteJid,
    meta?.payload?._data?.Info?.Chat,
    meta?.payload?._data?.Info?.Sender,
    meta?.payload?._data?.Info?.Recipient,
    meta?.from,
    meta?.author
  ].filter((x): x is string => typeof x === "string" && x.length > 0);
  // Preferimos los @c.us (número real); ignoramos @lid / @g.us.
  for (const c of candidates) {
    if (/@(?:c\.us|s\.whatsapp\.net)$/i.test(c)) {
      const d = c.replace(/@.*$/, "").replace(/\D/g, "");
      if (looksLikePhone(d)) return d;
    }
  }
  // Algún campo puede traer el número pelado.
  for (const c of candidates) {
    const d = c.replace(/@.*$/, "").replace(/\D/g, "");
    if (/@(?:c\.us|s\.whatsapp\.net)$/i.test(c) || (!/@/.test(c) && looksLikePhone(d))) return d;
  }
  return null;
}

/** ¿El remitente es un LID (número oculto por WhatsApp)? */
export function isLidFromMeta(meta: any): boolean {
  const from = meta?.payload?.from ?? meta?.from;
  if (typeof from === "string" && /@lid$/i.test(from)) return true;
  return false;
}
