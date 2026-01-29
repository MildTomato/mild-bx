import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { spawn } from "child_process";
import { dirname, join } from "path";
import { createRequire } from "module";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "fs";
import { tmpdir } from "os";

const require = createRequire(import.meta.url);

// Priority order for schema files
const FILE_PRIORITY = {
  extensions: 1,
  types: 2,
  enums: 2,
  tables: 3,
  indexes: 4,
  functions: 5,
  triggers: 6,
  rls: 7,
  policies: 7,
  grants: 8,
};

function getFilePriority(fileName) {
  const name = fileName.replace(".sql", "").toLowerCase();
  return FILE_PRIORITY[name] ?? 50;
}

async function test() {
  console.log("Starting PGlite...");
  const db = await PGlite.create();
  // Keep dev database clean - Atlas requires this

  const port = 54321;
  const server = new PGLiteSocketServer({
    db,
    port,
    host: "127.0.0.1",
  });

  await server.start();
  console.log("PGlite listening on port", port);

  const devUrl = `postgres://postgres:postgres@127.0.0.1:${port}/template1?sslmode=disable&binary_parameters=yes`;
  const schemaDir =
    "/Users/jonathansummers-muir/Documents/GitHub/supabase/supabase-vscode-extension/examples/nextjs-demo/supabase/schema/public";

  // Read and order SQL files
  const files = readdirSync(schemaDir)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => getFilePriority(a) - getFilePriority(b));

  console.log("File order:", files);

  // Concatenate into temp file
  const tempDir = join(tmpdir(), `atlas-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  const combinedSql = files
    .map((f) => `-- File: ${f}\n${readFileSync(join(schemaDir, f), "utf-8")}`)
    .join("\n\n");

  writeFileSync(join(tempDir, "schema.sql"), combinedSql);
  console.log("Created temp schema file");

  // Find atlas binary
  const packagePath = dirname(require.resolve("@ariga/atlas/package.json"));
  const atlas = join(packagePath, "atlas");

  console.log("\n=== Testing Atlas with PGlite as dev database ===");
  console.log("Dev URL:", devUrl);
  console.log("Temp dir:", tempDir);
  console.log("");

  const child = spawn(
    atlas,
    [
      "schema",
      "inspect",
      "--url",
      `file://${tempDir}`,
      "--dev-url",
      devUrl,
      "--format",
      "{{ sql . }}",
    ],
    {
      stdio: "inherit",
    },
  );

  child.on("close", async (code) => {
    console.log("\n=== Atlas exited with code:", code, "===");
    rmSync(tempDir, { recursive: true, force: true });
    await server.stop();
    await db.close();
    process.exit(code || 0);
  });

  child.on("error", (err) => {
    console.error("Spawn error:", err);
  });
}

test().catch(console.error);
