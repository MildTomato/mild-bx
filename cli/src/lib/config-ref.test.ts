import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseConfigRef,
  isConfigRef,
  makeEnvRef,
  makeSecretRef,
  detectHardcodedSecrets,
  detectMissingSecrets,
  stripHardcodedSecrets,
} from "./config-ref.js";
import type { ProjectConfig } from "./config-types.js";

// ---------------------------------------------------------------------------
// parseConfigRef / isConfigRef / makeEnvRef / makeSecretRef
// ---------------------------------------------------------------------------

describe("parseConfigRef", () => {
  it("parses env(VAR)", () => {
    expect(parseConfigRef("env(MY_VAR)")).toEqual({ type: "env", varName: "MY_VAR" });
  });

  it("parses secret(VAR)", () => {
    expect(parseConfigRef("secret(MY_SECRET)")).toEqual({ type: "secret", varName: "MY_SECRET" });
  });

  it("returns null for raw values", () => {
    expect(parseConfigRef("raw-string")).toBeNull();
    expect(parseConfigRef(42)).toBeNull();
    expect(parseConfigRef(null)).toBeNull();
  });

  it("returns null for partial matches", () => {
    expect(parseConfigRef("env()")).toBeNull(); // empty var name
    expect(parseConfigRef("ENV(VAR)")).toBeNull(); // wrong case
  });
});

describe("isConfigRef", () => {
  it("returns true for env() and secret() refs", () => {
    expect(isConfigRef("env(FOO)")).toBe(true);
    expect(isConfigRef("secret(BAR)")).toBe(true);
  });

  it("returns false for raw values", () => {
    expect(isConfigRef("raw-value")).toBe(false);
    expect(isConfigRef("")).toBe(false);
  });
});

describe("makeEnvRef / makeSecretRef", () => {
  it("produces the correct syntax", () => {
    expect(makeEnvRef("MY_VAR")).toBe("env(MY_VAR)");
    expect(makeSecretRef("MY_SECRET")).toBe("secret(MY_SECRET)");
  });
});

// ---------------------------------------------------------------------------
// detectHardcodedSecrets
// ---------------------------------------------------------------------------

