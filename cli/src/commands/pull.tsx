import React, { useState, useEffect } from "react";
import { render, Text, Box, useApp } from "ink";
import SelectInput from "ink-select-input";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { Spinner, Status } from "../components/Spinner.js";
import {
  createClient,
  Project,
  Branch,
  Function as EdgeFunction,
} from "../lib/api.js";
import {
  getAccessToken,
  loadProjectConfig,
  getProfileOrAuto,
  getProjectRef,
  Profile,
} from "../lib/config.js";
import { getCurrentBranch } from "../lib/git.js";
import {
  buildPostgrestPayload,
  buildAuthPayload,
  compareConfigs,
  buildApiConfigFromRemote,
  buildAuthConfigFromRemote,
  type ConfigDiff,
  type ProjectConfig,
} from "../lib/sync.js";
import { ConfigDiffSummary } from "../components/ConfigDiff.js";
import { pullSchemaWithPgDelta, setVerbose } from "../lib/pg-delta.js";

interface PullState {
  step: "loading" | "fetching" | "confirm" | "applying" | "done" | "error";
  profile?: Profile;
  projectRef?: string;
  project?: Project;
  branches?: Branch[];
  functions?: EdgeFunction[];
  postgrestDiffs?: ConfigDiff[];
  authDiffs?: ConfigDiff[];
  configUpdated?: boolean;
  typesUpdated?: boolean;
  schemaUpdated?: boolean;
  error?: string;
}

interface PullAppProps {
  cwd: string;
  profileName?: string;
  dryRun: boolean;
  typesOnly: boolean;
  schemas: string;
  verbose: boolean;
}

