import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  sanitizeBranchName,
  deepMergeConfig,
  loadEffectiveConfig,
} from "./config-overlay.js";

// ---------------------------------------------------------------------------
// sanitizeBranchName
// ---------------------------------------------------------------------------

describe("sanitizeBranchName", () => {
  it("replaces forward slashes with dashes", () => {
    expect(sanitizeBranchName("feat/my-feature")).toBe("feat-my-feature");
  });

  it("replaces backslashes with dashes", () => {
    expect(sanitizeBranchName("feat\\my-feature")).toBe("feat-my-feature");
  });

  it("replaces colon with dash", () => {
    expect(sanitizeBranchName("feat:thing")).toBe("feat-thing");
  });

  it("replaces all unsafe chars", () => {
    expect(sanitizeBranchName('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  it("leaves clean branch names unchanged", () => {
    expect(sanitizeBranchName("main")).toBe("main");
    expect(sanitizeBranchName("feat-my-thing")).toBe("feat-my-thing");
    expect(sanitizeBranchName("release/1.2.3")).toBe("release-1.2.3");
  });
});

// ---------------------------------------------------------------------------
// deepMergeConfig
// ---------------------------------------------------------------------------

describe("deepMergeConfig", () => {
  it("scalar: overlay wins", () => {
    const base = { a: 1, b: "old" };
    const overlay = { b: "new" };
    expect(deepMergeConfig(base, overlay)).toEqual({ a: 1, b: "new" });
  });

  it("scalar: base value preserved when not in overlay", () => {
    const base = { a: 1, b: 2 };
    const overlay = { a: 99 };
    expect(deepMergeConfig(base, overlay)).toEqual({ a: 99, b: 2 });
  });

  it("object: deep merge recurses", () => {
    const base = { auth: { site_url: "https://example.com", enable_signup: true } };
    const overlay = { auth: { site_url: "https://preview.example.com" } };
    expect(deepMergeConfig(base, overlay)).toEqual({
      auth: { site_url: "https://preview.example.com", enable_signup: true },
    });
  });

  it("nested object merge (3 levels)", () => {
    const base = { a: { b: { c: 1, d: 2 } } };
    const overlay = { a: { b: { c: 99 } } };
    expect(deepMergeConfig(base, overlay)).toEqual({ a: { b: { c: 99, d: 2 } } });
  });

  it("array: overlay replaces entirely", () => {
    const base = { auth: { additional_redirect_urls: ["https://a.com", "https://b.com"] } };
    const overlay = { auth: { additional_redirect_urls: ["https://c.com"] } };
    expect(deepMergeConfig(base, overlay)).toEqual({
      auth: { additional_redirect_urls: ["https://c.com"] },
    });
  });

  it("null: deletes the key", () => {
    const base = { a: 1, b: 2 };
    const overlay = { b: null };
    const result = deepMergeConfig(base, overlay as Record<string, unknown>);
    expect(result).toEqual({ a: 1 });
    expect("b" in result).toBe(false);
  });

  it("null: deletes nested key", () => {
    const base = { auth: { site_url: "x", extra: "y" } };
    const overlay = { auth: { extra: null } };
    expect(deepMergeConfig(base, overlay as Record<string, unknown>)).toEqual({
      auth: { site_url: "x" },
    });
  });

  it("overlay adds new key", () => {
    const base = { a: 1 };
    const overlay = { b: 2 };
    expect(deepMergeConfig(base, overlay)).toEqual({ a: 1, b: 2 });
  });

  it("object in overlay where base has scalar → overlay wins", () => {
    const base = { a: 1 };
    const overlay = { a: { nested: true } };
    expect(deepMergeConfig(base, overlay)).toEqual({ a: { nested: true } });
  });
});

// ---------------------------------------------------------------------------
// loadEffectiveConfig (integration with temp dir)
// ---------------------------------------------------------------------------

describe("loadEffectiveConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `config-overlay-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpDir, "supabase"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeBase = (content: object) => {
    writeFileSync(join(tmpDir, "supabase", "config.json"), JSON.stringify(content));
  };

  const writeOverlay = (name: string, content: object) => {
    writeFileSync(join(tmpDir, "supabase", name), JSON.stringify(content));
  };

  it("no overlays → returns base config, layers = [config.json]", () => {
    writeBase({ project_id: "abc123", auth: { site_url: "https://example.com" } });
    const { config, layers } = loadEffectiveConfig(tmpDir, "development");
    expect(layers).toEqual(["config.json"]);
    expect((config as Record<string, unknown>).project_id).toBe("abc123");
  });

  it("production env → loads config.production.json overlay", () => {
    writeBase({ auth: { site_url: "https://example.com" } });
    writeOverlay("config.production.json", { auth: { site_url: "https://prod.example.com" } });
    const { config, layers } = loadEffectiveConfig(tmpDir, "production");
    expect(layers).toEqual(["config.json", "config.production.json"]);
    expect((config as Record<string, unknown>).auth).toMatchObject({ site_url: "https://prod.example.com" });
  });

  it("preview env + branch → loads both env and branch overlays", () => {
    writeBase({ auth: { site_url: "https://example.com", enable_signup: true } });
    writeOverlay("config.preview.json", { auth: { site_url: "https://preview.example.com" } });
    writeOverlay("config.feat-my-feature.json", { auth: { enable_signup: false } });

    const { config, layers } = loadEffectiveConfig(tmpDir, "preview", "feat/my-feature");
    expect(layers).toEqual([
      "config.json",
      "config.preview.json",
      "config.feat-my-feature.json",
    ]);
    expect((config as Record<string, unknown>).auth).toMatchObject({
      site_url: "https://preview.example.com",
      enable_signup: false,
    });
  });

  it("preview env with branch but no branch overlay → only env overlay loaded", () => {
    writeBase({ auth: { site_url: "https://example.com" } });
    writeOverlay("config.preview.json", { auth: { site_url: "https://preview.example.com" } });

    const { config, layers } = loadEffectiveConfig(tmpDir, "preview", "feat/no-overlay");
    expect(layers).toEqual(["config.json", "config.preview.json"]);
    expect((config as Record<string, unknown>).auth).toMatchObject({ site_url: "https://preview.example.com" });
  });

  it("development env → no overlays loaded", () => {
    writeBase({ auth: { site_url: "https://example.com" } });
    writeOverlay("config.development.json", { auth: { site_url: "https://dev.example.com" } });

    const { config, layers } = loadEffectiveConfig(tmpDir, "development");
    expect(layers).toEqual(["config.json"]);
    expect((config as Record<string, unknown>).auth).toMatchObject({ site_url: "https://example.com" });
  });

  it("no base config → returns null config and empty layers", () => {
    const { config, layers } = loadEffectiveConfig(tmpDir, "development");
    expect(config).toBeNull();
    expect(layers).toEqual([]);
  });

  it("overlay with env derived from branch when env param omitted", () => {
    // Base has environments mapping preview/* → preview
    writeBase({
      auth: { site_url: "https://example.com" },
      environments: { "preview/*": "preview" },
    });
    writeOverlay("config.preview.json", { auth: { site_url: "https://preview.example.com" } });

    const { config, layers } = loadEffectiveConfig(tmpDir, undefined, "preview/my-feature");
    expect(layers).toEqual(["config.json", "config.preview.json"]);
    expect((config as Record<string, unknown>).auth).toMatchObject({ site_url: "https://preview.example.com" });
  });
});
