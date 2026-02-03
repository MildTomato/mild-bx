/**
 * Init command - initialize a new supabase project
 */

import React, { useState, useEffect } from "react";
import { render, Box, Text } from "ink";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { Spinner, Status } from "../components/Spinner.js";
import {
  ProjectPicker,
  RegionPicker,
  CreateOrSelectChoice,
  NameInput,
  ChoicePicker,
} from "../components/Pickers.js";
import { OrgFlow } from "../components/OrgFlow.js";
import { createClient, type Organization, type Project } from "../lib/api.js";
import { getAccessToken } from "../lib/config.js";
import { type Region, REGIONS } from "../lib/constants.js";
import { createProject as createProjectOp } from "../lib/operations.js";
import { success, bold, url, dim, icons } from "../lib/styles.js";
import { loadProjectConfig, getWorkflowProfile } from "../lib/config.js";
import { Output, BlankLine } from "../components/Print.js";
import {
  buildApiConfigFromRemote,
  buildAuthConfigFromRemote,
} from "../lib/sync.js";
import { WORKFLOW_PROFILES } from "../lib/workflow-profiles.js";
import type { WorkflowProfile, SchemaManagement, ConfigSource } from "../lib/config-types.js";
import SelectInput from "ink-select-input";
import { ProfileArt } from "../components/ProfileArt.js";

interface InitOptions {
  yes?: boolean;
  json?: boolean;
  org?: string;
  project?: string;
  name?: string;
  region?: string;
}

interface ConfigData {
  projectId: string;
  workflowProfile: WorkflowProfile;
  schemaManagement: SchemaManagement;
  configSource: ConfigSource;
  api?: ReturnType<typeof buildApiConfigFromRemote>;
  auth?: ReturnType<typeof buildAuthConfigFromRemote>;
}

function buildConfigJson(data: ConfigData): string {
  const config: Record<string, unknown> = {
    $schema: "../../../cli/config-schema/config.schema.json",
    project_id: data.projectId,
    workflow_profile: data.workflowProfile,
    schema_management: data.schemaManagement,
    config_source: data.configSource,
  };

  if (data.api && Object.keys(data.api).length > 0) {
    config.api = data.api;
  }

  if (data.auth && Object.keys(data.auth).length > 0) {
    config.auth = data.auth;
  }

  return JSON.stringify(config, null, 2);
}

type Step =
  | "org"
  | "project-choice"
  | "project-select"
  | "project-name"
  | "project-region"
  | "project-creating"
  | "schema-management"
  | "config-source"
  | "workflow-profile";

/** Major steps shown in progress indicator (sub-steps map to their parent) */
const INIT_STEPS = ["org", "project", "schema-management", "config-source", "workflow-profile"] as const;

/** Map each step to its major step for progress calculation */
const STEP_TO_MAJOR: Record<Step, (typeof INIT_STEPS)[number]> = {
  "org": "org",
  "project-choice": "project",
  "project-select": "project",
  "project-name": "project",
  "project-region": "project",
  "project-creating": "project",
  "schema-management": "schema-management",
  "config-source": "config-source",
  "workflow-profile": "workflow-profile",
};

function getStepProgress(step: Step): { current: number; total: number } {
  const majorStep = STEP_TO_MAJOR[step];
  const current = INIT_STEPS.indexOf(majorStep) + 1;
  return { current, total: INIT_STEPS.length };
}

/**
 * Profile selector with live diagram preview.
 * Shows the ASCII art for the focused profile above the selector.
 */
function ProfileSelector({
  onSelect,
}: {
  onSelect: (profile: WorkflowProfile) => void;
}) {
  const defaultProfile = "solo";
  const [focusedIndex, setFocusedIndex] = useState(0);

  const items = WORKFLOW_PROFILES.map((p) => ({
    label: `${p.name} - "${p.title}"`,
    value: p.name,
    isDefault: p.name === defaultProfile,
  }));

  const focusedProfile = WORKFLOW_PROFILES[focusedIndex];

  const ProfileItem = ({
    label,
    isSelected,
    isDefault,
  }: {
    label: string;
    isSelected: boolean;
    isDefault?: boolean;
  }) => (
    <Text color={isSelected ? "cyan" : undefined}>
      {label}
      {isDefault && <Text dimColor> (default)</Text>}
    </Text>
  );

  return (
    <Box flexDirection="column">
      <ProfileArt profile={focusedProfile} />
      <SelectInput
        items={items}
        onHighlight={(item) => {
          const idx = WORKFLOW_PROFILES.findIndex((p) => p.name === item.value);
          if (idx >= 0) setFocusedIndex(idx);
        }}
        itemComponent={({ label, isSelected, isDefault }) => (
          <ProfileItem
            label={label}
            isSelected={isSelected}
            isDefault={isDefault}
          />
        )}
        onSelect={(item) => onSelect(item.value as WorkflowProfile)}
      />
    </Box>
  );
}

