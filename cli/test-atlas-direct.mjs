import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { spawn } from "child_process";
import { dirname, join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

async function test() {
  console.log("Starting PGlite...");
  const db = await PGlite.create();

  const port = 54321;
  const server = new PGLiteSocketServer({
    db,
    port,
    host: "127.0.0.1",
  });

  await server.start();
  console.log("PGlite listening on port", port);

  const devUrl = `postgres://postgres:postgres@127.0.0.1:${port}/template1?sslmode=disable&binary_parameters=yes`;
  const targetUrl = `postgresql://postgres.dumltzfoaxseaekszcnt:${process.env.SUPABASE_DB_PASSWORD}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`;
  const schemaDir =
    "/Users/jonathansummers-muir/Documents/GitHub/supabase/supabase-vscode-extension/examples/nextjs-demo/supabase/schema/public";

  // Find atlas binary
  const packagePath = dirname(require.resolve("@ariga/atlas/package.json"));
  const atlas = join(packagePath, "atlas");

  console.log("Running Atlas...");
  console.log("  Atlas binary:", atlas);
  console.log("  Target:", targetUrl.replace(/:([^@]+)@/, ":***@"));
  console.log("  Dev URL:", devUrl);
  console.log("  Schema dir:", schemaDir);

  const child = spawn(
    atlas,
    [
      "schema",
      "apply",
      "--url",
      targetUrl,
      "--to",
      `file://${schemaDir}`,
      "--dev-url",
      devUrl,
      "--dry-run",
    ],
    {
      stdio: "inherit", // Show all output in real-time
    },
  );

  child.on("close", async (code) => {
    console.log("\nAtlas exited with code:", code);
    await server.stop();
    await db.close();
    process.exit(code || 0);
  });

  child.on("error", (err) => {
    console.error("Spawn error:", err);
  });
}

test().catch(console.error);
