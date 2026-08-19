export type JobsInboxFailure = { code: string; message: string };

export function describeJobsInboxFailure(error: { authenticationFailed?: boolean; message?: string } | null | undefined): JobsInboxFailure {
  if (error?.authenticationFailed || /auth|login|credential/i.test(error?.message ?? "")) {
    return {
      code: "gmail_auth_rejected",
      message: "Google ha rechazado la credencial del buzón. Vuelve a conectar la cuenta de Google; las alertas automáticas quedan detenidas hasta recuperar el acceso."
    };
  }
  if (/timeout|tiempo de espera/i.test(error?.message ?? "")) {
    return { code: "gmail_timeout", message: "Google no respondió a tiempo. El Hub volverá a intentarlo automáticamente en la siguiente revisión." };
  }
  return { code: "gmail_unavailable", message: "No se pudo revisar el buzón de empleo. El Hub volverá a intentarlo automáticamente y conservará las alertas sin procesar." };
}
