import { createClient } from "@/lib/api.js";
import { createSpinner } from "@/components/output.js";
import { verboseLog } from "@/lib/styles.js";

export const MAX_POLLS = 60; // 5 minutes at 5s intervals
export const INTERVAL_MS = 5000;

export const HEALTHY_STATUSES = new Set(["ACTIVE_HEALTHY"]);
export const FAILED_STATUSES = new Set([
  "ACTIVE_UNHEALTHY",
  "INIT_FAILED",
  "REMOVED",
  "RESTORE_FAILED",
  "PAUSE_FAILED",
]);
export const BRANCH_FAILED = new Set(["MIGRATIONS_FAILED", "FUNCTIONS_FAILED"]);

/**
 * Poll until the branch's preview_project_status is healthy (or a terminal failure state).
 * Returns true if healthy, false if failed/timed out.
 */
export async function pollBranchUntilHealthy(
  branchRef: string,
  parentProjectRef: string,
  authToken: string,
  spinner: ReturnType<typeof createSpinner>,
  verbose = false,
): Promise<boolean> {
  const client = createClient(authToken);

  const log = (msg: string) => verbose && process.stderr.write(verboseLog(msg) + "\n");

  log(`[poll] starting — branchRef=${branchRef} parentProjectRef=${parentProjectRef}`);

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, INTERVAL_MS));

    try {
      const branches = await client.listBranches(parentProjectRef);
      log(`[poll] listed ${branches.length} branches`);

      const branch = branches.find((b) => b.project_ref === branchRef);
      log(`[poll] match=${branch ? branch.project_ref : "none"} status=${branch?.status} projectStatus=${branch?.preview_project_status}`);

      if (!branch) return false;

      const branchStatus = branch.status;
      const projectStatus = branch.preview_project_status;

      spinner.message(`Waiting for branch to become healthy… (${branchStatus})`);

      if (BRANCH_FAILED.has(branchStatus)) return false;

      if (projectStatus) {
        if (HEALTHY_STATUSES.has(projectStatus)) return true;
        if (FAILED_STATUSES.has(projectStatus)) return false;
      }
    } catch (err) {
      log(`[poll] error — ${err instanceof Error ? err.message : String(err)}`);
      // Network hiccup — keep polling
    }
  }

  return false; // timed out
}
