const TOKEN_ACCESS_ERROR =
  /unsupported get request|missing permissions?|has not grant(?:ed)? (?:ads_management|ads_read)|does not exist|invalid oauth|oauth(?:access)?token|error validating access token|session has expired|\"code\"\s*:\s*190/i;

/** Rotate only when the credential cannot access the requested Meta object. */
export async function tryMetaTokenCandidates<T>(
  candidates: Array<string | null | undefined>,
  request: (token: string) => Promise<T>
): Promise<T> {
  const tokens = [...new Set(candidates.map((token) => token?.trim()).filter(Boolean))] as string[];
  if (tokens.length === 0) throw new Error("No hay ningún token de Meta configurado");

  let lastAccessError: unknown;
  for (const token of tokens) {
    try {
      return await request(token);
    } catch (error) {
      const message = String((error as any)?.message ?? error);
      if (!TOKEN_ACCESS_ERROR.test(message)) throw error;
      lastAccessError = error;
    }
  }
  throw lastAccessError ?? new Error("Ninguna conexión de Meta tiene acceso al recurso solicitado");
}
