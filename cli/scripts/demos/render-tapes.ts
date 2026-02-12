#!/usr/bin/env tsx
/**
 * Render VHS tape files into videos
 *
 * Pipeline:
 *   1. supa-init--local (local init, creates recordings dir)
 *   2. Create .env in recordings dir
 *   3. supa-init (init with new project — config.json gets project_id)
 *   4. Rest of tapes in parallel (have project config + .env)
 *   5. supa-init--connect (connect to existing project)
 *   6. Cleanup: delete the project created in step 3
 *
 * Usage:
 *   pnpm demos:render                       # Render all tapes
 *   pnpm demos:render -- --filter bootstrap # Render only matching tapes (init tapes still run)
 *   pnpm demos:render -- --dry-run          # Print what would render
 *   pnpm demos:render -- --concurrency 4    # Max parallel renders (default: 4)
 */

import { readdirSync, writeFileSync } from "node:fs";
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

// Init tapes run sequentially in a specific order; everything else runs in parallel
const INIT_LOCAL = "supa-init--local.tape";
const INIT_LOCAL_TEMPLATE = "supa-init--local-template.tape";
const INIT_CONNECT = "supa-init--connect.tape";
const INIT_CREATE = "supa-init.tape"; // init--create is the main init tape

const initTapes = [INIT_LOCAL, INIT_LOCAL_TEMPLATE, INIT_CONNECT, INIT_CREATE].filter((f) => allTapes.includes(f));
const initSet = new Set(initTapes);

// Filter applies only to non-init tapes
const restTapes = allTapes
  .filter((f) => !initSet.has(f))
  .filter((f) => !filter || f.includes(filter));

const totalToRender = initTapes.length + restTapes.length;

if (totalToRender === 0) {
  console.log("No tape files found.");
  if (filter) console.log(`  (filter: "${filter}")`);
  process.exit(0);
}

console.log(`Rendering ${totalToRender} tape(s):`);
for (const f of initTapes) {
  console.log(`  ${f} (sequential)`);
}
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

const RECORDINGS_DIR = join(import.meta.dirname, "..", "..", "demos", "recordings");

function cleanupDemoProject(): void {
  console.log("\nStep 6: Cleaning up demo project...");
  try {
    const out = execSync(
      `PATH="${CLI_BIN}:$PATH" supa projects list --json`,
      { encoding: "utf-8", timeout: 30_000 },
    );
    const { projects } = JSON.parse(out);
    const demo = projects.find((p: { name: string }) => p.name.endsWith("-delete-me"));
    if (!demo) {
      console.log("  No demo project found.");
      return;
    }
    execSync(
      `PATH="${CLI_BIN}:$PATH" supa projects delete --project ${demo.ref} --yes --json`,
      { stdio: "pipe", timeout: 30_000 },
    );
    console.log(`  Deleted project ${demo.name} (${demo.ref})`);
  } catch (err) {
    console.error("  Cleanup failed:", err instanceof Error ? err.message : err);
  }
}

// ── Main ──────────────────────────────────────────────────────

let failed = 0;

// Step 1a: supa-init--local (creates recordings dir)
if (initSet.has(INIT_LOCAL)) {
  console.log("Step 1a: Rendering supa-init--local...");
  const result = await renderTape(INIT_LOCAL);
  if (!result.ok) {
    console.error("supa-init--local failed — aborting.");
    process.exit(1);
  }
}

// Step 1b: clean recordings dir, then supa-init--local-template
if (initSet.has(INIT_LOCAL_TEMPLATE)) {
  execSync(`rm -rf "${RECORDINGS_DIR}" && mkdir -p "${RECORDINGS_DIR}"`, { stdio: "pipe" });
  console.log("\nStep 1b: Rendering supa-init--local-template...");
  const result = await renderTape(INIT_LOCAL_TEMPLATE);
  if (!result.ok) failed++;
}

// Step 2: Clean recordings dir again, create .env so the CLI can write DB password during init
execSync(`rm -rf "${RECORDINGS_DIR}" && mkdir -p "${RECORDINGS_DIR}"`, { stdio: "pipe" });
console.log("\nStep 2: Creating .env in recordings dir...");
writeFileSync(join(RECORDINGS_DIR, ".env"), "");

// Step 3: supa-init (init with new project)
if (initSet.has(INIT_CREATE)) {
  console.log("\nStep 3: Rendering supa-init...");
  const result = await renderTape(INIT_CREATE);
  if (!result.ok) {
    console.error("supa-init failed — aborting.");
    process.exit(1);
  }
}

// Step 4: Rest of tapes in parallel (recordings dir has project config + .env)
if (restTapes.length > 0) {
  console.log(`\nStep 4: Rendering ${restTapes.length} tape(s) in parallel (concurrency: ${concurrency})...`);
  failed = await renderBatch(restTapes, concurrency);
}

// Step 5: supa-init--connect (connects to existing project)
if (initSet.has(INIT_CONNECT)) {
  console.log("\nStep 5: Rendering supa-init--connect...");
  const result = await renderTape(INIT_CONNECT);
  if (!result.ok) failed++;
}

// Step 6: Cleanup — delete the project created in step 3
cleanupDemoProject();

console.log("");
console.log(`Rendered ${totalToRender - failed}/${totalToRender} tapes.`);

if (failed > 0) {
  console.error(`${failed} tape(s) failed.`);
  process.exit(1);
}