describe("detectHardcodedSecrets", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `config-ref-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects raw secret values in a config file", () => {
    const config = {
      auth: {
        external: {
          github: {
            enabled: true,
            client_id: "env(SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID)",
            secret: "raw-github-secret", // hardcoded — should be detected
          },
        },
      },
    };
    writeFileSync(join(tmpDir, "config.json"), JSON.stringify(config, null, 2));

    const results = detectHardcodedSecrets(tmpDir, ["config.json"]);
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe("auth.external.github.secret");
    expect(results[0].file).toBe("supabase/config.json");
    expect(results[0].line).toBeGreaterThan(0);
  });

  it("does not flag env() refs as hardcoded secrets", () => {
    const config = {
      auth: {
        external: {
          github: {
            enabled: true,
            client_id: "env(SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID)",
            secret: "env(SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET)",
          },
        },
      },
    };
    writeFileSync(join(tmpDir, "config.json"), JSON.stringify(config, null, 2));

    const results = detectHardcodedSecrets(tmpDir, ["config.json"]);
    expect(results).toHaveLength(0);
  });

  it("does not flag secret() refs as hardcoded secrets", () => {
    const config = {
      auth: {
        external: {
          github: {
            enabled: true,
            client_id: "env(SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID)",
            secret: "secret(SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET)",
          },
        },
      },
    };
    writeFileSync(join(tmpDir, "config.json"), JSON.stringify(config, null, 2));

    const results = detectHardcodedSecrets(tmpDir, ["config.json"]);
    expect(results).toHaveLength(0);
  });

  it("scans multiple layers and returns all hits", () => {
    const base = { auth: { external: { github: { enabled: true, secret: "raw-base-secret" } } } };
    const overlay = { auth: { external: { github: { secret: "raw-overlay-secret" } } } };
    writeFileSync(join(tmpDir, "config.json"), JSON.stringify(base, null, 2));
    writeFileSync(join(tmpDir, "config.preview.json"), JSON.stringify(overlay, null, 2));

    const results = detectHardcodedSecrets(tmpDir, ["config.json", "config.preview.json"]);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.file)).toContain("supabase/config.json");
    expect(results.map((r) => r.file)).toContain("supabase/config.preview.json");
  });

  it("silently skips missing files (graceful degradation)", () => {
    const results = detectHardcodedSecrets(tmpDir, ["nonexistent.json"]);
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// detectMissingSecrets
// ---------------------------------------------------------------------------

describe("detectMissingSecrets", () => {
  function makeConfig(overrides: Record<string, unknown> = {}): ProjectConfig {
    return {
      auth: {
        external: {
          github: {
            enabled: true,
            client_id: "env(SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID)",
            secret: "env(SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET)",
            ...overrides,
          },
        },
      },
    } as unknown as ProjectConfig;
  }

  it("returns empty when all env refs are resolvable", () => {
    const config = makeConfig();
    const lookup = (key: string) =>
      key === "SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET" ||
      key === "SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID"
        ? "some-value"
        : undefined;

    const results = detectMissingSecrets(config, lookup);
    const githubResults = results.filter((r) => r.path.includes("github.secret"));
    expect(githubResults).toHaveLength(0);
  });

  it("flags missing env var for secret field", () => {
    const config = makeConfig();
    const lookup = () => undefined; // nothing is set

    const results = detectMissingSecrets(config, lookup);
    const secret = results.find((r) => r.path === "auth.external.github.secret");
    expect(secret).toBeDefined();
    expect(secret?.envVarName).toBe("SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET");
  });

  it("does not check secrets for disabled providers", () => {
    const config = {
      auth: {
        external: {
          github: { enabled: false, secret: "" }, // disabled — secrets not required
        },
      },
    } as unknown as ProjectConfig;

    const results = detectMissingSecrets(config, () => undefined);
    const githubResults = results.filter((r) => r.path.includes("github"));
    expect(githubResults).toHaveLength(0);
  });

  it("uses schema default ref when secret field is absent", () => {
    const config = {
      auth: {
        external: {
          github: { enabled: true, client_id: "env(SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID)" },
          // secret field is absent — schema default is env(SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET)
        },
      },
    } as unknown as ProjectConfig;

    const results = detectMissingSecrets(config, () => undefined);
    const secret = results.find((r) => r.path === "auth.external.github.secret");
    expect(secret).toBeDefined();
    expect(secret?.envVarName).toBe("SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET");
  });
});

// ---------------------------------------------------------------------------
// stripHardcodedSecrets
// ---------------------------------------------------------------------------

describe("stripHardcodedSecrets", () => {
  it("removes secret fields with raw values", () => {
    const config = {
      auth: {
        external: {
          github: {
            enabled: true,
            client_id: "env(SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID)",
            secret: "raw-github-secret",
          },
        },
      },
    } as unknown as ProjectConfig;

    const stripped = stripHardcodedSecrets(config);
    const github = (stripped as Record<string, unknown> & { auth: { external: { github: Record<string, unknown> } } })
      .auth?.external?.github;
    expect(github?.secret).toBeUndefined();
    expect(github?.client_id).toBe("env(SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID)");
    expect(github?.enabled).toBe(true);
  });

  it("does not remove env() or secret() refs", () => {
    const config = {
      auth: {
        external: {
          github: {
            enabled: true,
            client_id: "env(SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID)",
            secret: "env(SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET)",
          },
        },
      },
    } as unknown as ProjectConfig;

    const stripped = stripHardcodedSecrets(config);
    const github = (stripped as Record<string, unknown> & { auth: { external: { github: Record<string, unknown> } } })
      .auth?.external?.github;
    expect(github?.secret).toBe("env(SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET)");
  });

  it("does not mutate the original config", () => {
    const config = {
      auth: {
        external: {
          github: { enabled: true, secret: "raw-secret" },
        },
      },
    } as unknown as ProjectConfig;

    stripHardcodedSecrets(config);
    const github = (config as Record<string, unknown> & { auth: { external: { github: Record<string, unknown> } } })
      .auth?.external?.github;
    expect(github?.secret).toBe("raw-secret"); // original unchanged
  });

  it("returns config unchanged when no hardcoded secrets exist", () => {
    const config = {
      auth: { external: { github: { enabled: true, secret: "env(SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET)" } } },
    } as unknown as ProjectConfig;

    const stripped = stripHardcodedSecrets(config);
    expect(stripped).toBe(config); // same reference (no copy needed)
  });
});

// ---------------------------------------------------------------------------
// Double-jeopardy regression: hardcoded secrets should not be re-flagged as missing
// ---------------------------------------------------------------------------

describe("double-jeopardy: hardcoded secret stripped then flagged as missing", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `config-ref-dj-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not double-flag hardcoded secrets as missing after strip", () => {
    const config = {
      auth: {
        external: {
          github: {
            enabled: true,
            client_id: "env(SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID)",
            secret: "raw-github-secret", // hardcoded
          },
        },
      },
    } as unknown as ProjectConfig;

    writeFileSync(join(tmpDir, "config.json"), JSON.stringify(config, null, 2));

    // Step 1: detect hardcoded secrets (should find 1)
    const hardcodedSecrets = detectHardcodedSecrets(tmpDir, ["config.json"]);
    expect(hardcodedSecrets).toHaveLength(1);
    expect(hardcodedSecrets[0].path).toBe("auth.external.github.secret");

    // Step 2: strip hardcoded secrets before API push
    const safeConfig = stripHardcodedSecrets(config);

    // Step 3: build hardcodedPaths filter set
    const hardcodedPaths = new Set(hardcodedSecrets.map((s) => s.path));

    // Step 4: detect missing secrets, filtering out hardcoded ones
    const missingSecrets = detectMissingSecrets(safeConfig, () => undefined).filter(
      (s) => !hardcodedPaths.has(s.path)
    );

    // The hardcoded secret path should NOT appear in missing secrets (filtered out)
    const doubleJeopardy = missingSecrets.find((s) => s.path === "auth.external.github.secret");
    expect(doubleJeopardy).toBeUndefined();
  });
});
