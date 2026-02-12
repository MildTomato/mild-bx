/**
 * Project health checking utilities
 *
 * Polls project service health (db, pooler) until ready or timeout.
 * Used by bootstrap, init, and other commands that need to wait for
 * a project to become operational after creation.
 */

import type { createClient } from "@/lib/api.js";

export interface WaitForProjectReadyOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  onProgress?: (message: string) => void;
}

/**
 * Wait for project services (db, pooler) to be healthy.
 * Polls every 2s by default, times out after 3 minutes.
 *
 * @throws Error if the project doesn't become ready within the timeout.
 */
export async function waitForProjectReady(
  client: ReturnType<typeof createClient>,
  projectRef: string,
  options?: WaitForProjectReadyOptions,
): Promise<void> {
  const maxWaitMs = options?.timeoutMs ?? 180_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 2_000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const health = await client.getProjectHealth(projectRef, [
        "db",
        "pooler",
      ]);
      const dbHealth = health.find(
        (h: { name: string; status: string }) => h.name === "db",
      );
      const poolerHealth = health.find(
        (h: { name: string; status: string }) => h.name === "pooler",
      );

      if (
        dbHealth?.status === "ACTIVE_HEALTHY" &&
        poolerHealth?.status === "ACTIVE_HEALTHY"
      ) {
        return;
      }

      const statuses: string[] = [];
      if (dbHealth) statuses.push(`db: ${dbHealth.status}`);
      if (poolerHealth) statuses.push(`pooler: ${poolerHealth.status}`);
      options?.onProgress?.(
        `Waiting for project... (${statuses.join(", ") || "checking"})`,
      );
    } catch {
      options?.onProgress?.("Waiting for project...");
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(
    "Timed out waiting for project to be ready (3 minutes). Check the dashboard for status.",
  );
}
