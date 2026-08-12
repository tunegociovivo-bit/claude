export type LoginDestination = "crm" | "admin";

export function loginDestination(mode: LoginDestination, isOperator: boolean) {
  return mode === "admin" && isOperator ? "/admin" : "/pipeline";
}
