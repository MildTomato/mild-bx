/**
 * Init command - initialize a new supabase project
 */

import React, { useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { Spinner, Status } from '../components/Spinner.js';
import { 
  ProjectPicker, 
  RegionPicker, 
  CreateOrSelectChoice,
  NameInput
} from '../components/Pickers.js';
import { OrgFlow } from '../components/OrgFlow.js';
import { createClient, type Organization, type Project } from '../lib/api.js';
import { getAccessToken } from '../lib/config.js';
import { type Region, REGIONS } from '../lib/constants.js';
import { createProject as createProjectOp } from '../lib/operations.js';
import { success, bold, url, dim, icons } from '../lib/styles.js';
import { Output, BlankLine } from '../components/Print.js';
import { buildApiConfigFromRemote, buildAuthConfigFromRemote } from '../lib/sync.js';

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
  api?: ReturnType<typeof buildApiConfigFromRemote>;
  auth?: ReturnType<typeof buildAuthConfigFromRemote>;
}

function buildConfigJson(data: ConfigData): string {
  const config: Record<string, unknown> = {
    $schema: '../../../cli/config-schema/config.schema.json',
    project_id: data.projectId,
  };
  
  if (data.api && Object.keys(data.api).length > 0) {
    config.api = data.api;
  }
  
  if (data.auth && Object.keys(data.auth).length > 0) {
    config.auth = data.auth;
  }
  
  config.profiles = {
    local: {
      mode: 'local',
      workflow: 'dashboard',
      branches: ['feature/*', 'fix/*', 'dev'],
    },
    production: {
      mode: 'remote',
      workflow: 'git',
      branches: ['main', 'master'],
    },
  };
  
  return JSON.stringify(config, null, 2);
}

type Step = 
  | 'org'
  | 'project-choice'
  | 'project-select'
  | 'project-name'
  | 'project-region'
  | 'project-creating';

interface ProjectResult {
  ref: string;
  name: string;
  dbPassword?: string;
}

