import { resolveScoped } from "./env-scoping.js";
import { SENTINEL_KEYS } from "./sentinels.js";

export interface BranchVarSet {
  branchRef: string;
  gitBranch: string;
  vars: Array<{ name: string; value: string }>;
}

export function buildPropagationPlan(
  allVars: Array<{ name: string; value: string }>,
  branches: Array<{ project_ref: string; git_branch: string }>,
): BranchVarSet[] {
  return branches.map((branch) => {
    const resolved = resolveScoped(allVars, { type: "preview", branch: branch.git_branch });
    const vars: Array<{ name: string; value: string }> = [];
    for (const [name, value] of resolved) {
      if (!SENTINEL_KEYS.has(name)) {
        vars.push({ name, value });
      }
    }
    return { branchRef: branch.project_ref, gitBranch: branch.git_branch, vars };
  });
}
