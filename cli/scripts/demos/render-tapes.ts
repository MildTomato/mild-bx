#!/usr/bin/env tsx
/**
 * Render VHS tape files into videos
 *
 * Pipeline:
 *   1. Init tape always runs first (creates the demo project)
 *   2. Remaining tapes render in parallel (filter applies here only)
 *   3. Cleanup: delete demo projects created during recording
 *
 * Usage:
 *   pnpm demos:render                       # Render all tapes
 *   pnpm demos:render -- --filter bootstrap # Render only matching tapes (init still runs first)
 *   pnpm demos:render -- --dry-run          # Print what would render
 *   pnpm demos:render -- --concurrency 4    # Max parallel renders (default: 4)
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync, spawn } from "node:child_process";

const GENERATED_DIR = join(import.meta.dirname, "generated");

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const filterIdx = args.indexOf("--filter");
const filter = filterIdx >= 0 ? args[filterIdx + 1] : null;
const concurrencyIdx = args.indexOf("--concurrency");
const concurrency = concurrencyIdx >= 0 ? parseInt(args[concurrencyIdx + 1], 10) : 4;

// Find all .tape files (excluding config.tape)
const allTapes = readdirSync(GENERATED_DIR)
  .filter((f) => f.endsWith(".tape") && f !== "config.tape")
  .sort();

const initTape = "supa-init.tape";
const hasInit = allTapes.includes(initTape);

// Filter applies only to non-init tapes
const restTapes = allTapes
  .filter((f) => f !== initTape)
  .filter((f) => !filter || f.includes(filter));

const totalToRender = (hasInit ? 1 : 0) + restTapes.length;

if (totalToRender === 0) {
  console.log("No tape files found.");
  if (filter) console.log(`  (filter: "${filter}")`);
  process.exit(0);
}

console.log(`Rendering ${totalToRender} tape(s):`);
if (hasInit) console.log(`  ${initTape} (always runs first)`);
for (const f of restTapes) {
  console.log(`  ${f}`);
}
console.log("");

if (dryRun) {
  console.log("Dry run — no files rendered.");
  process.exit(0);
}

// Check that vhs is available
try {
  execSync("which vhs", { stdio: "ignore" });
} catch {
  console.error("Error: vhs is not installed or not in PATH.");
  console.error("Install it: https://github.com/charmbracelet/vhs");
  process.exit(1);
}

// Add cli/bin to PATH so `supa` command is available for VHS
const CLI_BIN = join(import.meta.dirname, "..", "..", "bin");

function renderTape(file: string): Promise<{ file: string; ok: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", `PATH="${CLI_BIN}:$PATH" vhs ${file}`], {
      cwd: GENERATED_DIR,
      stdio: "pipe",
      timeout: 180_000,
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log(`  ✓ ${file}`);
        resolve({ file, ok: true });
      } else {
        console.error(`  ✗ ${file} (exit ${code})`);
        resolve({ file, ok: false });
      }
    });

    child.on("error", (err) => {
      console.error(`  ✗ ${file} (${err.message})`);
      resolve({ file, ok: false });
    });
  });
}

async function renderBatch(files: string[], max: number): Promise<number> {
  let failed = 0;
  // Process in chunks of `max`
  for (let i = 0; i < files.length; i += max) {
    const batch = files.slice(i, i + max);
    console.log(`\nBatch ${Math.floor(i / max) + 1}: rendering ${batch.length} tape(s)...`);
    const results = await Promise.all(batch.map(renderTape));
    failed += results.filter((r) => !r.ok).length;
  }
  return failed;
}

function cleanupProjects(): void {
  console.log("\nPhase 3: Cleaning up demo projects...");
  try {
    const output = execSync(
      `PATH="${CLI_BIN}:$PATH" supa projects list --json`,
      { encoding: "utf-8", timeout: 30_000 },
    );
    const projects = JSON.parse(output) as Array<{ ref: string; name: string }>;
    const demoProjects = projects.filter((p) => p.name.includes("delete-me"));

    if (demoProjects.length === 0) {
      console.log("  No demo projects to clean up.");
      return;
    }

    for (const project of demoProjects) {
      try {
        execSync(
          `PATH="${CLI_BIN}:$PATH" supa projects delete ${project.ref} --yes`,
          { stdio: "pipe", timeout: 30_000 },
        );
        console.log(`  ✓ Deleted ${project.name} (${project.ref})`);
      } catch {
        console.error(`  ✗ Failed to delete ${project.name} (${project.ref})`);
      }
    }
  } catch (err) {
    console.error("  ✗ Cleanup failed:", err instanceof Error ? err.message : err);
  }
}

// ── Main ──────────────────────────────────────────────────────

let failed = 0;

// Phase 1: Init always runs first — creates the demo project
if (hasInit) {
  console.log("Phase 1: Rendering init tape (creates demo project)...");
  const result = await renderTape(initTape);
  if (!result.ok) {
    console.error("Init tape failed — aborting (other tapes depend on it).");
    process.exit(1);
  }
}

// Phase 2: Render the rest in parallel (filter applies here)
if (restTapes.length > 0) {
  console.log(`\nPhase 2: Rendering ${restTapes.length} tape(s) in parallel (concurrency: ${concurrency})...`);
  failed = await renderBatch(restTapes, concurrency);
}

// Phase 3: Delete demo projects
cleanupProjects();

console.log("");
console.log(`Rendered ${totalToRender - failed}/${totalToRender} tapes.`);

if (failed > 0) {
  console.error(`${failed} tape(s) failed.`);
  process.exit(1);
}
