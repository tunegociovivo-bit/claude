/** Legacy mode names remain compatible; authentication always fails closed. */
export type BubuiAuthMode = "lazy" | "shadow" | "strict";
export function customerAuthMode(_env: NodeJS.ProcessEnv = process.env): BubuiAuthMode { return "strict"; }
export function businessAuthMode(_env: NodeJS.ProcessEnv = process.env): BubuiAuthMode { return "strict"; }
export function decideNoToken(_mode: BubuiAuthMode): { allow: boolean; log: boolean } { return { allow: false, log: false }; }
