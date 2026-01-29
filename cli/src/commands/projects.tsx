/**
 * Projects command - list, select, or create projects
 */

import React, { useState, useEffect } from 'react';
import { render, Text, Box, useApp } from 'ink';
import { Spinner, Status } from '../components/Spinner.js';
import { Table } from '../components/Table.js';
import { RegionPicker, NameInput } from '../components/Pickers.js';
import { OrgFlow } from '../components/OrgFlow.js';
import { createClient, Project, ProjectResponse, Organization } from '../lib/api.js';
import { getAccessToken } from '../lib/config.js';
import { formatProjectStatus, type Region } from '../lib/constants.js';
import { createProject as createProjectOp } from '../lib/operations.js';

interface ProjectsOptions {
  action: 'list' | 'new';
  json?: boolean;
  org?: string;
  region?: string;
  name?: string;
  yes?: boolean;
}

// List projects UI
function ProjectsListUI({ orgSlug }: { orgSlug?: string }) {
  const { exit } = useApp();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    const token = getAccessToken();
    if (!token) {
      setError('Not logged in');
      setLoading(false);
      setTimeout(() => exit(), 100);
      return;
    }

    try {
      const client = createClient(token);
      let allProjects = await client.listProjects();
      
      if (orgSlug) {
        allProjects = allProjects.filter(p => p.organization_slug === orgSlug);
      }
      
      setProjects(allProjects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
      setTimeout(() => exit(), 100);
    }
  }

  if (loading) {
    return <Box padding={1}><Spinner message="Loading projects..." /></Box>;
  }

  if (error) {
    return <Box padding={1}><Status type="error" message={error} /></Box>;
  }

  if (projects.length === 0) {
    return <Box padding={1}><Status type="info" message="No projects found" /></Box>;
  }

  const tableData = projects.map((p) => ({
    name: p.name,
    ref: p.ref,
    region: p.region,
    status: formatProjectStatus(p.status),
  }));

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="magenta">Your Projects</Text>
      <Box marginTop={1}>
        <Table
          columns={[
            { key: 'name', header: 'Name', width: 30 },
            { key: 'ref', header: 'Ref', width: 25 },
            { key: 'region', header: 'Region', width: 15 },
            { key: 'status', header: 'Status', width: 15 },
          ]}
          data={tableData}
        />
      </Box>
    </Box>
  );
}

// Create project UI
function ProjectsCreateUI({ 
  orgSlug,
  onCreated 
}: { 
  orgSlug?: string;
  onCreated: (project: ProjectResponse) => void;
}) {
  const [step, setStep] = useState<'org' | 'name' | 'region' | 'creating' | 'done'>(orgSlug ? 'name' : 'org');
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [projectName, setProjectName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [createdProject, setCreatedProject] = useState<ProjectResponse | null>(null);

  async function createProject(region: Region) {
    setStep('creating');
    const token = getAccessToken();
    const orgToUse = orgSlug || selectedOrg?.slug;
    
    if (!token || !orgToUse) {
      setError('Missing token or org');
      return;
    }

    try {
      const project = await createProjectOp({
        token,
        orgSlug: orgToUse,
        region,
        name: projectName || undefined,
      });
      
      setCreatedProject(project);
      setStep('done');
      onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    }
  }

  if (error) {
    return <Box padding={1}><Status type="error" message={error} /></Box>;
  }

  if (step === 'org') {
    return (
      <Box padding={1}>
        <OrgFlow
          onComplete={(org) => {
            setSelectedOrg(org);
            setStep('name');
          }}
          onError={setError}
        />
      </Box>
    );
  }

  if (step === 'name') {
    const suggestedName = `my-project-${Date.now().toString(36).slice(-4)}`;
    return (
      <Box padding={1}>
        <NameInput
          label="Project name:"
          placeholder={suggestedName}
          defaultValue={suggestedName}
          hint="This will be visible in your Supabase dashboard"
          onSubmit={(name) => {
            setProjectName(name);
            setStep('region');
          }}
        />
      </Box>
    );
  }

  if (step === 'region') {
    return <Box padding={1}><RegionPicker title="Select region for new project:" onSelect={createProject} /></Box>;
  }

  if (step === 'creating') {
    return <Box padding={1}><Spinner message={`Creating project "${projectName}"...`} /></Box>;
  }

  if (step === 'done' && createdProject) {
    return (
      <Box flexDirection="column" padding={1}>
        <Status type="success" message={`Project created: ${createdProject.name}`} />
        <Text>  Ref: {createdProject.ref}</Text>
        <Text>  Region: {createdProject.region}</Text>
      </Box>
    );
  }

  return null;
}

export async function projectsCommand(options: ProjectsOptions) {
  const token = getAccessToken();

  if (!token) {
    if (options.json) {
      console.log(JSON.stringify({ status: 'error', message: 'Not logged in' }));
    } else {
      console.log('Not logged in. Set SUPABASE_ACCESS_TOKEN environment variable.');
    }
    return;
  }

  // Handle 'new' action
  if (options.action === 'new') {
    return new Promise<void>((resolve) => {
      const { unmount } = render(
        <ProjectsCreateUI
          orgSlug={options.org}
          onCreated={() => {
            setTimeout(() => { unmount(); resolve(); }, 1000);
          }}
        />
      );
    });
  }

  // Default: list action (JSON mode)
  if (options.json) {
    try {
      const client = createClient(token);
      let projects = await client.listProjects();
      
      if (options.org) {
        projects = projects.filter(p => p.organization_slug === options.org);
      }
      
      console.log(JSON.stringify({ status: 'success', projects }));
    } catch (error) {
      console.log(JSON.stringify({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to load projects',
      }));
    }
    return;
  }

  // Interactive list
  render(<ProjectsListUI orgSlug={options.org} />);
}
