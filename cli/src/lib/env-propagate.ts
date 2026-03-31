import { createClient } from "@/lib/api.js";
import { listRemoteVariables, isPlatformVariable, bulkPushVariables } from "@/lib/env-api-bridge.js";
import { buildPropagationPlan, type BranchVarSet } from "@supabase-dx/env-vars";

const HEALTHY_STATUS = "ACTIVE_HEALTHY";

export async function executePropagationPlan(
  client: ReturnType<typeof createClient>,
  plan: BranchVarSet[],
): Promise<{ propagated: number; errors: string[] }> {
  const errors: string[] = [];
  let propagated = 0;

  // Process in batches of 5
  for (let i = 0; i < plan.length; i += 5) {
    const batch = plan.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async ({ branchRef, vars }) => {
        const nonPlatform = vars.filter((v) => !isPlatformVariable(v.name));
        const platform = vars.filter((v) => isPlatformVariable(v.name));

        if (nonPlatform.length > 0) {
          await client.createSecrets(branchRef, nonPlatform);
        }
        if (platform.length > 0) {
          await bulkPushVariables(
            branchRef,
            platform.map((v) => ({ key: v.name, value: v.value, secret: false })),
            {},
          );
        }
      })
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled") {
        propagated++;
      } else {
        errors.push(`${batch[j].gitBranch}: ${result.reason}`);
      }
    }
  }

  return { propagated, errors };
}

export async function propagateToPreviewBranches(options: {
  client: ReturnType<typeof createClient>;
  projectRef: string;
}): Promise<{ propagated: number; skipped: number; errors: string[] }> {
  const { client, projectRef } = options;

  const [allVars, branches] = await Promise.all([
    listRemoteVariables(projectRef),
    client.listBranches(projectRef),
  ]);

  // Only ephemeral (non-persistent) healthy branches
  const targets = branches.filter(
    (b) => b.preview_project_status === HEALTHY_STATUS && b.project_ref && b.persistent !== true
  );

  if (targets.length === 0) {
    return { propagated: 0, skipped: branches.length, errors: [] };
  }

  const plan = buildPropagationPlan(
    allVars.map((v) => ({ name: v.key, value: v.value ?? "" })),
    targets.map((b) => ({ project_ref: b.project_ref!, git_branch: b.git_branch ?? "" })),
  );

  const { propagated, errors } = await executePropagationPlan(client, plan);
  return { propagated, skipped: branches.length - targets.length, errors };
}