function PullApp({
  cwd,
  profileName,
  dryRun,
  typesOnly,
  schemas,
  verbose,
}: PullAppProps) {
  // Set verbose mode for pg-delta logging
  setVerbose(verbose);
  const { exit } = useApp();
  const [state, setState] = useState<PullState>({ step: "loading" });

  useEffect(() => {
    fetchInfo();
  }, []);

  async function fetchInfo() {
    // Load config
    const config = loadProjectConfig(cwd);
    if (!config) {
      setState({ step: "error", error: "No supabase/config.json found" });
      setTimeout(() => exit(), 100);
      return;
    }

    // Get current git branch
    const currentBranch = getCurrentBranch(cwd) || undefined;

    // Get profile
    const profile = getProfileOrAuto(config, profileName, currentBranch);
    if (!profile) {
      setState({ step: "error", error: "No profile configured" });
      setTimeout(() => exit(), 100);
      return;
    }

    // Get project ref
    const projectRef = getProjectRef(config, profile);
    if (!projectRef) {
      setState({ step: "error", error: "No project ref configured" });
      setTimeout(() => exit(), 100);
      return;
    }

    // Get access token
    const token = getAccessToken();
    if (!token) {
      setState({ step: "error", error: "Not logged in. Run: supa login" });
      setTimeout(() => exit(), 100);
      return;
    }

    setState({ step: "fetching", profile, projectRef });

    const client = createClient(token);
    const projectConfig = config as ProjectConfig;

    try {
      // Fetch project info
      const project = await client.getProject(projectRef);

      // Check project status before proceeding
      if (project.status === "INACTIVE") {
        setState({
          step: "error",
          error: `Project is paused. Restore from: https://supabase.com/dashboard/project/${projectRef}`,
        });
        setTimeout(() => exit(), 100);
        return;
      }
      if (
        project.status !== "ACTIVE_HEALTHY" &&
        project.status !== "ACTIVE_UNHEALTHY"
      ) {
        setState({
          step: "error",
          error: `Project is not ready (status: ${project.status}). Wait for the project to become active.`,
        });
        setTimeout(() => exit(), 100);
        return;
      }

      // Fetch branches (may fail if not enabled)
      let branches: Branch[] = [];
      try {
        branches = await client.listBranches(projectRef);
      } catch {
        // Branches not enabled, ignore
      }

      // Fetch functions
      let functions: EdgeFunction[] = [];
      try {
        functions = await client.listFunctions(projectRef);
      } catch {
        // Functions fetch failed, ignore
      }

      // Fetch remote configs and compare with local
      let postgrestDiffs: ConfigDiff[] = [];
      let authDiffs: ConfigDiff[] = [];

      try {
        const remotePostgrest = await client.getPostgrestConfig(projectRef);
        const localPostgrest = buildPostgrestPayload(projectConfig);
        if (localPostgrest) {
          postgrestDiffs = compareConfigs(
            localPostgrest as Record<string, unknown>,
            remotePostgrest as Record<string, unknown>,
          );
        }
      } catch {
        // Config fetch failed, ignore
      }

      try {
        const remoteAuth = await client.getAuthConfig(projectRef);
        const localAuth = buildAuthPayload(projectConfig);
        if (localAuth) {
          authDiffs = compareConfigs(
            localAuth as Record<string, unknown>,
            remoteAuth as Record<string, unknown>,
          );
        }
      } catch {
        // Config fetch failed, ignore
      }

      const hasConfigChanges =
        postgrestDiffs.some((d) => d.changed) ||
        authDiffs.some((d) => d.changed);

      // If plan mode, show what would be pulled and exit
      if (dryRun) {
        setState({
          step: "done",
          profile,
          projectRef,
          project,
          branches,
          functions,
          postgrestDiffs,
          authDiffs,
          typesWritten: false,
        });
        setTimeout(() => exit(), 100);
        return;
      }

      // If no config changes, just pull types directly
      if (!hasConfigChanges) {
        setState({ step: "applying", profile, projectRef });
        await applyPullDirect(projectRef, token);
        return;
      }

      // Show confirmation for config changes
      setState({
        step: "confirm",
        profile,
        projectRef,
        project,
        branches,
        functions,
        postgrestDiffs,
        authDiffs,
      });
    } catch (error) {
      setState({
        step: "error",
        error: error instanceof Error ? error.message : "Failed to pull",
      });
      setTimeout(() => exit(), 100);
    }
  }

  interface PullResult {
    configUpdated: boolean;
    typesUpdated: boolean;
    schemaUpdated: boolean;
  }

  // Shared pull logic - writes config and types only if changed
  async function doPull(
    projectRef: string,
    token: string,
    updateConfig: boolean,
  ): Promise<PullResult> {
    const client = createClient(token);
    let configUpdated = false;
    let typesUpdated = false;

    // Update config.json with remote values (only if there were changes)
    if (updateConfig) {
      const configPath = join(cwd, "supabase", "config.json");
      try {
        const existingConfig = JSON.parse(readFileSync(configPath, "utf-8"));

        const remotePostgrest = await client.getPostgrestConfig(projectRef);
        const remoteAuth = await client.getAuthConfig(projectRef);

        const apiConfig = buildApiConfigFromRemote(
          remotePostgrest as Record<string, unknown>,
        );
        const authConfig = buildAuthConfigFromRemote(
          remoteAuth as Record<string, unknown>,
        );

        const updatedConfig = {
          ...existingConfig,
          api: { ...existingConfig.api, ...apiConfig },
          auth: { ...existingConfig.auth, ...authConfig },
        };

        const newContent = JSON.stringify(updatedConfig, null, 2) + "\n";
        const existingContent = readFileSync(configPath, "utf-8");

        if (newContent !== existingContent) {
          writeFileSync(configPath, newContent);
          configUpdated = true;
        }
      } catch {
        // Config update failed, continue with types
      }
    }

    // Generate types - only write if changed
    try {
      const typesResp = await client.getTypescriptTypes(projectRef, schemas);
      const typesPath = join(cwd, "supabase", "types", "database.ts");
      mkdirSync(dirname(typesPath), { recursive: true });

      let existingTypes = "";
      try {
        existingTypes = readFileSync(typesPath, "utf-8");
      } catch {
        // File doesn't exist yet
      }

      if (typesResp.types !== existingTypes) {
        writeFileSync(typesPath, typesResp.types);
        typesUpdated = true;
      }
    } catch {
      // Types generation failed, ignore
    }

    // Pull remote schema using pg-delta
    let schemaUpdated = false;
    const dbPassword = process.env.SUPABASE_DB_PASSWORD;
    if (dbPassword) {
      try {
        const poolerConfig = await client.getPoolerConfig(projectRef);
        const sessionPooler = poolerConfig.find(
          (p: { pool_mode: string; database_type: string }) =>
            p.pool_mode === "session" && p.database_type === "PRIMARY",
        );
        const fallbackPooler = poolerConfig.find(
          (p: { database_type: string }) => p.database_type === "PRIMARY",
        );
        const pooler = sessionPooler || fallbackPooler;

        if (pooler?.connection_string) {
          const connectionString = pooler.connection_string
            .replace("[YOUR-PASSWORD]", dbPassword)
            .replace(":6543/", ":5432/");
          const schemaDir = join(cwd, "supabase", "schema");

          const result = await pullSchemaWithPgDelta(
            connectionString,
            schemaDir,
          );

          if (result.success && result.files.length > 0) {
            // Write the files
            for (const file of result.files) {
              mkdirSync(dirname(file.path), { recursive: true });
              writeFileSync(file.path, file.content);
            }
            schemaUpdated = true;
          }
        }
      } catch {
        // Schema pull failed, ignore
      }
    }

    return { configUpdated, typesUpdated, schemaUpdated };
  }

  // Direct pull (no config changes, just types/schema)
  async function applyPullDirect(projectRef: string, token: string) {
    try {
      const result = await doPull(projectRef, token, false);
      setState((s) => ({
        ...s,
        step: "done",
        configUpdated: result.configUpdated,
        typesUpdated: result.typesUpdated,
        schemaUpdated: result.schemaUpdated,
      }));
      setTimeout(() => exit(), 100);
    } catch (error) {
      setState({
        step: "error",
        error: error instanceof Error ? error.message : "Failed to pull",
      });
      setTimeout(() => exit(), 100);
    }
  }

  async function applyPull(projectRef: string) {
    setState((s) => ({ ...s, step: "applying" }));

    const token = getAccessToken();
    if (!token) {
      setState({ step: "error", error: "Not logged in" });
      setTimeout(() => exit(), 100);
      return;
    }

    try {
      const result = await doPull(projectRef, token, true);

      setState((s) => ({
        ...s,
        step: "done",
        configUpdated: result.configUpdated,
        typesUpdated: result.typesUpdated,
        schemaUpdated: result.schemaUpdated,
      }));
      setTimeout(() => exit(), 100);
    } catch (error) {
      setState({
        step: "error",
        error: error instanceof Error ? error.message : "Failed to apply",
      });
      setTimeout(() => exit(), 100);
    }
  }

  function handleConfirmChoice(choice: "apply" | "cancel") {
    if (choice === "apply" && state.projectRef) {
      applyPull(state.projectRef);
    } else {
      exit();
    }
  }

  // Get config diffs
  const postgrestDiffs = state.postgrestDiffs ?? [];
  const authDiffs = state.authDiffs ?? [];
  const hasConfigDiffs =
    postgrestDiffs.some((d) => d.changed) || authDiffs.some((d) => d.changed);

  // Component for showing pending pull details (confirm screen)
  const renderPendingDetails = () => (
    <>
      <ConfigDiffSummary
        postgrestDiffs={postgrestDiffs}
        authDiffs={authDiffs}
      />
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Will write:</Text>
        <Text> supabase/config.json</Text>
        <Text> supabase/types/database.ts</Text>
        <Text> supabase/schema/public/*.sql</Text>
      </Box>
    </>
  );

  // Component for showing completed pull details (done screen)
  const renderDoneDetails = () => (
    <>
      {state.configUpdated && (
        <>
          <ConfigDiffSummary
            postgrestDiffs={postgrestDiffs}
            authDiffs={authDiffs}
          />
          <Box marginTop={1}>
            <Text color="green">Updated supabase/config.json</Text>
          </Box>
        </>
      )}
    </>
  );

  if (state.step === "loading") {
    return (
      <Box padding={1}>
        <Spinner message="Loading configuration..." />
      </Box>
    );
  }

  if (state.step === "fetching") {
    return (
      <Box padding={1}>
        <Spinner message={`Fetching from ${state.projectRef}...`} />
      </Box>
    );
  }

  if (state.step === "error") {
    return (
      <Box padding={1}>
        <Status type="error" message={state.error || "Pull failed"} />
      </Box>
    );
  }

  if (state.step === "confirm") {
    const confirmItems = [
      { key: "apply", label: "Pull and write files", value: "apply" as const },
      { key: "cancel", label: "Cancel", value: "cancel" as const },
    ];

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="yellow">
          Pending pull
        </Text>

        <Box marginTop={1} flexDirection="column">
          {renderPendingDetails()}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <SelectInput
            items={confirmItems}
            onSelect={(item) => handleConfirmChoice(item.value)}
          />
        </Box>
      </Box>
    );
  }

  if (state.step === "applying") {
    return (
      <Box padding={1}>
        <Spinner message="Writing files..." />
      </Box>
    );
  }

  // Done
  if (dryRun) {
    return (
      <Box flexDirection="column" padding={1}>
        <Status type="info" message="Pull preview" />

        <Box marginTop={1} flexDirection="column">
          {hasConfigDiffs ? (
            renderPendingDetails()
          ) : (
            <Text dimColor>Config is in sync with remote</Text>
          )}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>(plan mode - no changes applied)</Text>
        </Box>
      </Box>
    );
  }

  const anythingUpdated =
    state.configUpdated || state.typesUpdated || state.schemaUpdated;

  return (
    <Box flexDirection="column" padding={1}>
      <Status
        type="success"
        message={
          anythingUpdated
            ? "Pulled successfully"
            : "Nothing to pull - everything is up to date"
        }
      />

      {renderDoneDetails()}

      {state.schemaUpdated && (
        <Box marginTop={state.configUpdated ? 1 : 0}>
          <Text color="green">Wrote supabase/schema/public/*.sql</Text>
        </Box>
      )}

      {state.typesUpdated && (
        <Box marginTop={state.configUpdated || state.schemaUpdated ? 1 : 0}>
          <Text color="green">Wrote supabase/types/database.ts</Text>
        </Box>
      )}
    </Box>
  );
}

interface PullOptions {
  profile?: string;
  plan?: boolean;
  typesOnly?: boolean;
  schemas?: string;
  json?: boolean;
  verbose?: boolean;
}

export async function pullCommand(options: PullOptions) {
  const cwd = process.cwd();
  const dryRun = options.plan ?? false;
  const typesOnly = options.typesOnly ?? false;
  const schemas = options.schemas ?? "public";

  // Set verbose mode for pg-delta logging
  setVerbose(options.verbose ?? false);

  if (options.json) {
    // JSON mode - run without Ink
    const config = loadProjectConfig(cwd);
    if (!config) {
      console.log(
        JSON.stringify({ status: "error", message: "No config found" }),
      );
      return;
    }

    const currentBranch = getCurrentBranch(cwd) || undefined;
    const profile = getProfileOrAuto(config, options.profile, currentBranch);
    const projectRef = getProjectRef(config, profile);
    const token = getAccessToken();

    if (!token) {
      console.log(
        JSON.stringify({ status: "error", message: "Not logged in" }),
      );
      return;
    }

    if (!projectRef) {
      console.log(
        JSON.stringify({ status: "error", message: "No project ref" }),
      );
      return;
    }

    try {
      const client = createClient(token);

      // Check project status before proceeding
      const project = await client.getProject(projectRef);
      if (project.status === "INACTIVE") {
        console.log(
          JSON.stringify({
            status: "error",
            message: "Project is paused",
            hint: "Restore the project from the Supabase dashboard",
            dashboardUrl: `https://supabase.com/dashboard/project/${projectRef}`,
          }),
        );
        process.exitCode = 1;
        return;
      }
      if (
        project.status !== "ACTIVE_HEALTHY" &&
        project.status !== "ACTIVE_UNHEALTHY"
      ) {
        console.log(
          JSON.stringify({
            status: "error",
            message: `Project is not ready (status: ${project.status})`,
            hint: "Wait for the project to become active",
          }),
        );
        process.exitCode = 1;
        return;
      }

      const result: Record<string, unknown> = {
        status: "success",
        profile: profile?.name,
        projectRef,
        dryRun,
      };

      if (typesOnly) {
        const typesResp = await client.getTypescriptTypes(projectRef, schemas);
        if (!dryRun) {
          const typesPath = join(cwd, "supabase", "types", "database.ts");
          mkdirSync(dirname(typesPath), { recursive: true });
          writeFileSync(typesPath, typesResp.types);
          result.typesWritten = true;
        }
        result.message = "TypeScript types generated";
      } else {
        result.project = project; // Use project from status check
        try {
          result.branches = await client.listBranches(projectRef);
        } catch {
          result.branches = [];
        }
        try {
          result.functions = await client.listFunctions(projectRef);
        } catch {
          result.functions = [];
        }
        if (!dryRun) {
          try {
            const typesResp = await client.getTypescriptTypes(
              projectRef,
              schemas,
            );
            const typesPath = join(cwd, "supabase", "types", "database.ts");
            mkdirSync(dirname(typesPath), { recursive: true });
            writeFileSync(typesPath, typesResp.types);
            result.typesWritten = true;
          } catch {
            result.typesWritten = false;
          }
        }
      }

      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.log(
        JSON.stringify({
          status: "error",
          message: error instanceof Error ? error.message : "Pull failed",
        }),
      );
    }
    return;
  }

  render(
    <PullApp
      cwd={cwd}
      profileName={options.profile}
      dryRun={dryRun}
      typesOnly={typesOnly}
      schemas={schemas}
      verbose={options.verbose ?? false}
    />,
  );
}
