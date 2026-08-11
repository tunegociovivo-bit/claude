import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
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

export function encryptedUsernameFile(credentialFile: string): string {
  return resolve(dirname(credentialFile), "santander-user.dpapi");
}

export function hasEncryptedUsername(credentialFile: string): boolean {
  return hasEncryptedCredential(encryptedUsernameFile(credentialFile));
}

export function readEncryptedUsername(credentialFile: string): string {
  const file = encryptedUsernameFile(credentialFile);
  if (!hasEncryptedCredential(file)) throw new Error("No existe un usuario de Santander cifrado en este PC.");
  const script = resolve(process.cwd(), "install", "read-bank-login.ps1");
  const value = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, file], {
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"]
  }).trim();
  if (!value || value.length > 80 || /\s|[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("El usuario local cifrado de Santander no es válido.");
  }
  return value;
}
