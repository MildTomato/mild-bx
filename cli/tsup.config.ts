import { defineConfig } from "tsup";
import { config as loadEnv } from "dotenv";

const envFile = process.env.BUILD_TARGET === "local" ? ".env.local" : ".env.prod";
const { parsed: envVars = {} } = loadEnv({ path: envFile });

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  shims: true,
  external: ["react", "react-devtools-core", "@electric-sql/pglite", "@electric-sql/pglite-socket"],
  esbuildOptions(options) {
    options.jsx = "automatic";
    options.define = Object.fromEntries(
      Object.entries(envVars).map(([k, v]) => [`process.env.${k}`, JSON.stringify(v)])
    );
    // Path aliases (esbuild resolves these at build time)
    options.alias = {
      "@/lib": "./src/lib",
      "@/components": "./src/components",
      "@/commands": "./src/commands",
      "@/util": "./src/util",
    };
  },
  async onSuccess() {
    // Add shebang to CLI output files
    const fs = await import("fs");
    const path = await import("path");

    // Process entry point
    for (const file of ["index.js"]) {
      const cliPath = path.join(process.cwd(), "dist", file);
      if (fs.existsSync(cliPath)) {
        const content = fs.readFileSync(cliPath, "utf-8");
        if (!content.startsWith("#!/usr/bin/env node")) {
          fs.writeFileSync(cliPath, "#!/usr/bin/env node\n" + content);
        }
        fs.chmodSync(cliPath, 0o755);
      }
    }
  },
});
