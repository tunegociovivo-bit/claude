import { parseCommentThreadMessage } from "./comment-thread";

type ThreadJob = { id: string; status: string; text: string | null };

/** A stopped branch does not prevent independent approved messages from advancing. */
export function isStoppedThreadBranch(job: ThreadJob, jobs: readonly ThreadJob[], visited = new Set<string>()): boolean {
  if (["FAILED", "WAITING_USER", "CANCELLED", "REJECTED"].includes(job.status)) return true;
  if (job.status !== "QUEUED" || visited.has(job.id)) return false;
  visited.add(job.id);
  try {
    const message = parseCommentThreadMessage(job.text ?? "");
    const parent = jobs.find((item) => item.id === message.parentJobId);
    if (parent && isStoppedThreadBranch(parent, jobs, visited)) return true;
    const previous = jobs.find((item) => item.id === message.previousJobId);
    return Boolean(previous && isStoppedThreadBranch(previous, jobs, visited));
  } catch { return false; }
}
