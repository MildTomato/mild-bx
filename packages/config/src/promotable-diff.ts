/**
 * Diff two remote config objects, returning only fields that are promotable.
 *
 * Used by both CLI (`supa project branches diff/merge`) and Studio to show
 * which config changes on a branch would be applied to production on merge.
 *
 * `section` is the config-field-meta prefix — e.g. "auth" or "api" —
 * so `mailer_autoconfirm` is looked up as `auth.mailer_autoconfirm`.
 */

import { getFieldMeta } from "./config-field-meta.js";

export interface PromotableConfigChange {
  key: string;
  from: unknown;
  to: unknown;
}

export function diffPromotableConfig(
  branchConfig: Record<string, unknown>,
  prodConfig: Record<string, unknown>,
  section: string,
): PromotableConfigChange[] {
  const changes: PromotableConfigChange[] = [];
  const allKeys = new Set([...Object.keys(branchConfig), ...Object.keys(prodConfig)]);

  for (const key of allKeys) {
    const meta = getFieldMeta(`${section}.${key}`);
    if (!meta.promotable) continue;

    const from = prodConfig[key];
    const to = branchConfig[key];

    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes.push({ key, from, to });
    }
  }

  return changes;
}