interface ProjectResult {
  ref: string;
  name: string;
  schemaManagement: SchemaManagement;
  configSource: ConfigSource;
  workflowProfile: WorkflowProfile;
  dbPassword?: string;
}

function InitUI({
  onComplete,
}: {
  onComplete: (result: ProjectResult) => void;
}) {
  const [step, setStep] = useState<Step>("org");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [projectName, setProjectName] = useState<string>("");
  const [selectedProject, setSelectedProject] = useState<{ ref: string; name: string } | null>(null);
  const [dbPassword, setDbPassword] = useState<string | undefined>(undefined);
  const [schemaManagement, setSchemaManagement] = useState<SchemaManagement>("declarative");
  const [configSource, setConfigSource] = useState<ConfigSource>("code");
  const [error, setError] = useState<string | null>(null);

  // Get step description for header
  function getStepInfo(): { title: string; subtitle?: string } {
    const { current, total } = getStepProgress(step);
    const prefix = `Step ${current}/${total}:`;
    const orgContext = selectedOrg
      ? `Organization: ${selectedOrg.name}`
      : undefined;

    switch (step) {
      case "org":
        return {
          title: `${prefix} Choose Organization`,
          subtitle: "Projects belong to organizations. Select or create one.",
        };
      case "project-choice":
      case "project-select":
        return {
          title: `${prefix} Choose Project`,
          subtitle: orgContext,
        };
      case "project-name":
        return {
          title: `${prefix} Create Project - Name`,
          subtitle: orgContext,
        };
      case "project-region":
        return {
          title: `${prefix} Create Project - Region`,
          subtitle: projectName ? `Project: ${projectName}` : orgContext,
        };
      case "project-creating":
        return {
          title: `${prefix} Creating Project`,
          subtitle: projectName
            ? `${projectName} in ${selectedOrg?.name}`
            : undefined,
        };
      case "schema-management":
        return {
          title: `${prefix} Schema Management`,
          subtitle: "How do you want to manage database schema changes?",
        };
      case "config-source":
        return {
          title: `${prefix} Config Source of Truth`,
          subtitle: "Where should your config be managed?",
        };
      case "workflow-profile":
        return {
          title: `${prefix} Choose Workflow Profile`,
          subtitle: "How do you want to work with Supabase?",
        };
      default:
        return { title: "Initialize Supabase Project" };
    }
  }

  async function loadProjects(org: Organization) {
    const token = getAccessToken();
    if (!token) return;

    try {
      const client = createClient(token);
      const allProjects = await client.listProjects();
      const orgProjects = allProjects.filter(
        (p) => p.organization_slug === org.slug,
      );
      setProjects(orgProjects);
      setStep("project-choice");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    }
  }

  async function createProject(region: Region) {
    setStep("project-creating");
    const token = getAccessToken();
    if (!token || !selectedOrg) {
      setError("Missing token or organization");
      return;
    }

    try {
      const { project, dbPassword: pwd } = await createProjectOp({
        token,
        orgSlug: selectedOrg.slug,
        region,
        name: projectName || undefined,
      });

      setSelectedProject({ ref: project.ref, name: projectName });
      setDbPassword(pwd);
      setStep("schema-management");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    }
  }

  const { title, subtitle } = getStepInfo();

  // Wrap content with header and consistent padding
  function withHeader(content: React.ReactNode) {
    return (
      <Box flexDirection="column" paddingTop={1}>
        <Text dimColor>Initializing Supabase in this directory</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold color="cyan">
            {title}
          </Text>
          {subtitle && <Text dimColor>{subtitle}</Text>}
          <Box marginTop={1}>{content}</Box>
        </Box>
      </Box>
    );
  }

  if (error) {
    return withHeader(<Status type="error" message={error} />);
  }

  if (step === "org") {
    return withHeader(
      <OrgFlow
        onComplete={(org) => {
          setSelectedOrg(org);
          loadProjects(org);
        }}
        onError={setError}
      />,
    );
  }

  if (step === "project-choice") {
    return withHeader(
      <CreateOrSelectChoice
        entityName="project"
        existingCount={projects.length}
        existingNames={projects.map((p) => p.name)}
        onChoice={(choice) => {
          if (choice === "new") {
            setStep("project-name");
          } else {
            setStep("project-select");
          }
        }}
      />,
    );
  }

  if (step === "project-select") {
    return withHeader(
      <ProjectPicker
        orgSlug={selectedOrg?.slug}
        onSelect={(project) => {
          setSelectedProject({ ref: project.ref, name: project.name });
          setStep("schema-management");
        }}
        onError={setError}
      />,
    );
  }

  if (step === "project-name") {
    const suggestedName = `my-project-${Date.now().toString(36).slice(-4)}`;
    return withHeader(
      <NameInput
        label="What would you like to name your project?"
        placeholder={suggestedName}
        defaultValue={suggestedName}
        hint="This will be visible in your Supabase dashboard"
        onSubmit={(name) => {
          setProjectName(name);
          setStep("project-region");
        }}
      />,
    );
  }

  if (step === "project-region") {
    return withHeader(
      <RegionPicker
        title="Where should your project be hosted?"
        onSelect={createProject}
      />,
    );
  }

  if (step === "project-creating") {
    return withHeader(
      <Spinner
        message={`Creating project "${projectName}" (this may take a minute)...`}
      />,
    );
  }

  if (step === "schema-management") {
    const choices = [
      {
        key: "declarative",
        label: "Declarative (recommended)",
        value: "declarative",
      },
      {
        key: "migrations",
        label: "Migrations",
        value: "migrations",
      },
    ];

    return withHeader(
      <Box flexDirection="column">
        <Box flexDirection="column" marginBottom={1}>
          <Text>
            <Text bold color="blue">Declarative</Text>
            <Text dimColor> - Write what you want, we figure out the changes</Text>
          </Text>
          <Text>
            <Text bold color="blue">Migrations</Text>
            <Text dimColor> - Traditional versioned migration files</Text>
          </Text>
        </Box>
        <ChoicePicker
          title="How do you want to manage schema?"
          choices={choices}
          onSelect={(value) => {
            setSchemaManagement(value as SchemaManagement);
            setStep("config-source");
          }}
        />
      </Box>,
    );
  }

  if (step === "config-source") {
    const choices = [
      {
        key: "code",
        label: "In code (recommended)",
        value: "code",
      },
      {
        key: "remote",
        label: "Remote (dashboard)",
        value: "remote",
      },
    ];

    return withHeader(
      <Box flexDirection="column">
        <Box flexDirection="column" marginBottom={1}>
          <Text>
            <Text bold color="blue">In code</Text>
            <Text dimColor> - config.json is source of truth, pushed to remote</Text>
          </Text>
          <Text>
            <Text bold color="blue">Remote</Text>
            <Text dimColor> - Dashboard is source of truth, pulled to local</Text>
          </Text>
        </Box>
        <ChoicePicker
          title="Where should config live?"
          choices={choices}
          onSelect={(value) => {
            setConfigSource(value as ConfigSource);
            setStep("workflow-profile");
          }}
        />
      </Box>,
    );
  }

  if (step === "workflow-profile") {
    return withHeader(
      <ProfileSelector
        onSelect={(profile) => {
          if (!selectedProject) return;
          onComplete({
            ref: selectedProject.ref,
            name: selectedProject.name,
            schemaManagement,
            configSource,
            workflowProfile: profile,
            dbPassword,
          });
        }}
      />,
    );
  }

  return null;
}

