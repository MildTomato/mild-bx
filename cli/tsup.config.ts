import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.tsx"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  shims: true,
  external: ["react", "react-devtools-core"],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
  async onSuccess() {
    // Add shebang to the output file
    const fs = await import("fs");
    const path = await import("path");
    const cliPath = path.join(process.cwd(), "dist", "cli.js");
    const content = fs.readFileSync(cliPath, "utf-8");
    if (!content.startsWith("#!/usr/bin/env node")) {
      fs.writeFileSync(cliPath, "#!/usr/bin/env node\n" + content);
    }
    fs.chmodSync(cliPath, 0o755);
  },
});
