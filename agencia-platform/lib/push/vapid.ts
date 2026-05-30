/**
 * Claves VAPID compartidas para Web Push (Hub + Bubui).
 *
 * Se leen de variables de entorno; si no existen, caemos a unas claves
 * generadas y bundleadas en el repo. Esto permite que el push funcione
 * en deploys donde aún no se han configurado los env vars (caso actual
 * de Bubui en Railway). Cuando se quiera rotar la clave o esconderla,
 * basta con definir las env vars correspondientes y reiniciar.
 *
 * Si rotas estas claves, las suscripciones push existentes dejarán de
 * funcionar y los usuarios tendrán que volver a aceptar las
 * notificaciones la próxima vez que abran la app/web.
 */

const FALLBACK_VAPID_PUBLIC =
  "BAuVURW8JqqrJNEzLrG9B772HZ7fb7-k5bXVJgiMrSnamSyEr1RU9h5QjYibJCmRG_xtIwhBfqbkGNSnfuUYWv8";
const FALLBACK_VAPID_PRIVATE = "weQh_jTllBBYqH7kVhnl1sgVUhrj7NgkxBZu8bIWwv4";
const FALLBACK_VAPID_EMAIL = "tunegociovivo@gmail.com";

export function getVapidConfig(): {
  publicKey: string;
  privateKey: string;
  contactEmail: string;
} {
  return {
    publicKey: process.env.VAPID_PUBLIC_KEY || FALLBACK_VAPID_PUBLIC,
    privateKey: process.env.VAPID_PRIVATE_KEY || FALLBACK_VAPID_PRIVATE,
    contactEmail: process.env.VAPID_CONTACT_EMAIL || FALLBACK_VAPID_EMAIL
  };
}

// Con los fallbacks, push está siempre habilitado. Esta función queda
// por compatibilidad — devuelve true salvo que alguien defina las env
// vars con strings vacíos a propósito.
export function isVapidConfigured(): boolean {
  const c = getVapidConfig();
  return Boolean(c.publicKey && c.privateKey && c.contactEmail);
}
