/**
 * Schema management commands using Atlas
 */

import React, { useState, useEffect } from "react";
import { render, Text, Box, useApp } from "ink";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { Spinner, Status } from "../components/Spinner.js";
import { createClient } from "../lib/api.js";
import {
  getAccessToken,
  loadProjectConfig,
  getProfileOrAuto,
  getProjectRef,
} from "../lib/config.js";
import { getCurrentBranch } from "../lib/git.js";
import {
  isAtlasAvailable,
  getAtlasVersion,
  diffSchema,
  inspectSchema,
  pullSchema,
} from "../lib/atlas.js";

interface SchemaState {
  step: "checking" | "diffing" | "done" | "error";
  atlasVersion?: string;
  diff?: string;
  hasChanges?: boolean;
  error?: string;
}

interface SchemaAppProps {
  cwd: string;
  profileName?: string;
  action: "diff" | "pull" | "status";
}

function SchemaApp({ cwd, profileName, action }: SchemaAppProps) {
  const { exit } = useApp();
  const [state, setState] = useState<SchemaState>({ step: "checking" });

  useEffect(() => {
    runAction();
  }, []);

  async function runAction() {
    // Check Atlas availability
    if (!isAtlasAvailable()) {
      setState({
        step: "error",
        error: "Atlas not found. Run: pnpm add @ariga/atlas",
      });
      setTimeout(() => exit(), 100);
      return;
    }

    const version = getAtlasVersion();
    setState((s) => ({ ...s, atlasVersion: version || undefined }));

    if (action === "status") {
      setState({ step: "done", atlasVersion: version || undefined });
      setTimeout(() => exit(), 100);
      return;
    }

    // Load config
    const config = loadProjectConfig(cwd);
    if (!config) {
      setState({ step: "error", error: "No supabase/config.json found" });
      setTimeout(() => exit(), 100);
      return;
    }

    const currentBranch = getCurrentBranch(cwd) || undefined;
    const profile = getProfileOrAuto(config, profileName, currentBranch);
    if (!profile) {
      setState({ step: "error", error: "No profile configured" });
      setTimeout(() => exit(), 100);
      return;
    }

    const projectRef = getProjectRef(config, profile);
    if (!projectRef) {
      setState({ step: "error", error: "No project ref configured" });
      setTimeout(() => exit(), 100);
      return;
    }

    const token = getAccessToken();
    if (!token) {
      setState({ step: "error", error: "Not logged in. Run: supa login" });
      setTimeout(() => exit(), 100);
      return;
    }

    // Check schema directory exists
    const schemaDir = join(cwd, "supabase", "schema");
    if (!existsSync(schemaDir)) {
      setState({
        step: "error",
        error: "No supabase/schema directory found. Create schema files there.",
      });
      setTimeout(() => exit(), 100);
      return;
    }

    setState({ step: "diffing", atlasVersion: version || undefined });

    try {
      const client = createClient(token);

      const dbPassword = process.env.SUPABASE_DB_PASSWORD;
      if (!dbPassword) {
        setState({
          step: "error",
          error:
            "SUPABASE_DB_PASSWORD environment variable required for schema operations",
        });
        setTimeout(() => exit(), 100);
        return;
      }

      // Get pooler config for connection string
      const poolerConfig = await client.getPoolerConfig(projectRef);
      const sessionPooler = poolerConfig.find(
        (p: { database_type: string }) => p.database_type === "PRIMARY",
      );
      if (!sessionPooler?.connection_string) {
        setState({
          step: "error",
          error: "Could not get database connection info",
        });
        setTimeout(() => exit(), 100);
        return;
      }
      const connectionString = sessionPooler.connection_string.replace(
        "[YOUR-PASSWORD]",
        dbPassword,
      );

      if (action === "diff") {
        const result = await diffSchema(connectionString, schemaDir);
        setState({
          step: "done",
          atlasVersion: version || undefined,
          diff: result.sql,
          hasChanges: result.hasChanges,
        });
      } else if (action === "pull") {
        const result = await pullSchema(connectionString, schemaDir);
        setState({
          step: "done",
          atlasVersion: version || undefined,
          diff: result.sql,
          hasChanges: true,
        });
      }

      setTimeout(() => exit(), 100);
    } catch (error) {
      setState({
        step: "error",
        error:
          error instanceof Error ? error.message : "Schema operation failed",
      });
      setTimeout(() => exit(), 100);
    }
  }

  if (state.step === "checking") {
    return (
      <Box padding={1}>
        <Spinner message="Checking Atlas..." />
      </Box>
    );
  }

  if (state.step === "diffing") {
    return (
      <Box padding={1}>
        <Spinner message="Comparing schemas..." />
      </Box>
    );
  }

  if (state.step === "error") {
    return (
      <Box padding={1}>
        <Status
          type="error"
          message={state.error || "Schema operation failed"}
        />
      </Box>
    );
  }

  // Done
  if (action === "status") {
    return (
      <Box flexDirection="column" padding={1}>
        <Status type="success" message="Atlas is available" />
        <Box marginTop={1}>
          <Text dimColor>Version: {state.atlasVersion}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Status
        type={state.hasChanges ? "info" : "success"}
        message={
          state.hasChanges ? "Schema changes detected" : "Schema is up to date"
        }
      />

      {state.hasChanges && state.diff && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Changes:</Text>
          <Text>{state.diff}</Text>
        </Box>
      )}
    </Box>
  );
}

interface SchemaOptions {
  profile?: string;
}

export async function schemaDiffCommand(options: SchemaOptions) {
  const cwd = process.cwd();

  const { waitUntilExit } = render(
    <SchemaApp cwd={cwd} profileName={options.profile} action="diff" />,
  );

  await waitUntilExit();
}

export async function schemaPullCommand(options: SchemaOptions) {
  const cwd = process.cwd();

  const { waitUntilExit } = render(
    <SchemaApp cwd={cwd} profileName={options.profile} action="pull" />,
  );

  await waitUntilExit();
}

export async function schemaStatusCommand() {
  const cwd = process.cwd();

  const { waitUntilExit } = render(<SchemaApp cwd={cwd} action="status" />);

  await waitUntilExit();
}
