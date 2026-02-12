/**
 * Template fetching and download utilities for bootstrap command
 *
 * Fetches starter templates from supabase-community/supabase-samples,
 * parses GitHub URLs, and downloads + extracts template tarballs.
 */

import { exec } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface StarterTemplate {
  name: string;
  description: string;
  url: string; // GitHub URL: "https://github.com/org/repo/tree/ref/path"
  start: string; // Start command: "npm ci && npm run dev"
}

interface SamplesRepo {
  samples: StarterTemplate[];
}

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  ref: string;
  subpath: string;
}

const SAMPLES_URL =
  "https://raw.githubusercontent.com/supabase-community/supabase-samples/main/samples.json";

// ─────────────────────────────────────────────────────────────
// Functions
// ─────────────────────────────────────────────────────────────

/**
 * Fetch the list of starter templates from supabase-community/supabase-samples
 */
export async function fetchTemplates(): Promise<StarterTemplate[]> {
  const response = await fetch(SAMPLES_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch templates: ${response.status} ${response.statusText}`,
    );
  }
  const data = (await response.json()) as SamplesRepo;
  return data.samples;
}

/**
 * Parse a GitHub URL into its component parts
 *
 * Handles URLs like:
 *   https://github.com/supabase/supabase/tree/master/examples/user-management/nextjs-user-management
 *
 * Returns { owner: "supabase", repo: "supabase", ref: "master", subpath: "examples/user-management/nextjs-user-management" }
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  // parts: [owner, repo, "tree", ref, ...subpath]
  if (parts.length < 4) {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }
  const owner = parts[0]!;
  const repo = parts[1]!;
  // parts[2] is "tree" or "blob"
  const ref = parts[3]!;
  const subpath = parts.slice(4).join("/");

  return { owner, repo, ref, subpath };
}

/**
 * Download a template from GitHub and extract it to the target directory.
 *
 * Streams the tarball via curl piped into tar so we never buffer the entire
 * monorepo archive in memory. Only extracts the files under the template's
 * subpath.
 */
export async function downloadTemplate(
  template: StarterTemplate,
  targetDir: string,
): Promise<void> {
  const { owner, repo, ref, subpath } = parseGitHubUrl(template.url);

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  // Strip count: 1 for the top-level dir (e.g. "owner-repo-sha/") + depth of subpath
  const subpathDepth = subpath ? subpath.split("/").filter(Boolean).length : 0;
  const stripCount = 1 + subpathDepth;

  // Build a wildcard to only extract files under the subpath.
  // GitHub tarballs have a top-level dir like "owner-repo-sha/" which we
  // match with "*/" (single-component wildcard).
  const includePattern = subpath ? `*/${subpath}/*` : "*";

  const tarballUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`;

  // Stream download directly into tar — no buffering in memory
  await execAsync(
    `curl -sL -H "Accept: application/vnd.github+json" "${tarballUrl}" | tar xzf - --strip-components=${stripCount} -C "${targetDir}" --include="${includePattern}"`,
    { timeout: 120_000 },
  );
}
