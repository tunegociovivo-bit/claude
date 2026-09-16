export const DEFAULT_ANDROID_UNLOCK_PIN = "1608";
export function resolveAndroidUnlockPin(value: string): string {
 const pin=value.trim() || DEFAULT_ANDROID_UNLOCK_PIN;
 if(!/^[0-9]{4,16}$/.test(pin)) throw new Error('Introduce entre 4 y 16 números, o deja el campo vacío.');
 return pin;
}