// Confirmation prompt for running supa dev
function RunDevPrompt({
  onComplete,
}: {
  onComplete: (runDev: boolean) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const choices = [
    { key: "yes", label: "Yes, start supa dev", value: "yes" },
    { key: "no", label: "No, I'll run it later", value: "no" },
  ];

  const handleSelect = (value: string) => {
    setSelected(value);
    // Small delay to show the selection before completing
    setTimeout(() => onComplete(value === "yes"), 100);
  };

  if (selected) {
    const selectedLabel =
      choices.find((c) => c.value === selected)?.label || selected;
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="cyan" bold>
            Run supa dev now?
          </Text>
          <Text> </Text>
          <Text color="green">{selectedLabel}</Text>
        </Text>
      </Box>
    );
  }

  return (
    <ChoicePicker
      title="Run supa dev now?"
      choices={choices}
      onSelect={handleSelect}
    />
  );
}

export async function initCommand(options: InitOptions): Promise<void> {
  const cwd = process.cwd();
  const supabaseDir = join(cwd, "supabase");

  if (existsSync(join(supabaseDir, "config.json"))) {
    const config = loadProjectConfig(cwd);
    const projectId = config?.project_id || "unknown";
    const profile = config ? getWorkflowProfile(config) : "unknown";
    const dashboardUrl = `https://supabase.com/dashboard/project/${projectId}`;

    const profileDef = WORKFLOW_PROFILES.find((p) => p.name === profile);

    if (options.json) {
      console.log(
        JSON.stringify({
          status: "already_initialized",
          project_id: projectId,
          workflow_profile: profile,
          dashboard_url: dashboardUrl,
          config_path: join(supabaseDir, "config.json"),
        }),
      );
    } else {
      const AlreadyInitOutput = () => (
        <Output>
          <Text>Already initialized in this directory.</Text>
          <BlankLine />
          <Text>
            <Text dimColor>Project:</Text> {projectId}
          </Text>
          <Text>
            <Text dimColor>Config:</Text> supabase/config.json
          </Text>
          <Text>
            <Text dimColor>Profile:</Text> {profile}
          </Text>
          {profileDef && <ProfileArt profile={profileDef} hideHeader />}
          <Text dimColor>Next steps:</Text>
          <Text>  supa dev  <Text dimColor>Start development watcher</Text></Text>
          <Text>  supa project profile  <Text dimColor>Change workflow profile</Text></Text>
          <Text>  supa status  <Text dimColor>Show project status</Text></Text>
        </Output>
      );
      render(<AlreadyInitOutput />);
    }
    return;
  }

  const token = getAccessToken();
  if (!token) {
    if (options.json) {
      console.log(
        JSON.stringify({ status: "error", message: "Not authenticated" }),
      );
    } else {
      console.log(
        "Not authenticated. Set SUPABASE_ACCESS_TOKEN environment variable.",
      );
    }
    return;
  }

  let project: ProjectResult;

  // Non-interactive mode: use flags if provided
  if (options.project) {
    // Link to existing project by ref
    const client = createClient(token);
    try {
      const projects = await client.listProjects();
      const found = projects.find((p) => p.ref === options.project);
      if (!found) {
        if (options.json) {
          console.log(
            JSON.stringify({
              status: "error",
              message: `Project not found: ${options.project}`,
            }),
          );
        } else {
          console.error(`Error: Project not found: ${options.project}`);
        }
        process.exit(1);
      }
      project = { ref: found.ref, name: found.name, schemaManagement: "declarative", configSource: "code", workflowProfile: "solo" };
    } catch (err) {
      if (options.json) {
        console.log(
          JSON.stringify({
            status: "error",
            message:
              err instanceof Error ? err.message : "Failed to fetch projects",
          }),
        );
      } else {
        console.error(
          "Error:",
          err instanceof Error ? err.message : "Failed to fetch projects",
        );
      }
      process.exit(1);
    }
  } else if (options.org && options.name && options.region) {
    // Create new project with provided flags
    const validRegions = REGIONS.map((r) => r.value);
    if (!validRegions.includes(options.region as Region)) {
      if (options.json) {
        console.log(
          JSON.stringify({
            status: "error",
            message: `Invalid region: ${options.region}. Valid regions: ${validRegions.join(", ")}`,
          }),
        );
      } else {
        console.error(`Error: Invalid region: ${options.region}`);
        console.error(`Valid regions: ${validRegions.join(", ")}`);
      }
      process.exit(1);
    }

    try {
      if (!options.json) {
        console.log(
          `Creating project "${options.name}" in ${options.region}...`,
        );
      }
      const { project: newProject, dbPassword } = await createProjectOp({
        token,
        orgSlug: options.org,
        region: options.region as Region,
        name: options.name,
      });
      project = { ref: newProject.ref, name: options.name, schemaManagement: "declarative", configSource: "code", workflowProfile: "solo", dbPassword };
    } catch (err) {
      if (options.json) {
        console.log(
          JSON.stringify({
            status: "error",
            message:
              err instanceof Error ? err.message : "Failed to create project",
          }),
        );
      } else {
        console.error(
          "Error:",
          err instanceof Error ? err.message : "Failed to create project",
        );
      }
      process.exit(1);
    }
  } else if (options.org || options.name || options.region) {
    // Partial flags provided - show error
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message:
            "To create a new project non-interactively, provide all of: --org, --name, --region. Or use --project to link to an existing project.",
        }),
      );
    } else {
      console.error(
        "Error: To create a new project non-interactively, provide all of: --org, --name, --region",
      );
      console.error("Or use --project <ref> to link to an existing project.");
    }
    process.exit(1);
  } else if (options.json || !process.stdin.isTTY) {
    // Non-interactive mode but no flags provided
    if (options.json) {
      console.log(
        JSON.stringify({
          status: "error",
          message:
            "Non-interactive mode requires flags. Use --project <ref> for existing project, or --org, --name, --region for new project.",
          hint: 'Run "supa orgs --json" to list organizations, "supa projects list --json" to list projects.',
        }),
      );
    } else {
      console.error("Error: Non-interactive mode requires flags.");
      console.error(
        "Use --project <ref> for existing project, or --org, --name, --region for new project.",
      );
      console.error(
        'Run "supa orgs --json" to list organizations, "supa projects list --json" to list projects.',
      );
    }
    process.exit(1);
  } else {
    // Interactive mode
    project = await new Promise<ProjectResult>((resolve) => {
      const { unmount, clear } = render(
        <InitUI
          onComplete={(result) => {
            clear();
            unmount();
            resolve(result);
          }}
        />,
      );
    });
  }

  const { ref: projectRef, name: projectName, schemaManagement = "declarative", configSource = "code", workflowProfile = "solo" } = project;

  // Show spinner while fetching project config (only in interactive mode)
  let configSpinner: { clear: () => void; unmount: () => void } | null = null;
  if (!options.json && process.stdin.isTTY) {
    const ConfigSpinner = () => (
      <Box flexDirection="column" paddingTop={1}>
        <Text dimColor>Initializing Supabase in this directory</Text>
        <Box marginTop={1}>
          <Spinner message="Fetching project config..." />
        </Box>
      </Box>
    );
    configSpinner = render(<ConfigSpinner />);
  }

  // Fetch project config and API keys
  const client = createClient(token);
  let anonKey = "";
  let apiUrl = `https://${projectRef}.supabase.co`;
  let apiConfig: ReturnType<typeof buildApiConfigFromRemote> = {};
  let authConfig: ReturnType<typeof buildAuthConfigFromRemote> = {};

  try {
    // Wait a moment for the project to be ready
    await new Promise((r) => setTimeout(r, 2000));

    // Fetch API keys
    const keys = await client.getProjectApiKeys(projectRef);
    const anonKeyObj = keys.find(
      (k) => k.name === "anon" || k.name === "publishable anon key",
    );
    if (anonKeyObj?.api_key) {
      anonKey = anonKeyObj.api_key;
    }

    // Fetch remote config
    const remotePostgrest = await client.getPostgrestConfig(projectRef);
    apiConfig = buildApiConfigFromRemote(
      remotePostgrest as Record<string, unknown>,
    );

    const remoteAuth = await client.getAuthConfig(projectRef);
    authConfig = buildAuthConfigFromRemote(
      remoteAuth as Record<string, unknown>,
    );
  } catch {
    // Config might not be available yet if project is still initializing
  }

  if (configSpinner) {
    configSpinner.clear();
    configSpinner.unmount();
  }

  // Create directories
  const dirs = [
    supabaseDir,
    join(supabaseDir, "migrations"),
    join(supabaseDir, "functions"),
    join(supabaseDir, "types"),
    join(supabaseDir, "schema", "public"),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // Write DB password to .env if we created a new project
  if (project.dbPassword) {
    const envPath = join(cwd, ".env");
    const envLine = `SUPABASE_DB_PASSWORD=${project.dbPassword}\n`;
    if (existsSync(envPath)) {
      // Append to existing .env
      const existingContent = readFileSync(envPath, "utf-8");
      if (!existingContent.includes("SUPABASE_DB_PASSWORD=")) {
        appendFileSync(envPath, envLine);
      }
    } else {
      writeFileSync(envPath, envLine);
    }
  }

  // Build config from actual project settings
  const configContent = buildConfigJson({
    projectId: projectRef,
    workflowProfile,
    schemaManagement,
    configSource,
    api: apiConfig,
    auth: authConfig,
  });
  writeFileSync(join(supabaseDir, "config.json"), configContent);
  writeFileSync(join(supabaseDir, "migrations", ".gitkeep"), "");
  writeFileSync(join(supabaseDir, "functions", ".gitkeep"), "");

  if (options.json) {
    console.log(
      JSON.stringify({
        status: "success",
        project: {
          id: projectRef,
          name: projectName,
          dashboardUrl: `https://supabase.com/dashboard/project/${projectRef}`,
        },
        api: {
          url: apiUrl,
          anonKey: anonKey || null,
          secretKey: '[hidden] run "supa project api-keys --json --reveal"',
        },
        usage: `createClient("${apiUrl}", "<ANON_KEY>")`,
        created: [
          "supabase/config.json",
          "supabase/migrations/",
          "supabase/functions/",
          "supabase/types/",
          "supabase/schema/public/",
        ],
        next: {
          command: "supa dev --json",
          description:
            "Start watcher for continuous sync - runs schema changes automatically",
        },
        customize: {
          config: "supabase/config.json - Edit API and auth settings",
          schema:
            "supabase/schema/ - Add .sql files to define your database schema",
          migrations:
            "supabase/migrations/ - Add version-controlled migration files",
        },
      }),
    );
  } else {
    const dashboardUrl = `https://supabase.com/dashboard/project/${projectRef}`;

    const SuccessOutput = () => (
      <Output>
        <Text>{success("Initialized Supabase")}</Text>
        <Text> Created a new project: {bold(`"${projectName}"`)}</Text>
        <BlankLine />
        <Text dimColor> Project</Text>
        <Text>
          {" "}
          <Text dimColor>ID:</Text> {projectRef}
        </Text>
        <Text>
          {" "}
          <Text dimColor>Dashboard:</Text> {url(dashboardUrl)}
        </Text>
        <BlankLine />
        <Text dimColor> API Credentials</Text>
        <Text>
          {" "}
          <Text dimColor>URL:</Text> {url(apiUrl)}
        </Text>
        <Text>
          {" "}
          <Text dimColor>Anon Key:</Text>{" "}
          {anonKey || <Text dimColor>[Keys still initializing]</Text>}
        </Text>
        <Text>
          {" "}
          <Text dimColor>Secret Key:</Text>{" "}
          <Text dimColor>[hidden] run "supa keys"</Text>
        </Text>
        <BlankLine />
        <Text dimColor> Usage</Text>
        <Text>
          {" "}
          <Text dimColor>createClient(</Text>
          {url(`"${apiUrl}"`)}
          <Text dimColor>, {'"<ANON_KEY>"'}</Text>
          <Text dimColor>)</Text>
        </Text>
        <BlankLine />
        <Text>
          {" "}
          <Text dimColor>Created in</Text> {bold("./supabase/")}
        </Text>
        <Text>
          {" "}
          <Text dimColor>{icons.file}</Text> config.json
        </Text>
        <Text>
          {" "}
          <Text dimColor>{icons.folder}</Text> migrations/
        </Text>
        <Text>
          {" "}
          <Text dimColor>{icons.folder}</Text> functions/
        </Text>
        <Text>
          {" "}
          <Text dimColor>{icons.folder}</Text> types/
        </Text>
        <BlankLine />
        <Text dimColor> Customize your project</Text>
        <Text>
          {" "}
          <Text dimColor>{icons.file}</Text> supabase/config.json{" "}
          <Text dimColor>API and auth settings</Text>
        </Text>
        <Text>
          {" "}
          <Text dimColor>{icons.folder}</Text> supabase/schema/{" "}
          <Text dimColor>Add .sql files for schema</Text>
        </Text>
        <BlankLine />
        <Text dimColor>
          {" "}
          Tip: Use --json for structured output when scripting
        </Text>
      </Output>
    );

    const { unmount: unmountSuccess } = render(<SuccessOutput />);

    // In interactive TTY mode, prompt to run supa dev
    if (process.stdin.isTTY) {
      // Unmount success output before showing prompt (but don't clear - it stays on screen)
      unmountSuccess();

      const runDev = await new Promise<boolean>((resolve) => {
        const { unmount } = render(
          <RunDevPrompt
            onComplete={(choice) => {
              unmount();
              resolve(choice);
            }}
          />,
        );
      });

      if (runDev) {
        console.log();
        console.log(dim("Starting supa dev..."));
        console.log();

        // Build env with the new db password if we created a project
        const spawnEnv = { ...process.env };
        if (project.dbPassword) {
          spawnEnv.SUPABASE_DB_PASSWORD = project.dbPassword;
        }

        // Spawn supa dev in the foreground
        const child = spawn("pnpm", ["supa", "dev"], {
          stdio: "inherit",
          cwd: process.cwd(),
          env: spawnEnv,
        });

        await new Promise<void>((resolve) => {
          child.on("close", () => resolve());
        });
      }
    }
  }
}
