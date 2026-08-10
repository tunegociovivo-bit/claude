import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { validateAccessKey } from "./santander/login.js";

export function hasEncryptedCredential(file: string): boolean {
  return Boolean(file) && existsSync(file);
}

export function readEncryptedAccessKey(file: string): string {
  if (!hasEncryptedCredential(file)) throw new Error("No existe una clave de acceso cifrada en este PC.");
  const script = resolve(process.cwd(), "install", "read-bank-login.ps1");
  const value = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, file], {
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"]
  }).trim();
  return validateAccessKey(value);
}
