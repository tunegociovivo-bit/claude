/**
 * Validador de configuración de secretos (FASE 1 · Punto 6).
 *
 * Función PURA y testeable que audita el estado de las variables de entorno
 * críticas para el cifrado del vault y la firma de sesiones, y produce una lista
 * de errores/avisos legibles. NO lanza: se usa para AVISAR al arrancar (y desde
 * un endpoint de diagnóstico si se quiere), no para tumbar el proceso.
 *
 * Reglas:
 *  - ERROR: no hay NINGUNA clave para el vault (ni SECRETS_ENC_KEY ni
 *    NEXTAUTH_SECRET) → encryptSecret/decryptSecret lanzarán.
 *  - WARN: el vault aún deriva su clave de NEXTAUTH_SECRET (SECRETS_ENC_KEY sin
 *    poner). Funciona, pero rotar NEXTAUTH_SECRET rompería el vault. Recomendación:
 *    poner SECRETS_ENC_KEY (= al NEXTAUTH_SECRET actual para migrar sin recifrar,
 *    o a un valor nuevo dejando que el descifrado tolerante lea lo antiguo).
 *  - WARN: NEXTAUTH_SECRET corto (<32 chars) → clave débil.
 */

export type SecretsConfigStatus = {
  ok: boolean; // false solo si hay ERRORES (no por warnings)
  usingDedicatedKey: boolean; // SECRETS_ENC_KEY presente
  vaultKeyShared: boolean; // el vault depende de NEXTAUTH_SECRET (no hay clave dedicada)
  errors: string[];
  warnings: string[];
};

export function checkSecretsConfig(
  env: NodeJS.ProcessEnv = process.env
): SecretsConfigStatus {
  const secretsEncKey = (env.SECRETS_ENC_KEY ?? "").trim();
  const nextauthSecret = (env.NEXTAUTH_SECRET ?? "").trim();

  const errors: string[] = [];
  const warnings: string[] = [];

  const hasDedicated = secretsEncKey.length > 0;
  const hasNextauth = nextauthSecret.length > 0;

  if (!hasDedicated && !hasNextauth) {
    errors.push(
      "No hay clave de cifrado del vault: define SECRETS_ENC_KEY (recomendado) o al menos NEXTAUTH_SECRET. El cifrado/descifrado de credenciales fallará."
    );
  }

  if (!hasDedicated && hasNextauth) {
    warnings.push(
      "SECRETS_ENC_KEY sin definir: el vault deriva su clave de NEXTAUTH_SECRET. Funciona, pero rotar NEXTAUTH_SECRET destruiría el vault. Define SECRETS_ENC_KEY para desacoplarlos (ver SECURITY-PHASE1.md)."
    );
  }

  if (hasDedicated && secretsEncKey.length < 32) {
    warnings.push("SECRETS_ENC_KEY es corta (<32 chars): usa una clave larga y aleatoria.");
  }

  if (hasNextauth && nextauthSecret.length < 32) {
    warnings.push("NEXTAUTH_SECRET es corto (<32 chars): usa un secreto largo y aleatorio.");
  }

  if (hasDedicated && hasNextauth && secretsEncKey === nextauthSecret) {
    warnings.push(
      "SECRETS_ENC_KEY == NEXTAUTH_SECRET: válido como paso de migración (cero recifrado), pero para aislarlos del todo dales valores distintos y re-cifra el vault."
    );
  }

  return {
    ok: errors.length === 0,
    usingDedicatedKey: hasDedicated,
    vaultKeyShared: !hasDedicated && hasNextauth,
    errors,
    warnings
  };
}

/** Aviso no-fatal al arrancar. Nunca lanza. */
export function logSecretsConfigWarnings(env: NodeJS.ProcessEnv = process.env): void {
  try {
    const s = checkSecretsConfig(env);
    for (const e of s.errors) console.error(`[config][secrets] ERROR: ${e}`);
    for (const w of s.warnings) console.warn(`[config][secrets] AVISO: ${w}`);
  } catch {
    // el validador jamás debe romper el arranque
  }
}