function InitUI({ onComplete }: { onComplete: (result: ProjectResult) => void }) {
  const [step, setStep] = useState<Step>('org');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [projectName, setProjectName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Get step description for header
  function getStepInfo(): { title: string; subtitle?: string } {
    const orgContext = selectedOrg ? `Organization: ${selectedOrg.name}` : undefined;
    
    switch (step) {
      case 'org':
        return { 
          title: 'Step 1/2: Choose Organization',
          subtitle: 'Projects belong to organizations. Select or create one.'
        };
      case 'project-choice':
      case 'project-select':
        return { 
          title: 'Step 2/2: Choose Project',
          subtitle: orgContext
        };
      case 'project-name':
        return { 
          title: 'Step 2/2: Create Project - Name',
          subtitle: orgContext
        };
      case 'project-region':
        return { 
          title: 'Step 2/2: Create Project - Region',
          subtitle: projectName ? `Project: ${projectName}` : orgContext
        };
      case 'project-creating':
        return { 
          title: 'Step 2/2: Creating Project',
          subtitle: projectName ? `${projectName} in ${selectedOrg?.name}` : undefined
        };
      default:
        return { title: 'Initialize Supabase Project' };
    }
  }

  async function loadProjects(org: Organization) {
    const token = getAccessToken();
    if (!token) return;

    try {
      const client = createClient(token);
      const allProjects = await client.listProjects();
      const orgProjects = allProjects.filter(p => p.organization_slug === org.slug);
      setProjects(orgProjects);
      setStep('project-choice');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    }
  }

  async function createProject(region: Region) {
    setStep('project-creating');
    const token = getAccessToken();
    if (!token || !selectedOrg) {
      setError('Missing token or organization');
      return;
    }

    try {
      const { project, dbPassword } = await createProjectOp({
        token,
        orgSlug: selectedOrg.slug,
        region,
        name: projectName || undefined,
      });
      
      onComplete({ ref: project.ref, name: projectName, dbPassword });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    }
  }

  const { title, subtitle } = getStepInfo();

  // Wrap content with header and consistent padding
  function withHeader(content: React.ReactNode) {
    return (
      <Box flexDirection="column" paddingTop={1}>
        <Text dimColor>Initializing Supabase in this directory</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold color="cyan">{title}</Text>
          {subtitle && <Text dimColor>{subtitle}</Text>}
          <Box marginTop={1}>{content}</Box>
        </Box>
      </Box>
    );
  }

  if (error) {
    return withHeader(<Status type="error" message={error} />);
  }

  if (step === 'org') {
    return withHeader(
      <OrgFlow
        onComplete={(org) => {
          setSelectedOrg(org);
          loadProjects(org);
        }}
        onError={setError}
      />
    );
  }

  if (step === 'project-choice') {
    return withHeader(
      <CreateOrSelectChoice
        entityName="project"
        existingCount={projects.length}
        existingNames={projects.map(p => p.name)}
        onChoice={(choice) => {
          if (choice === 'new') {
            setStep('project-name');
          } else {
            setStep('project-select');
          }
        }}
      />
    );
  }

  if (step === 'project-select') {
    return withHeader(
      <ProjectPicker
        orgSlug={selectedOrg?.slug}
        onSelect={(project) => onComplete({ ref: project.ref, name: project.name })}
        onError={setError}
      />
    );
  }

  if (step === 'project-name') {
    const suggestedName = `my-project-${Date.now().toString(36).slice(-4)}`;
    return withHeader(
      <NameInput
        label="What would you like to name your project?"
        placeholder={suggestedName}
        defaultValue={suggestedName}
        hint="This will be visible in your Supabase dashboard"
        onSubmit={(name) => {
          setProjectName(name);
          setStep('project-region');
        }}
      />
    );
  }

  if (step === 'project-region') {
    return withHeader(
      <RegionPicker
        title="Where should your project be hosted?"
        onSelect={createProject}
      />
    );
  }

  if (step === 'project-creating') {
    return withHeader(
      <Spinner message={`Creating project "${projectName}" (this may take a minute)...`} />
    );
  }

  return null;
}

export async function initCommand(options: InitOptions): Promise<void> {
  const cwd = process.cwd();
  const supabaseDir = join(cwd, 'supabase');

  if (existsSync(join(supabaseDir, 'config.json'))) {
    if (options.json) {
      console.log(JSON.stringify({ status: 'error', message: 'Already initialized' }));
    } else {
      console.log();
      console.log('Already initialized. supabase/config.json exists.');
      console.log();
    }
    return;
  }

  const token = getAccessToken();
  if (!token) {
    if (options.json) {
      console.log(JSON.stringify({ status: 'error', message: 'Not authenticated' }));
    } else {
      console.log('Not authenticated. Set SUPABASE_ACCESS_TOKEN environment variable.');
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
      const found = projects.find(p => p.ref === options.project);
      if (!found) {
        if (options.json) {
          console.log(JSON.stringify({ status: 'error', message: `Project not found: ${options.project}` }));
        } else {
          console.error(`Error: Project not found: ${options.project}`);
        }
        process.exit(1);
      }
      project = { ref: found.ref, name: found.name };
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ status: 'error', message: err instanceof Error ? err.message : 'Failed to fetch projects' }));
      } else {
        console.error('Error:', err instanceof Error ? err.message : 'Failed to fetch projects');
      }
      process.exit(1);
    }
  } else if (options.org && options.name && options.region) {
    // Create new project with provided flags
    const validRegions = REGIONS.map(r => r.value);
    if (!validRegions.includes(options.region as Region)) {
      if (options.json) {
        console.log(JSON.stringify({ status: 'error', message: `Invalid region: ${options.region}. Valid regions: ${validRegions.join(', ')}` }));
      } else {
        console.error(`Error: Invalid region: ${options.region}`);
        console.error(`Valid regions: ${validRegions.join(', ')}`);
      }
      process.exit(1);
    }

    try {
      if (!options.json) {
        console.log(`Creating project "${options.name}" in ${options.region}...`);
      }
      const { project: newProject, dbPassword } = await createProjectOp({
        token,
        orgSlug: options.org,
        region: options.region as Region,
        name: options.name,
      });
      project = { ref: newProject.ref, name: options.name, dbPassword };
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ status: 'error', message: err instanceof Error ? err.message : 'Failed to create project' }));
      } else {
        console.error('Error:', err instanceof Error ? err.message : 'Failed to create project');
      }
      process.exit(1);
    }
  } else if (options.org || options.name || options.region) {
    // Partial flags provided - show error
    if (options.json) {
      console.log(JSON.stringify({ status: 'error', message: 'To create a new project non-interactively, provide all of: --org, --name, --region. Or use --project to link to an existing project.' }));
    } else {
      console.error('Error: To create a new project non-interactively, provide all of: --org, --name, --region');
      console.error('Or use --project <ref> to link to an existing project.');
    }
    process.exit(1);
  } else if (options.json || !process.stdin.isTTY) {
    // Non-interactive mode but no flags provided
    if (options.json) {
      console.log(JSON.stringify({ 
        status: 'error', 
        message: 'Non-interactive mode requires flags. Use --project <ref> for existing project, or --org, --name, --region for new project.',
        hint: 'Run "supa orgs --json" to list organizations, "supa projects list --json" to list projects.'
      }));
    } else {
      console.error('Error: Non-interactive mode requires flags.');
      console.error('Use --project <ref> for existing project, or --org, --name, --region for new project.');
      console.error('Run "supa orgs --json" to list organizations, "supa projects list --json" to list projects.');
    }
    process.exit(1);
  } else {
    // Interactive mode
    project = await new Promise<ProjectResult>((resolve) => {
      const { unmount, clear } = render(
        <InitUI onComplete={(result) => { clear(); unmount(); resolve(result); }} />
      );
    });
  }

  const { ref: projectRef, name: projectName } = project;
  
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
  let anonKey = '';
  let apiUrl = `https://${projectRef}.supabase.co`;
  let apiConfig: ReturnType<typeof buildApiConfigFromRemote> = {};
  let authConfig: ReturnType<typeof buildAuthConfigFromRemote> = {};
  
  try {
    // Wait a moment for the project to be ready
    await new Promise(r => setTimeout(r, 2000));
    
    // Fetch API keys
    const keys = await client.getProjectApiKeys(projectRef);
    const anonKeyObj = keys.find(k => k.name === 'anon' || k.name === 'publishable anon key');
    if (anonKeyObj?.api_key) {
      anonKey = anonKeyObj.api_key;
    }
    
    // Fetch remote config
    const remotePostgrest = await client.getPostgrestConfig(projectRef);
    apiConfig = buildApiConfigFromRemote(remotePostgrest as Record<string, unknown>);
    
    const remoteAuth = await client.getAuthConfig(projectRef);
    authConfig = buildAuthConfigFromRemote(remoteAuth as Record<string, unknown>);
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
    join(supabaseDir, 'migrations'),
    join(supabaseDir, 'functions'),
    join(supabaseDir, 'types'),
    join(supabaseDir, 'schema', 'public'),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // Write DB password to .env if we created a new project
  if (project.dbPassword) {
    const envPath = join(cwd, '.env');
    const envLine = `SUPABASE_DB_PASSWORD=${project.dbPassword}\n`;
    if (existsSync(envPath)) {
      // Append to existing .env
      const existingContent = readFileSync(envPath, 'utf-8');
      if (!existingContent.includes('SUPABASE_DB_PASSWORD=')) {
        appendFileSync(envPath, envLine);
      }
    } else {
      writeFileSync(envPath, envLine);
    }
  }

  // Build config from actual project settings
  const configContent = buildConfigJson({
    projectId: projectRef,
    api: apiConfig,
    auth: authConfig,
  });
  writeFileSync(join(supabaseDir, 'config.json'), configContent);
  writeFileSync(join(supabaseDir, 'migrations', '.gitkeep'), '');
  writeFileSync(join(supabaseDir, 'functions', '.gitkeep'), '');

  if (options.json) {
    console.log(JSON.stringify({ 
      status: 'success', 
      projectId: projectRef,
      apiUrl,
      anonKey: anonKey || null,
      dashboardUrl: `https://supabase.com/dashboard/project/${projectRef}`,
      created: ['supabase/config.json', 'supabase/migrations/', 'supabase/functions/', 'supabase/types/', 'supabase/schema/public/'],
      next: 'supa dev --json'
    }));
  } else {
    const dashboardUrl = `https://supabase.com/dashboard/project/${projectRef}`;
    
    const SuccessOutput = () => (
      <Output>
        <Text>{success('Initialized Supabase')}</Text>
        <Text>  Created a new project: {bold(`"${projectName}"`)}</Text>
        <BlankLine />
        <Text dimColor>  Project</Text>
        <Text>    <Text dimColor>ID:</Text>        {projectRef}</Text>
        <Text>    <Text dimColor>Dashboard:</Text> {url(dashboardUrl)}</Text>
        <BlankLine />
        <Text dimColor>  API Credentials</Text>
        <Text>    <Text dimColor>URL:</Text>        {url(apiUrl)}</Text>
        <Text>    <Text dimColor>Anon Key:</Text>   {anonKey || <Text dimColor>[Keys still initializing]</Text>}</Text>
        <Text>    <Text dimColor>Secret Key:</Text> <Text dimColor>[hidden] run "supa keys"</Text></Text>
        <BlankLine />
        <Text dimColor>  Usage</Text>
        <Text>    <Text dimColor>createClient(</Text>{url(`"${apiUrl}"`)}<Text dimColor>, {"\"<ANON_KEY>\""}</Text><Text dimColor>)</Text></Text>
        <BlankLine />
        <Text>  <Text dimColor>Created in</Text> {bold('./supabase/')}</Text>
        <Text>    <Text dimColor>{icons.file}</Text> config.json</Text>
        <Text>    <Text dimColor>{icons.folder}</Text> migrations/</Text>
        <Text>    <Text dimColor>{icons.folder}</Text> functions/</Text>
        <Text>    <Text dimColor>{icons.folder}</Text> types/</Text>
        <BlankLine />
        <Text dimColor>  Next steps</Text>
        <Text>    <Text dimColor>$</Text> supa pull   <Text dimColor>Pull types from remote</Text></Text>
        <Text>    <Text dimColor>$</Text> supa watch  <Text dimColor>Watch for changes</Text></Text>
      </Output>
    );
    
    render(<SuccessOutput />);
  }
}
