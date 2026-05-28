/**
 * Auth v1 del panel del negocio Bipi.
 *
 * El token que el negocio guarda en localStorage tras login tiene la
 * forma `Bearer <businessId>:<random>`. En v1 confiamos en que el token
 * contiene el id correcto (mismo modelo que profile/purchases.csv). No
 * sustituye a una sesión real, pero exige conocer el businessId y evita
 * que los endpoints queden totalmente abiertos al excluirlos del
 * middleware de NextAuth.
 */

export function businessTokenAllows(token: string | null, businessId: string): boolean {
  if (!token) return false;
  const m = /^Bearer\s+([\w-]+):/.exec(token);
  return !!m && m[1] === businessId;
}
