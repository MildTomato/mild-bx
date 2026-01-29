/**
 * Git utilities
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Get the current git branch name
 */
export function getCurrentBranch(dir: string): string | null {
  // Try reading .git/HEAD directly first (faster)
  const headPath = join(dir, ".git", "HEAD");

  if (existsSync(headPath)) {
    try {
      const content = readFileSync(headPath, "utf-8").trim();

      // Format: "ref: refs/heads/branch-name"
      if (content.startsWith("ref: refs/heads/")) {
        return content.replace("ref: refs/heads/", "");
      }

      // Detached HEAD - return short SHA
      return content.slice(0, 7);
    } catch {
      // Fall through to git command
    }
  }

  // Fall back to git command
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    return branch;
  } catch {
    return null;
  }
}

/**
 * Check if directory is a git repository
 */
export function isGitRepo(dir: string): boolean {
  const gitDir = join(dir, ".git");
  return existsSync(gitDir);
}

/**
 * Get the git repository root
 */
export function getRepoRoot(dir: string): string | null {
  try {
    const root = execSync("git rev-parse --show-toplevel", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    return root;
  } catch {
    return null;
  }
}

/**
 * Get the remote origin URL
 */
export function getRemoteUrl(dir: string): string | null {
  try {
    const url = execSync("git remote get-url origin", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    return url;
  } catch {
    return null;
  }
}

/**
 * Check for uncommitted changes
 */
export function hasUncommittedChanges(dir: string): boolean {
  try {
    const status = execSync("git status --porcelain", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    return status.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get the current HEAD commit SHA
 */
export function getHeadCommit(dir: string): string | null {
  try {
    const sha = execSync("git rev-parse HEAD", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    return sha;
  } catch {
    return null;
  }
}
