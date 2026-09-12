import type { MobileAutomationAction } from "@/lib/mobile/automation-policy";

export type MobileAutomationExecutableJob = {
  action: MobileAutomationAction;
  targetUrl: string | null;
  text: string | null;
};

export type MobileAutomationExecutorDependencies = {
  openUrl: (url: string) => Promise<unknown>;
  copyText: (text: string) => Promise<unknown>;
};

export async function executeMobileAutomationJob(
  job: MobileAutomationExecutableJob,
  dependencies: MobileAutomationExecutorDependencies
): Promise<void> {
  switch (job.action) {
    case "OPEN_URL":
      if (!job.targetUrl) throw new Error("El trabajo aprobado no contiene una URL.");
      await dependencies.openUrl(job.targetUrl);
      return;
    case "COPY_TEXT":
      if (!job.text) throw new Error("El trabajo aprobado no contiene texto.");
      await dependencies.copyText(job.text);
      return;
    case "OPEN_URL_AND_COPY_TEXT":
      if (!job.targetUrl) throw new Error("El trabajo aprobado no contiene una URL.");
      if (!job.text) throw new Error("El trabajo aprobado no contiene texto.");
      await dependencies.openUrl(job.targetUrl);
      await dependencies.copyText(job.text);
      return;
    default:
      throw new Error("Acción móvil no permitida.");
  }
}

