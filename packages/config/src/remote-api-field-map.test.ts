import { describe, it, expect } from "vitest";
import { diffRemoteAuthConfig, diffRemotePostgrestConfig, buildAuthApiPayload, buildPostgrestApiPayload } from "./remote-api-field-map.js";

describe("diffRemoteAuthConfig", () => {
  it("detects mailer_autoconfirm change (enable_confirmations)", () => {
    const prod  = { mailer_autoconfirm: false }; // prod: confirmations ON
    const branch = { mailer_autoconfirm: true };  // branch: confirmations OFF

    const diffs = diffRemoteAuthConfig(branch, prod);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].key).toBe("auth.email.enable_confirmations");
    expect(diffs[0].from).toBe(true);  // prod had confirmations enabled
    expect(diffs[0].to).toBe(false);   // branch has confirmations disabled
  });

  it("returns empty when values are the same", () => {
    const config = { mailer_autoconfirm: false };
    expect(diffRemoteAuthConfig(config, config)).toHaveLength(0);
  });

  it("detects disable_signup inversion (enable_signup)", () => {
    const prod   = { disable_signup: false }; // prod: sign-ups ON
    const branch = { disable_signup: true };  // branch: sign-ups OFF

    const diffs = diffRemoteAuthConfig(branch, prod);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].key).toBe("auth.enable_signup");
    expect(diffs[0].from).toBe(true);  // prod had sign-ups enabled
    expect(diffs[0].to).toBe(false);   // branch has sign-ups disabled
  });

  it("detects jwt_exp change", () => {
    const prod   = { jwt_exp: 3600 };
    const branch = { jwt_exp: 7200 };

    const diffs = diffRemoteAuthConfig(branch, prod);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].key).toBe("auth.jwt_expiry");
    expect(diffs[0].from).toBe(3600);
    expect(diffs[0].to).toBe(7200);
  });

  it("detects external provider enabled change", () => {
    const prod   = { external_google_enabled: false };
    const branch = { external_google_enabled: true };

    const diffs = diffRemoteAuthConfig(branch, prod);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].key).toBe("auth.external.google.enabled");
    expect(diffs[0].from).toBe(false);
    expect(diffs[0].to).toBe(true);
  });

  it("ignores env-specific fields (site_url, smtp credentials)", () => {
    const prod   = { site_url: "https://prod.com",  smtp_host: "smtp.prod.com" };
    const branch = { site_url: "https://branch.com", smtp_host: "smtp.branch.com" };

    const diffs = diffRemoteAuthConfig(branch, prod);
    expect(diffs).toHaveLength(0);
  });

  it("works with GoTrue uppercase keys (MAILER_AUTOCONFIRM)", () => {
    const prod   = { MAILER_AUTOCONFIRM: false };
    const branch = { MAILER_AUTOCONFIRM: true };

    const diffs = diffRemoteAuthConfig(branch, prod);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].key).toBe("auth.email.enable_confirmations");
    expect(diffs[0].from).toBe(true);
    expect(diffs[0].to).toBe(false);
  });

  it("ignores unmapped fields (jwt_secret)", () => {
    const prod   = { jwt_secret: "secret-a" };
    const branch = { jwt_secret: "secret-b" };

    expect(diffRemoteAuthConfig(branch, prod)).toHaveLength(0);
  });

  it("treats null and undefined as equal (no false positive)", () => {
    // prod returns null, branch doesn't have the key at all
    const prod   = { jwt_exp: null };
    const branch = {};  // key missing = undefined
    expect(diffRemoteAuthConfig(branch as Record<string, unknown>, prod as Record<string, unknown>)).toHaveLength(0);
  });

  it("treats null and empty string as equal (no false positive)", () => {
    const prod   = { password_required_characters: null };
    const branch = { password_required_characters: "" };
    expect(diffRemoteAuthConfig(branch, prod)).toHaveLength(0);
  });
});

describe("diffRemotePostgrestConfig", () => {
  it("detects db_schema change", () => {
    const prod   = { db_schema: "public" };
    const branch = { db_schema: "public,graphql_public" };

    const diffs = diffRemotePostgrestConfig(branch, prod);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].key).toBe("api.schemas");
    expect(diffs[0].from).toBe("public");
    expect(diffs[0].to).toBe("public,graphql_public");
  });

  it("detects max_rows change", () => {
    const prod   = { max_rows: 1000 };
    const branch = { max_rows: 500 };

    const diffs = diffRemotePostgrestConfig(branch, prod);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].key).toBe("api.max_rows");
  });
});
