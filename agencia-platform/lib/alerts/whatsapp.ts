/**
 * Aviso operativo por WhatsApp (pasarela CallMeBot).
 *
 * IMPORTANTE: este canal es deliberadamente INDEPENDIENTE de WAHA. Si los
 * avisos salieran por nuestro propio WhatsApp, justo en la averia que
 * queremos detectar (WAHA caido / todos los numeros desconectados) el aviso
 * no llegaria nunca. CallMeBot es una pasarela externa y gratuita.
 *
 * Alta (una sola vez, desde el movil que va a recibir los avisos):
 *   1. Guardar en la agenda el contacto +34 644 97 54 14
 *   2. Enviarle por WhatsApp el texto exacto:
 *        I allow callmebot to send me messages
 *   3. El bot responde con un APIKEY. Guardarlo en la variable de entorno
 *      CALLMEBOT_APIKEY (Railway, servicio del Hub, pestana Variables).
 *
 * Variables de entorno:
 *   CALLMEBOT_APIKEY      obligatoria. Si falta no se envia nada y solo se
 *                         deja un warning en el log (nunca rompe el cron).
 *   ALERT_WHATSAPP_PHONE  opcional. Por defecto +34680167881.
 */

const DEFAULT_ALERT_PHONE = "+34680167881";

export async function sendWhatsappAlert(text: string): Promise<boolean> {
  const apikey = process.env.CALLMEBOT_APIKEY;
  if (!apikey) {
    console.warn("[alert whatsapp] falta CALLMEBOT_APIKEY, aviso no enviado");
    return false;
  }
  const phone = process.env.ALERT_WHATSAPP_PHONE || DEFAULT_ALERT_PHONE;
  const url =
    "https://api.callmebot.com/whatsapp.php" +
    "?phone=" + encodeURIComponent(phone) +
    "&text=" + encodeURIComponent(text) +
    "&apikey=" + encodeURIComponent(apikey);
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) {
      console.warn("[alert whatsapp] respuesta HTTP " + resp.status);
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn("[alert whatsapp]:", (e as any)?.message ?? e);
    return false;
  }
}

