import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function existingInstanceBlocksStart(existingPid: number, currentPid: number, isRunning: boolean): boolean {
  return Number.isInteger(existingPid) && existingPid > 0 && existingPid !== currentPid && isRunning;
}

function pidIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code !== "ESRCH";
  }
}

export type InstanceLock = { release: () => void };

export function acquireSingleInstance(lockPath: string): InstanceLock | null {
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, String(process.pid), "utf8");
      return {
        release: () => {
          try { closeSync(fd); } catch { /* ignore */ }
          try {
            if (Number(readFileSync(lockPath, "utf8")) === process.pid) unlinkSync(lockPath);
          } catch { /* ignore */ }
        }
      };
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      let existingPid = 0;
      try { existingPid = Number(readFileSync(lockPath, "utf8").trim()); } catch { /* stale */ }
      if (existingInstanceBlocksStart(existingPid, process.pid, pidIsRunning(existingPid))) return null;
      try { unlinkSync(lockPath); } catch { return null; }
    }
  }
  return null;
}
